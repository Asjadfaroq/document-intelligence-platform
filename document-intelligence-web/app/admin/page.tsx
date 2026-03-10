"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { getApiBase, readResponseBody, formatError } from "../lib/api";
import { useToast } from "../components/ToastProvider";
import { AppFooter } from "../components/AppFooter";

type AuthMe = { tenantId: string; email: string; role: string };

type DocCountPerWorkspace = { workspaceId: string; workspaceName: string; documentCount: number };
type QuestionsPerDay = { date: string; count: number };
type TopDocumentUsage = { documentId: string; fileName: string; usageCount: number };

function questionsPerDayMap(q: { date?: string; Date?: string; count?: number; Count?: number }): { date: string; questions: number } {
  return { date: (q.date ?? q.Date ?? "").slice(0, 10), questions: q.count ?? q.Count ?? 0 };
}
function docPerWorkspaceMap(d: { workspaceName?: string; WorkspaceName?: string; documentCount?: number; DocumentCount?: number }): { name: string; documents: number } {
  const name = d.workspaceName ?? d.WorkspaceName ?? "?";
  return { name: name.length > 18 ? name.slice(0, 18) + "…" : name, documents: d.documentCount ?? d.DocumentCount ?? 0 };
}
function topDocMap(d: { fileName?: string; FileName?: string; usageCount?: number; UsageCount?: number }): { name: string; usage: number } {
  const name = d.fileName ?? d.FileName ?? "?";
  return { name: name.length > 24 ? name.slice(0, 24) + "…" : name, usage: d.usageCount ?? d.UsageCount ?? 0 };
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

const TOP_DOCS_MAX_HEIGHT = 120;
const PIE_COLORS = ["rgb(99, 102, 241)", "rgb(34, 197, 94)", "rgb(249, 115, 22)", "rgb(236, 72, 153)", "rgb(14, 165, 233)", "rgb(168, 85, 247)", "rgb(234, 179, 8)", "rgb(20, 184, 166)"];
const GRID_COLOR = "rgba(113, 113, 122, 0.3)";
const AXIS_COLOR = "rgb(161, 161, 170)";

function ChartTooltip({
  active,
  payload,
  label,
  valueLabel = "Value",
  valueFormatter = (v: number) => v.toString(),
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string }>;
  label?: string;
  valueLabel?: string;
  valueFormatter?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const value = payload[0].value;
  return (
    <div className="pointer-events-none rounded-xl border border-zinc-600/60 bg-zinc-900/98 px-4 py-3 shadow-2xl shadow-black/50 backdrop-blur-md ring-1 ring-white/5">
      {label && <p className="mb-1.5 truncate max-w-[220px] text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>}
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-zinc-500">{valueLabel}</span>
        <span className="text-base font-bold tabular-nums text-indigo-300">{valueFormatter(value)}</span>
      </div>
    </div>
  );
}

function EmptyChartPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[80px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700/40 bg-zinc-900/20 text-zinc-500">
      <p className="text-center text-xs">{label}</p>
    </div>
  );
}

export default function AdminPage() {
  const { showToast } = useToast();
  const [overview, setOverview] = useState<TenantOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const load = useCallback(async () => {
    const apiBase = getApiBase();
    setError(null);
    setLoading(true);
    try {
      const meRes = await fetch(`${apiBase}/auth/me`, { credentials: "include" });
      if (meRes.status === 401) {
        setError("Please log in on the home page first.");
        showToast("Please log in on the home page first.", "error");
        setLoading(false);
        return;
      }
      if (!meRes.ok) {
        setError("Failed to verify session.");
        showToast("Failed to verify session.", "error");
        setLoading(false);
        return;
      }
      const me = (await meRes.json()) as AuthMe;
      setEmail(me.email);
      setRole(me.role);
      if (me.role !== "Owner" && me.role !== "Admin") {
        setError("Access denied. This page is for Owner or Admin only.");
        showToast("Access denied.", "error");
        setLoading(false);
        return;
      }

      let res = await fetch(`${apiBase}/admin/tenant/overview`, { credentials: "include" });
      if (res.status === 401) {
        const refreshRes = await fetch(`${apiBase}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (refreshRes.ok) res = await fetch(`${apiBase}/admin/tenant/overview`, { credentials: "include" });
      }
      if (res.status === 403) {
        setError("Access denied. Owner or Admin role required.");
        showToast("Access denied.", "error");
        setLoading(false);
        return;
      }
      if (res.status === 401) {
        setError("Session expired. Please log in again.");
        showToast("Session expired.", "error");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const body = await readResponseBody(res);
        setError(typeof body === "string" ? body : formatError(res.status, body));
        showToast("Failed to load analytics.", "error");
        setLoading(false);
        return;
      }

      const data = (await res.json()) as TenantOverview;
      setOverview(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load overview.";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const { questionsChartData, docsByWorkspaceData, topDocsData, citationShareData, kpis, totalCitations } = useMemo(() => {
    if (!overview) {
      return {
        questionsChartData: [] as { date: string; questions: number }[],
        docsByWorkspaceData: [] as { name: string; documents: number }[],
        topDocsData: [] as { name: string; usage: number }[],
        citationShareData: [] as { name: string; value: number; pct: number }[],
        kpis: [] as { label: string; value: number | string; isNumber: boolean }[],
        totalCitations: 0,
      };
    }
    const q = (overview.questionsPerDay ?? []).map(questionsPerDayMap);
    const d = (overview.docCountPerWorkspace ?? []).map(docPerWorkspaceMap);
    const t = (overview.topDocumentsByUsage ?? []).map(topDocMap);
    const total = t.reduce((s, x) => s + x.usage, 0);
    const citationShare = t.map((x) => ({
      name: x.name,
      value: x.usage,
      pct: total > 0 ? Math.round((x.usage / total) * 100) : 0,
    }));
    const k = [
      { label: "Documents", value: overview.totalDocuments ?? 0, isNumber: true },
      { label: "Questions", value: overview.totalQuestions ?? 0, isNumber: true },
      { label: "Users", value: overview.totalUsers ?? 0, isNumber: true },
      { label: "Avg latency", value: overview.averageAnswerLatencyMs != null ? `${Math.round(overview.averageAnswerLatencyMs)} ms` : "—", isNumber: false },
    ];
    return {
      questionsChartData: q,
      docsByWorkspaceData: d,
      topDocsData: t,
      citationShareData: citationShare,
      kpis: k,
      totalCitations: total,
    };
  }, [overview]);

  if (loading && !overview) {
    return (
      <main className="app-dark-bg app-grid h-screen overflow-hidden text-zinc-50">
        <div className="flex h-full w-full min-h-0">
          <aside className="glass-surface hidden w-56 flex-shrink-0 flex-col border-r border-zinc-800/40 p-3 md:flex">
            <h1 className="mb-4 text-sm font-semibold text-zinc-100">Doc Intelligence</h1>
            <nav className="space-y-0.5 border-t border-zinc-800/50 pt-3">
              <Link href="/" className="block rounded px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200">Dashboard</Link>
              <Link href="/team" className="block rounded px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200">Team</Link>
              <Link href="/admin" className="block rounded px-2 py-1.5 text-xs text-zinc-200 bg-zinc-800/50">Admin</Link>
            </nav>
          </aside>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6">
            <p className="text-sm text-zinc-500">Loading analytics…</p>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="app-dark-bg app-grid min-h-screen flex items-center justify-center p-6 text-zinc-50">
        <div className="w-full max-w-md space-y-4 rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-6">
          <p className="text-amber-400/90">{error}</p>
          <Link href="/" className="inline-block text-sm text-indigo-400 hover:text-indigo-300">← Back to home</Link>
        </div>
      </main>
    );
  }

  if (!overview) {
    return (
      <main className="app-dark-bg app-grid min-h-screen flex items-center justify-center p-6 text-zinc-50">
        <div className="space-y-4">
          <p className="text-zinc-500">No data available.</p>
          <Link href="/" className="inline-block text-sm text-indigo-400 hover:text-indigo-300">← Back to home</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="app-dark-bg app-grid h-dvh overflow-hidden text-zinc-50 md:h-screen">
      <div className="flex h-full w-full min-h-0">
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}
        <aside
          className={`glass-surface fixed inset-y-0 left-0 z-50 flex w-64 max-w-[85vw] flex-col border-r border-zinc-800/40 p-3 transition-transform duration-300 ease-out md:relative md:inset-auto md:z-auto md:h-full md:w-56 md:max-w-none md:flex-shrink-0 md:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <h1 className="mb-4 text-sm font-semibold tracking-tight text-zinc-100">Doc Intelligence</h1>
          <nav className="space-y-0.5 border-t border-zinc-800/50 pt-3">
            <Link href="/" className="block rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200" onClick={() => setSidebarOpen(false)}>Dashboard</Link>
            <Link href="/team" className="block rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200" onClick={() => setSidebarOpen(false)}>Team</Link>
            <Link href="/admin" className="block rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 bg-zinc-800/50" onClick={() => setSidebarOpen(false)}>Admin</Link>
          </nav>
          <div className="mt-auto border-t border-zinc-800/50 pt-3">
            <p className="mb-1 px-2 text-[10px] text-zinc-500">{email}</p>
            <p className="px-2 text-[10px] text-zinc-500">{role}</p>
            <AppFooter variant="compact" />
          </div>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mb-2 flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-800/40 p-3 md:border-b-0 md:p-3 md:pb-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200 md:hidden"
                aria-label="Open menu"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <div>
                <h1 className="text-base font-semibold tracking-tight text-zinc-100 sm:text-lg">Analytics</h1>
                <p className="text-[11px] text-zinc-500">Tenant overview and usage metrics</p>
              </div>
            </div>
            <Link href="/" className="rounded-xl border border-zinc-700/50 bg-zinc-900/50 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800/50 sm:px-4">
              ← Back to Chat
            </Link>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 pb-4 md:px-4">
          <div className="grid flex-shrink-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((kpi) => (
              <div key={kpi.label} className="glass-surface rounded-xl border border-zinc-800/40 p-3 shadow-lg">
                <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{kpi.label}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-100">
                  {kpi.isNumber ? (kpi.value as number).toLocaleString() : kpi.value}
                </p>
              </div>
            ))}
          </div>

          <div className="grid min-h-0 flex-[3] gap-2 overflow-hidden lg:grid-cols-2 lg:grid-rows-[1fr_1fr]">
            <section className="glass-surface flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800/40 p-2 shadow-lg">
              <h2 className="mb-1 flex-shrink-0 text-sm font-semibold text-zinc-200">Questions per day</h2>
              <div className="relative min-h-0 flex-1 w-full">
                {questionsChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={questionsChartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                      <XAxis dataKey="date" stroke={AXIS_COLOR} fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke={AXIS_COLOR} fontSize={11} tickLine={false} axisLine={false} width={32} />
                      <Tooltip content={({ active, payload, label }) => <ChartTooltip active={active} payload={payload} label={label ? `Date: ${label}` : undefined} valueLabel="Questions" />} cursor={{ stroke: GRID_COLOR, strokeWidth: 1 }} />
                      <Line type="monotone" dataKey="questions" stroke="rgb(99, 102, 241)" strokeWidth={2} dot={{ fill: "rgb(99, 102, 241)", strokeWidth: 0, r: 3 }} activeDot={{ r: 5, fill: "rgb(129, 140, 248)" }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChartPlaceholder label="No questions yet" />
                )}
              </div>
            </section>

            <section className="glass-surface flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800/40 p-2 shadow-lg">
              <h2 className="mb-1 flex-shrink-0 text-sm font-semibold text-zinc-200">Documents per workspace</h2>
              <div className="relative min-h-0 flex-1 w-full">
                {docsByWorkspaceData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={docsByWorkspaceData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                      <XAxis dataKey="name" stroke={AXIS_COLOR} fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke={AXIS_COLOR} fontSize={11} tickLine={false} axisLine={false} width={32} />
                      <Tooltip content={({ active, payload, label }) => <ChartTooltip active={active} payload={payload} label={label ? `Workspace: ${label}` : undefined} valueLabel="Documents" />} cursor={{ stroke: GRID_COLOR, strokeWidth: 1 }} />
                      <Bar dataKey="documents" fill="rgb(99, 102, 241)" radius={[6, 6, 0, 0]} maxBarSize={48} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChartPlaceholder label="No documents yet" />
                )}
              </div>
            </section>

            <section className="glass-surface flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800/40 p-2 shadow-lg">
              <h2 className="mb-1 flex-shrink-0 text-sm font-semibold text-zinc-200">Citation share</h2>
              <div className="relative min-h-0 flex-1 w-full">
                {citationShareData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                      <Pie data={citationShareData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={56} paddingAngle={2} stroke="transparent">
                        {citationShareData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload as { name: string; value: number; pct: number };
                          return (
                            <div className="pointer-events-none rounded-xl border border-zinc-600/60 bg-zinc-900/98 px-4 py-3 shadow-2xl shadow-black/50 backdrop-blur-md ring-1 ring-white/5">
                              <p className="mb-1.5 truncate max-w-[200px] text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{d.name}</p>
                              <div className="flex items-baseline gap-2">
                                <span className="text-xs text-zinc-500">Citations</span>
                                <span className="text-base font-bold tabular-nums text-indigo-300">{d.value} ({d.pct}%)</span>
                              </div>
                            </div>
                          );
                        }}
                      />
                      {citationShareData.length <= 6 && (
                        <Legend layout="horizontal" align="center" verticalAlign="bottom" formatter={(v) => <span className="text-[10px] text-zinc-500">{String(v).length > 16 ? String(v).slice(0, 16) + "…" : v}</span>} wrapperStyle={{ fontSize: 10 }} iconSize={6} iconType="circle" />
                      )}
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChartPlaceholder label="No citations yet" />
                )}
              </div>
            </section>

            <section className="glass-surface flex min-h-0 flex-col justify-center overflow-hidden rounded-xl border border-zinc-800/40 p-3 shadow-lg">
              <h2 className="mb-3 flex-shrink-0 text-sm font-semibold text-zinc-200">Usage summary</h2>
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-zinc-500">Total citations</span>
                  <span className="font-semibold tabular-nums text-zinc-100">{totalCitations}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-zinc-500">Documents tracked</span>
                  <span className="font-semibold tabular-nums text-zinc-100">{topDocsData.length}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-zinc-500">Docs per user</span>
                  <span className="font-semibold tabular-nums text-zinc-100">{(overview.totalUsers ?? 0) > 0 ? ((overview.totalDocuments ?? 0) / (overview.totalUsers ?? 1)).toFixed(1) : "—"}</span>
                </div>
              </div>
              <p className="mt-3 flex-shrink-0 text-[10px] text-zinc-500">From tenant usage data</p>
            </section>
          </div>

          <section className="glass-surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800/40 p-2 shadow-lg">
            <h2 className="mb-1 flex-shrink-0 text-sm font-semibold text-zinc-200">Top documents by usage</h2>
            <div className="relative min-h-0 flex-1 w-full" style={{ minHeight: topDocsData.length > 0 ? Math.min(TOP_DOCS_MAX_HEIGHT, Math.max(60, topDocsData.length * 22)) : 60 }}>
              {topDocsData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topDocsData} layout="vertical" margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
                    <XAxis type="number" stroke={AXIS_COLOR} fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" stroke={AXIS_COLOR} fontSize={11} tickLine={false} axisLine={false} width={140} />
                    <Tooltip content={({ active, payload, label }) => <ChartTooltip active={active} payload={payload} label={label as string} valueLabel="Citations" />} cursor={{ stroke: GRID_COLOR, strokeWidth: 1 }} />
                    <Bar dataKey="usage" fill="rgb(34, 197, 94)" radius={[0, 6, 6, 0]} maxBarSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChartPlaceholder label="Upload documents and ask questions to see usage" />
              )}
            </div>
          </section>
          </div>
        </div>
      </div>
    </main>
  );
}
