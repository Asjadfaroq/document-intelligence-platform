"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import { getApiBase, readResponseBody, formatError, AuthResponse } from "../lib/api";

type AuthMe = { tenantId: string; email: string; role: string };

type DocCountPerWorkspace = { workspaceId: string; workspaceName: string; documentCount: number };
type QuestionsPerDay = { date: string; count: number };
type TopDocumentUsage = { documentId: string; fileName: string; usageCount: number };
// API may return PascalCase; normalize to camelCase for charts
function questionsPerDayMap(q: { date?: string; Date?: string; count?: number; Count?: number }): { date: string; count: number } {
  return { date: (q.date ?? q.Date ?? "").slice(0, 10), count: q.count ?? q.Count ?? 0 };
}
function docPerWorkspaceMap(d: { workspaceName?: string; WorkspaceName?: string; documentCount?: number; DocumentCount?: number }): { name: string; documents: number } {
  const name = d.workspaceName ?? d.WorkspaceName ?? "?";
  return { name: name.slice(0, 15) + (name.length > 15 ? "…" : ""), documents: d.documentCount ?? d.DocumentCount ?? 0 };
}
function topDocMap(d: { fileName?: string; FileName?: string; usageCount?: number; UsageCount?: number }): { name: string; usage: number } {
  const name = d.fileName ?? d.FileName ?? "?";
  return { name: name.slice(0, 20) + (name.length > 20 ? "…" : ""), usage: d.usageCount ?? d.UsageCount ?? 0 };
}

type TenantOverview = {
  totalDocuments?: number;
  totalQuestions?: number;
  totalUsers?: number;
  averageAnswerLatencyMs?: number | null;
  docCountPerWorkspace?: DocCountPerWorkspace[];
  questionsPerDay?: (QuestionsPerDay & { Date?: string; Count?: number })[];
  topDocumentsByUsage?: TopDocumentUsage[];
};

export default function AdminPage() {
  const [overview, setOverview] = useState<TenantOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");

  const load = useCallback(async () => {
    const apiBase = getApiBase();
    setError(null);
    setLoading(true);

    try {
      let meRes = await fetch(`${apiBase}/auth/me`, { credentials: "include" });
      if (meRes.status === 401) {
        setError("Please log in on the home page first.");
        setLoading(false);
        return;
      }
      if (!meRes.ok) {
        setError("Failed to verify session.");
        setLoading(false);
        return;
      }
      const me = (await meRes.json()) as AuthMe;
      setEmail(me.email);
      setRole(me.role);
      if (me.role !== "Owner" && me.role !== "Admin") {
        setError("Access denied. This page is for Owner or Admin only.");
        setLoading(false);
        return;
      }

      let res = await fetch(`${apiBase}/admin/tenant/overview`, { credentials: "include" });
      if (res.status === 401) {
        const refreshRes = await fetch(`${apiBase}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (refreshRes.ok) res = await fetch(`${apiBase}/admin/tenant/overview`, { credentials: "include" });
      }

      if (res.status === 403) {
        setError("Access denied. Owner or Admin role required.");
        setLoading(false);
        return;
      }
      if (res.status === 401) {
        setError("Session expired. Please log in again.");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const body = await readResponseBody(res);
        const text = typeof body === "string" ? body : formatError(res.status, body);
        setError(text || `Request failed: ${res.status}`);
        setLoading(false);
        return;
      }

      const data = (await res.json()) as TenantOverview;
      setOverview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load overview.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !overview) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black p-6">
        <p className="text-zinc-400">Loading admin overview…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black p-6">
        <div className="w-full max-w-lg space-y-3">
          <p className="text-amber-400">{error}</p>
          <Link href="/" className="text-sm text-blue-400 hover:underline">
            ← Back to home
          </Link>
        </div>
      </main>
    );
  }

  if (!overview) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black p-6">
        <div className="w-full max-w-lg space-y-3">
          <p className="text-zinc-400">No data.</p>
          <Link href="/" className="text-sm text-blue-400 hover:underline">
            ← Back to home
          </Link>
        </div>
      </main>
    );
  }

  const questionsChartData = (overview.questionsPerDay ?? []).map((q) => ({
    date: questionsPerDayMap(q).date,
    questions: questionsPerDayMap(q).count,
  }));
  const docsByWorkspaceData = (overview.docCountPerWorkspace ?? []).map((d) => docPerWorkspaceMap(d));
  const topDocsData = (overview.topDocumentsByUsage ?? []).map((d) => topDocMap(d));

  return (
    <main className="min-h-screen bg-black text-zinc-50">
      <div className="flex min-h-screen w-full">
        {/* Sidebar layout to match dashboard */}
        <aside className="hidden w-64 flex-col border-r border-zinc-800 bg-zinc-950 p-4 md:flex">
          <div className="mb-6">
            <h1 className="text-lg font-semibold">Document Intelligence</h1>
            <p className="mt-1 text-xs text-zinc-500">
              {email} &middot; {role}
            </p>
          </div>

          <nav className="mb-4 space-y-1 text-sm">
            <Link
              href="/"
              className="block rounded px-3 py-2 text-zinc-200 hover:bg-zinc-800"
            >
              Dashboard
            </Link>
            <Link
              href="/team"
              className="block rounded px-3 py-2 text-zinc-200 hover:bg-zinc-800"
            >
              Team
            </Link>
            <Link
              href="/admin"
              className="block rounded px-3 py-2 text-zinc-200 hover:bg-zinc-800"
            >
              Admin
            </Link>
          </nav>

          <div className="mt-auto space-y-2 text-sm">
            <p className="text-xs text-zinc-500">
              Admin analytics for current tenant.
            </p>
          </div>
        </aside>

        <div className="flex-1 p-4 md:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-semibold">Admin – Tenant Overview</h1>
            <Link
              href="/"
              className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm font-medium hover:bg-zinc-700"
            >
              ← Back to Q&A
            </Link>
          </div>

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded border border-zinc-700 bg-zinc-900/50 p-4">
          <p className="text-xs text-zinc-400">Total documents</p>
          <p className="text-2xl font-semibold">{overview.totalDocuments ?? 0}</p>
        </div>
        <div className="rounded border border-zinc-700 bg-zinc-900/50 p-4">
          <p className="text-xs text-zinc-400">Total questions</p>
          <p className="text-2xl font-semibold">{overview.totalQuestions ?? 0}</p>
        </div>
        <div className="rounded border border-zinc-700 bg-zinc-900/50 p-4">
          <p className="text-xs text-zinc-400">Users in tenant</p>
          <p className="text-2xl font-semibold">{overview.totalUsers ?? 0}</p>
        </div>
        <div className="rounded border border-zinc-700 bg-zinc-900/50 p-4">
          <p className="text-xs text-zinc-400">Avg answer latency</p>
          <p className="text-2xl font-semibold">
            {overview.averageAnswerLatencyMs != null && overview.averageAnswerLatencyMs !== undefined
              ? `${Math.round(overview.averageAnswerLatencyMs)} ms`
              : "—"}
          </p>
        </div>
          </section>

          {questionsChartData.length > 0 && (
            <section className="mt-4 rounded border border-zinc-700 bg-zinc-950/40 p-4">
          <h2 className="mb-2 text-lg font-medium">Questions per day (last 30 days)</h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={questionsChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#52525b" />
                <XAxis dataKey="date" stroke="#a1a1aa" fontSize={12} />
                <YAxis stroke="#a1a1aa" fontSize={12} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#27272a", border: "1px solid #52525b" }}
                  labelStyle={{ color: "#a1a1aa" }}
                />
                <Line type="monotone" dataKey="questions" stroke="#22c55e" strokeWidth={2} dot={{ fill: "#22c55e" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
            </section>
          )}

          {docsByWorkspaceData.length > 0 && (
            <section className="mt-4 rounded border border-zinc-700 bg-zinc-950/40 p-4">
          <h2 className="mb-2 text-lg font-medium">Documents per workspace</h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={docsByWorkspaceData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#52525b" />
                <XAxis dataKey="name" stroke="#a1a1aa" fontSize={12} />
                <YAxis stroke="#a1a1aa" fontSize={12} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#27272a", border: "1px solid #52525b" }}
                />
                <Bar dataKey="documents" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
            </section>
          )}

          {topDocsData.length > 0 && (
            <section className="mt-4 rounded border border-zinc-700 bg-zinc-950/40 p-4">
          <h2 className="mb-2 text-lg font-medium">Top documents by usage (cited in answers)</h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topDocsData} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#52525b" />
                <XAxis type="number" stroke="#a1a1aa" fontSize={12} />
                <YAxis type="category" dataKey="name" stroke="#a1a1aa" fontSize={12} width={120} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#27272a", border: "1px solid #52525b" }}
                />
                <Bar dataKey="usage" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
            </section>
          )}

          {questionsChartData.length === 0 && docsByWorkspaceData.length === 0 && topDocsData.length === 0 && (
            <p className="mt-4 text-sm text-zinc-400">
              No chart data yet. Upload documents and ask questions to see stats.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
