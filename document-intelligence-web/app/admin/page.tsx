"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
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
import { getApiBase, readResponseBody, formatError, AuthResponse } from "../lib/api";
import { useToast } from "../components/ToastProvider";

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

const CHART_HEIGHT = 140;
const TOP_DOCS_MAX_HEIGHT = 120;
const PIE_COLORS = [
  "rgb(99, 102, 241)",  // indigo
  "rgb(34, 197, 94)",   // emerald
  "rgb(249, 115, 22)",  // orange
  "rgb(236, 72, 153)",  // pink
  "rgb(14, 165, 233)",  // sky
  "rgb(168, 85, 247)",  // violet
  "rgb(234, 179, 8)",   // amber
  "rgb(20, 184, 166)",  // teal
];
const GRID_COLOR = "rgba(113, 113, 122, 0.3)";
const AXIS_COLOR = "rgb(161, 161, 170)";

/** Custom tooltip for charts – professional, polished style */
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
      {label && (
        <p className="mb-1.5 truncate max-w-[220px] text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          {label}
        </p>
      )}
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-zinc-500">{valueLabel}</span>
        <span className="text-base font-bold tabular-nums text-indigo-300">
          {valueFormatter(value)}
        </span>
      </div>
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

  const load = useCallback(async () => {
    const apiBase = getApiBase();
    setError(null);
    setLoading(true);

    try {
      let meRes = await fetch(`${apiBase}/auth/me`, { credentials: "include" });
      if (meRes.status === 401) {
        const msg = "Please log in on the home page first.";
        setError(msg);
        showToast(msg, "error");
        setLoading(false);
        return;
      }
      if (!meRes.ok) {
        const msg = "Failed to verify session.";
        setError(msg);
        showToast(msg, "error");
        setLoading(false);
        return;
      }
      const me = (await meRes.json()) as AuthMe;
      setEmail(me.email);
      setRole(me.role);
      if (me.role !== "Owner" && me.role !== "Admin") {
        const msg = "Access denied. This page is for Owner or Admin only.";
        setError(msg);
        showToast(msg, "error");
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
        const msg = "Access denied. Owner or Admin role required.";
        setError(msg);
        showToast(msg, "error");
        setLoading(false);
        return;
      }
      if (res.status === 401) {
        const msg = "Session expired. Please log in again.";
        setError(msg);
        showToast(msg, "error");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const body = await readResponseBody(res);
        const text = typeof body === "string" ? body : formatError(res.status, body);
        const msg = text || `Request failed: ${res.status}`;
        setError(msg);
        showToast(msg, "error");
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

  if (loading && !overview) {
    return (
      <main className="app-dark-bg app-grid flex min-h-screen items-center justify-center p-6">
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-sm text-zinc-500"
        >
          Loading analytics…
        </motion.p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="app-dark-bg app-grid flex min-h-screen items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md space-y-4 rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-6"
        >
          <p className="text-amber-400/90">{error}</p>
          <Link href="/" className="inline-block text-sm text-indigo-400 hover:text-indigo-300">
            ← Back to home
          </Link>
        </motion.div>
      </main>
    );
  }

  if (!overview) {
    return (
      <main className="app-dark-bg app-grid flex min-h-screen items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md space-y-4"
        >
          <p className="text-zinc-500">No data available.</p>
          <Link href="/" className="inline-block text-sm text-indigo-400 hover:text-indigo-300">
            ← Back to home
          </Link>
        </motion.div>
      </main>
    );
  }

  const questionsChartData = (overview.questionsPerDay ?? []).map((q) => questionsPerDayMap(q));
  const docsByWorkspaceData = (overview.docCountPerWorkspace ?? []).map((d) => docPerWorkspaceMap(d));
  const topDocsData = (overview.topDocumentsByUsage ?? []).map((d) => topDocMap(d));
  const totalCitations = topDocsData.reduce((s, d) => s + d.usage, 0);
  const citationShareData = topDocsData.map((d) => ({
    name: d.name,
    value: d.usage,
    pct: totalCitations > 0 ? Math.round((d.usage / totalCitations) * 100) : 0,
  }));

  const kpis = [
    { label: "Documents", value: overview.totalDocuments ?? 0, isNumber: true },
    { label: "Questions", value: overview.totalQuestions ?? 0, isNumber: true },
    { label: "Users", value: overview.totalUsers ?? 0, isNumber: true },
    {
      label: "Avg latency",
      value: overview.averageAnswerLatencyMs != null ? `${Math.round(overview.averageAnswerLatencyMs)} ms` : "—",
      isNumber: false,
    },
  ];

  return (
    <main className="app-dark-bg app-grid h-screen overflow-hidden text-zinc-50">
      <div className="flex h-full w-full min-h-0">
        {/* Sidebar */}
        <aside className="glass-surface hidden w-56 flex-shrink-0 flex-col border-r border-zinc-800/40 p-3 md:flex">
          <h1 className="mb-4 text-sm font-semibold tracking-tight text-zinc-100">
            Doc Intelligence
          </h1>

          <nav className="space-y-0.5 border-t border-zinc-800/50 pt-3">
            <Link href="/" className="block rounded px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200">
              Dashboard
            </Link>
            <Link href="/team" className="block rounded px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200">
              Team
            </Link>
            <Link href="/admin" className="block rounded px-2 py-1.5 text-xs text-zinc-200 bg-zinc-800/50">
              Admin
            </Link>
          </nav>

          <div className="mt-auto border-t border-zinc-800/50 pt-3">
            <p className="mb-1 px-2 text-[10px] text-zinc-500">{email}</p>
            <p className="px-2 text-[10px] text-zinc-500">{role}</p>
          </div>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 md:p-4">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mb-2 flex flex-shrink-0 flex-wrap items-center justify-between gap-2"
          >
            <div>
              <h1 className="text-base font-semibold tracking-tight text-zinc-100">
                Analytics
              </h1>
              <p className="text-[11px] text-zinc-500">
                Tenant overview and usage metrics
              </p>
            </div>
            <Link
              href="/"
              className="rounded-xl border border-zinc-700/50 bg-zinc-900/50 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800/50"
            >
              ← Back to Chat
            </Link>
          </motion.div>

          {/* KPI cards */}
          <div className="mb-2 grid flex-shrink-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((kpi, i) => (
              <motion.div
                key={kpi.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: i * 0.05 }}
                className="glass-surface rounded-xl border border-zinc-800/40 p-3 shadow-lg"
              >
                <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  {kpi.label}
                </p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-100">
                  {kpi.isNumber ? (kpi.value as number).toLocaleString() : kpi.value}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Charts grid */}
          <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-2">
            {questionsChartData.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="glass-surface flex min-h-0 flex-col rounded-xl border border-zinc-800/40 p-2 shadow-lg"
              >
                <h2 className="mb-1 flex-shrink-0 text-sm font-semibold text-zinc-200">
                  Questions per day
                </h2>
                <div style={{ height: CHART_HEIGHT }} className="w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={questionsChartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                      <XAxis dataKey="date" stroke={AXIS_COLOR} fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke={AXIS_COLOR} fontSize={11} tickLine={false} axisLine={false} width={32} />
                      <Tooltip
                        content={({ active, payload, label }) => (
                          <ChartTooltip
                            active={active}
                            payload={payload}
                            label={label ? `Date: ${label}` : undefined}
                            valueLabel="Questions"
                          />
                        )}
                        cursor={{ stroke: GRID_COLOR, strokeWidth: 1 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="questions"
                        stroke="rgb(99, 102, 241)"
                        strokeWidth={2}
                        dot={{ fill: "rgb(99, 102, 241)", strokeWidth: 0, r: 3 }}
                        activeDot={{ r: 5, fill: "rgb(129, 140, 248)" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </motion.section>
            )}

            {docsByWorkspaceData.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.15 }}
                className="glass-surface flex min-h-0 flex-col rounded-xl border border-zinc-800/40 p-2 shadow-lg"
              >
                <h2 className="mb-1 flex-shrink-0 text-sm font-semibold text-zinc-200">
                  Documents per workspace
                </h2>
                <div style={{ height: CHART_HEIGHT }} className="w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={docsByWorkspaceData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                      <XAxis dataKey="name" stroke={AXIS_COLOR} fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke={AXIS_COLOR} fontSize={11} tickLine={false} axisLine={false} width={32} />
                      <Tooltip
                        content={({ active, payload, label }) => (
                          <ChartTooltip
                            active={active}
                            payload={payload}
                            label={label ? `Workspace: ${label}` : undefined}
                            valueLabel="Documents"
                          />
                        )}
                        cursor={{ stroke: GRID_COLOR, strokeWidth: 1 }}
                      />
                      <Bar
                        dataKey="documents"
                        fill="rgb(99, 102, 241)"
                        radius={[6, 6, 0, 0]}
                        maxBarSize={48}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </motion.section>
            )}

            {citationShareData.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.18 }}
                className="glass-surface flex min-h-0 flex-col rounded-xl border border-zinc-800/40 p-2 shadow-lg"
              >
                <h2 className="mb-1 flex-shrink-0 text-sm font-semibold text-zinc-200">
                  Citation share
                </h2>
                <div style={{ height: CHART_HEIGHT }} className="w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                      <Pie
                        data={citationShareData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={56}
                        paddingAngle={2}
                        stroke="transparent"
                      >
                        {citationShareData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="pointer-events-none rounded-xl border border-zinc-600/60 bg-zinc-900/98 px-4 py-3 shadow-2xl shadow-black/50 backdrop-blur-md ring-1 ring-white/5">
                              <p className="mb-1.5 truncate max-w-[200px] text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                                {d.name}
                              </p>
                              <div className="flex items-baseline gap-2">
                                <span className="text-xs text-zinc-500">Citations</span>
                                <span className="text-base font-bold tabular-nums text-indigo-300">
                                  {d.value} ({d.pct}%)
                                </span>
                              </div>
                            </div>
                          );
                        }}
                      />
                      {citationShareData.length <= 6 && (
                        <Legend
                          layout="horizontal"
                          align="center"
                          verticalAlign="bottom"
                          formatter={(value) => (
                            <span className="text-[10px] text-zinc-500">
                              {value.length > 16 ? value.slice(0, 16) + "…" : value}
                            </span>
                          )}
                          wrapperStyle={{ fontSize: 10 }}
                          iconSize={6}
                          iconType="circle"
                        />
                      )}
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </motion.section>
            )}

            {/* Usage summary - fills space next to Citation share */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className="glass-surface flex min-h-0 flex-col justify-center rounded-xl border border-zinc-800/40 p-3 shadow-lg"
            >
              <h2 className="mb-3 flex-shrink-0 text-sm font-semibold text-zinc-200">
                Usage summary
              </h2>
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
                  <span className="font-semibold tabular-nums text-zinc-100">
                    {(overview.totalUsers ?? 0) > 0 ? ((overview.totalDocuments ?? 0) / (overview.totalUsers ?? 1)).toFixed(1) : "—"}
                  </span>
                </div>
              </div>
              <p className="mt-3 flex-shrink-0 text-[10px] text-zinc-500">
                From tenant usage data
              </p>
            </motion.section>
          </div>

          {topDocsData.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className="glass-surface mt-2 flex flex-shrink-0 flex-col rounded-xl border border-zinc-800/40 p-2 shadow-lg"
            >
              <h2 className="mb-1 text-sm font-semibold text-zinc-200">
                Top documents by usage
              </h2>
              <div style={{ height: Math.min(TOP_DOCS_MAX_HEIGHT, Math.max(60, topDocsData.length * 22)) }} className="w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={topDocsData}
                    layout="vertical"
                    margin={{ top: 4, right: 8, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
                    <XAxis type="number" stroke={AXIS_COLOR} fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" stroke={AXIS_COLOR} fontSize={11} tickLine={false} axisLine={false} width={140} />
                    <Tooltip
                      content={({ active, payload, label }) => (
                        <ChartTooltip
                          active={active}
                          payload={payload}
                          label={label as string}
                          valueLabel="Citations"
                        />
                      )}
                      cursor={{ stroke: GRID_COLOR, strokeWidth: 1 }}
                    />
                    <Bar
                      dataKey="usage"
                      fill="rgb(34, 197, 94)"
                      radius={[0, 6, 6, 0]}
                      maxBarSize={20}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.section>
          )}

          {questionsChartData.length === 0 && docsByWorkspaceData.length === 0 && topDocsData.length === 0 && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-xl border border-zinc-800/40 bg-zinc-900/30 py-12 text-center text-sm text-zinc-500"
            >
              No analytics data yet. Upload documents and ask questions to see metrics.
            </motion.p>
          )}
        </div>
      </div>
    </main>
  );
}
