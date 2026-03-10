"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { getApiBase, readResponseBody, formatError, AuthResponse } from "../lib/api";
import { useToast } from "../components/ToastProvider";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import { AppFooter } from "../components/AppFooter";

type TenantMember = {
  id: string;
  email: string;
  role: string;
  createdAt: string;
};

type Workspace = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
};

type TenantMembership = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: string;
};

function getInitials(email: string): string {
  const part = email.split("@")[0];
  if (part.length >= 2) return part.slice(0, 2).toUpperCase();
  return part.slice(0, 1).toUpperCase();
}

function RoleBadge({ role }: { role: string }) {
  const isAdmin = role === "Admin" || role === "Owner";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
        isAdmin
          ? "bg-indigo-500/20 text-indigo-300"
          : "bg-zinc-700/60 text-zinc-400"
      }`}
    >
      {role}
    </span>
  );
}

export default function TeamPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [tenants, setTenants] = useState<TenantMembership[]>([]);
  const [activeTenantId, setActiveTenantId] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"Member" | "Admin">("Member");
  const [latestCode, setLatestCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteWorkspaceId, setDeleteWorkspaceId] = useState<string | null>(null);
  const [showDeleteTenantModal, setShowDeleteTenantModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!sidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [sidebarOpen]);

  const isLoggedIn = Boolean(role);
  const isOwner = role === "Owner";

  const canCreateWorkspace = role === "Owner" || role === "Admin";
  const canInvite = role === "Owner" || role === "Admin";

  function setUserFromAuth(a: AuthResponse) {
    setEmail(a.email ?? "");
    setRole(a.role ?? "");
    setActiveTenantId(a.tenantId ?? "");
  }

  async function refreshSession(): Promise<boolean> {
    try {
      const res = await fetch(`${getApiBase()}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await readResponseBody(res);
      if (!res.ok || !data || typeof data !== "object" || !("role" in data)) return false;
      setUserFromAuth(data as AuthResponse);
      return true;
    } catch {
      return false;
    }
  }

  async function fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
    let res = await fetch(url, { ...init, credentials: "include" });
    if (res.status === 401) {
      const ok = await refreshSession();
      if (ok) res = await fetch(url, { ...init, credentials: "include" });
    }
    return res;
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    async function init() {
      try {
        const res = await fetch(`${getApiBase()}/auth/me`, { credentials: "include" });
        if (!res.ok) throw new Error("Unauthorized");
        const data = (await res.json()) as AuthResponse;
        if (cancelled) return;
        setUserFromAuth(data);
        await Promise.all([
          loadWorkspaces(),
          loadTenants(data.tenantId),
          loadMembers(),
        ]);
      } catch {
        if (cancelled) return;
        router.replace("/signin");
      }
    }

    void init();
    return () => { cancelled = true; };
  }, [router]);

  async function loadWorkspaces() {
    let res = await fetch(`${getApiBase()}/workspaces`, { credentials: "include" });
    if (res.status === 401) {
      const ok = await refreshSession();
      if (ok) res = await fetch(`${getApiBase()}/workspaces`, { credentials: "include" });
    }
    const body = await readResponseBody(res);
    if (!res.ok) {
      const msg = res.status >= 500 ? "Server error loading workspaces. Try again." : formatError(res.status, body);
      throw new Error(msg);
    }
    const data = Array.isArray(body) ? (body as Workspace[]) : [];
    setWorkspaces(data);
    setWorkspaceId((prev) =>
      data.length === 0 ? "" : (data.some((w) => w.id === prev) ? prev : data[0].id)
    );
  }

  async function loadTenants(initialTenantId?: string) {
    const res = await fetchWithAuth(`${getApiBase()}/auth/tenants`);
    const body = await readResponseBody(res);
    if (!res.ok) {
      const msg =
        res.status >= 500
          ? "Server error loading tenants. Try again."
          : formatError(res.status, body);
      throw new Error(msg);
    }
    const data = Array.isArray(body) ? (body as TenantMembership[]) : [];
    setTenants(data);
    if (!activeTenantId) {
      const next = initialTenantId ?? data[0]?.tenantId ?? "";
      setActiveTenantId(next);
    }
  }

  async function loadMembers() {
    const res = await fetch(`${getApiBase()}/tenant/members`, { credentials: "include" });
    const body = await readResponseBody(res);
    if (!res.ok) throw new Error(formatError(res.status, body));
    const data = Array.isArray(body) ? (body as TenantMember[]) : [];
    setMembers(data);
  }

  async function handleLogout() {
    try {
      await fetch(`${getApiBase()}/auth/logout`, { method: "POST", credentials: "include" });
    } catch { /* ignore */ }
    setRole("");
    setTenants([]);
    setActiveTenantId("");
    setWorkspaces([]);
    setWorkspaceId("");
    setStatus("Logged out.");
    showToast("Logged out.", "success");
    router.replace("/signin");
  }

  async function handleSwitchTenant(nextTenantId: string) {
    if (!nextTenantId || nextTenantId === activeTenantId) return;
    setStatus("Switching tenant...");
    try {
      const res = await fetchWithAuth(`${getApiBase()}/auth/switch-tenant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: nextTenantId }),
      });
      const body = await readResponseBody(res);
      if (!res.ok) throw new Error(formatError(res.status, body));
      if (!body || typeof body !== "object" || !("role" in body)) {
        throw new Error("Unexpected response from switch-tenant.");
      }
      const auth = body as AuthResponse;
      setUserFromAuth(auth);
      setActiveTenantId(auth.tenantId);
      await loadWorkspaces();
      setStatus("Tenant switched.");
      showToast("Tenant switched.", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to switch tenant.";
      setStatus(msg);
      showToast(msg, "error");
    }
  }

  async function handleRefreshWorkspaces() {
    if (!isLoggedIn) {
      showToast("Login first.", "error");
      return;
    }
    try {
      await loadWorkspaces();
      showToast("Workspaces refreshed.", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to refresh workspaces.";
      showToast(msg, "error");
    }
  }

  async function handleCreateInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setLatestCode(null);
    try {
      const res = await fetch(`${getApiBase()}/tenant/invitations`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const body = await readResponseBody(res);
      if (!res.ok) throw new Error(formatError(res.status, body));
      if (!body || typeof body !== "object" || !("code" in body)) {
        throw new Error("Unexpected response from invitation endpoint.");
      }
      const { code } = body as { code: string };
      setLatestCode(code);
      showToast("Invite created.", "success");
      setInviteEmail("");
      await loadMembers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create invite.";
      showToast(msg, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinTenant(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!joinCode.trim()) {
      showToast("Invite code is required.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${getApiBase()}/auth/accept-invite`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: joinCode.trim(),
          password: joinPassword,
        }),
      });
      const body = await readResponseBody(res);
      if (!res.ok) throw new Error(formatError(res.status, body));
      if (!body || typeof body !== "object" || !("role" in body)) {
        throw new Error("Unexpected response from accept-invite endpoint.");
      }
      showToast("Joined tenant successfully.", "success");
      setJoinCode("");
      setJoinPassword("");
      await loadMembers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to join tenant.";
      showToast(msg, "error");
    } finally {
      setBusy(false);
    }
  }

  async function copyInviteCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      showToast("Code copied to clipboard.", "success");
    } catch {
      showToast("Failed to copy.", "error");
    }
  }

  async function handleDeleteWorkspace() {
    if (!deleteWorkspaceId) return;
    await refreshSession();
    const res = await fetch(`${getApiBase()}/workspaces/${deleteWorkspaceId}?confirm=true`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.status === 403) throw new Error("Only the Owner can delete workspaces.");
    if (res.status === 404) {
      const body = await readResponseBody(res);
      const debug = typeof body === "object" && body && "_debug" in body ? (body as { _debug?: { workspaceId: string; tenantId: string } })._debug : undefined;
      if (debug && typeof console !== "undefined") console.warn("Workspace delete 404:", debug);
      setDeleteWorkspaceId(null);
      await loadWorkspaces();
      showToast(debug ? "Workspace not found. Check console and backend logs for tenant ID." : "Workspace may have been removed. List refreshed.", debug ? "error" : "info");
      return;
    }
    if (!res.ok) {
      const body = await readResponseBody(res);
      throw new Error(typeof body === "object" && body && "error" in body ? String((body as { error: string }).error) : formatError(res.status, body));
    }
    setDeleteWorkspaceId(null);
    showToast("Workspace deleted.", "success");
    await loadWorkspaces();
    if (workspaceId === deleteWorkspaceId) {
      const remaining = workspaces.find((w) => w.id !== deleteWorkspaceId);
      setWorkspaceId(remaining?.id ?? "");
    }
  }

  async function handleDeleteTenant() {
    const res = await fetch(`${getApiBase()}/admin/tenant?confirm=true`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.status === 403) throw new Error("Only the Owner can delete the tenant.");
    if (!res.ok) {
      const body = await readResponseBody(res);
      throw new Error(typeof body === "object" && body && "error" in body ? String((body as { error: string }).error) : formatError(res.status, body));
    }
    showToast("Tenant deleted. Redirecting to sign in.", "success");
    router.replace("/signin");
  }

  return (
    <main className="app-dark-bg app-grid min-h-dvh text-zinc-50 md:min-h-screen">
      <div className="flex min-h-dvh w-full md:min-h-screen">
        <div
          className={`drawer-overlay md:hidden ${sidebarOpen ? "is-open" : ""}`}
          onClick={() => setSidebarOpen(false)}
          aria-hidden={!sidebarOpen}
        />
        <aside
          className={`drawer-panel flex flex-col overflow-y-auto p-3 md:flex-shrink-0 ${sidebarOpen ? "is-open" : ""}`}
        >
          <h1 className="mb-4 text-sm font-semibold tracking-tight text-zinc-100">
            Doc Intelligence
          </h1>

          <div className="space-y-2">
            <select
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900/60 px-2 py-1.5 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none"
              value={activeTenantId}
              onChange={(e) => handleSwitchTenant(e.target.value)}
              disabled={tenants.length === 0}
            >
              {tenants.map((t) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {t.tenantName}
                </option>
              ))}
            </select>
            <div className="flex gap-1">
              <select
                className="flex-1 rounded-lg border border-zinc-700/60 bg-zinc-900/60 px-2 py-1.5 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none"
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                disabled={workspaces.length === 0}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              {canCreateWorkspace && (
                <Link
                  href="/"
                  className="rounded-lg bg-zinc-700/60 px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-600/60"
                  title="New workspace"
                >
                  +
                </Link>
              )}
            </div>
          </div>

          <nav className="mt-3 space-y-0.5 border-t border-zinc-800/50 pt-3">
            <Link href="/" className="block rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200" onClick={() => setSidebarOpen(false)}>
              Dashboard
            </Link>
            <Link href="/team" className="block rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 bg-zinc-800/50" onClick={() => setSidebarOpen(false)}>
              Team
            </Link>
            {canCreateWorkspace && (
              <a href="/admin" className="block rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200" onClick={() => setSidebarOpen(false)}>
                Admin
              </a>
            )}
          </nav>

          <div className="mt-auto border-t border-zinc-800/50 pt-3">
            <p className="mb-1 px-2 text-[10px] text-zinc-500">{email}</p>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full rounded-lg px-2.5 py-1.5 text-left text-xs text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
            >
              Logout
            </button>
            <AppFooter variant="compact" />
          </div>
        </aside>

        {/* Main content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* Mobile header */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800/40 p-3 md:hidden">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              aria-label="Open menu"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h1 className="truncate text-base font-semibold text-zinc-100">Team</h1>
            <div className="w-9" />
          </div>
          <div className="flex-1 p-3 sm:p-4 md:p-6">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mb-6"
          >
            <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
              Team
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Manage members and invitations for your workspace
            </p>
          </motion.div>

          {/* Responsive grid: 3 cols (Members|Invite|Join) or 2 cols (Members|Join) */}
          <div
            className={`grid gap-4 sm:grid-cols-2 ${canInvite ? "lg:grid-cols-3" : ""}`}
          >
            {/* Column 1: Members */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.05 }}
              className="glass-surface flex min-h-[200px] flex-col rounded-xl border border-zinc-800/40 p-4 shadow-lg sm:min-h-0"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-200">
                  Members
                </h2>
                <span className="text-[11px] text-zinc-500">{members.length} total</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <AnimatePresence mode="popLayout">
                  {members.length === 0 ? (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="py-12 text-center text-sm text-zinc-500"
                    >
                      No members in this tenant yet.
                    </motion.p>
                  ) : (
                    <ul className="space-y-1.5">
                      {members.map((m, i) => (
                        <motion.li
                          key={m.id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 8 }}
                          transition={{ duration: 0.2, delay: i * 0.03 }}
                          className="flex items-center gap-3 rounded-lg border border-zinc-700/30 bg-zinc-900/30 px-3 py-2 transition-colors hover:border-zinc-600/40 hover:bg-zinc-800/30"
                        >
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-[11px] font-semibold text-indigo-300">
                            {getInitials(m.email)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-zinc-200">{m.email}</p>
                            <p className="text-[10px] text-zinc-500">
                              {new Date(m.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <RoleBadge role={m.role} />
                        </motion.li>
                      ))}
                    </ul>
                  )}
                </AnimatePresence>
              </div>
            </motion.section>

            {/* Column 2: Invite Member */}
            {canInvite && (
              <motion.section
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="glass-surface flex flex-col rounded-xl border border-zinc-800/40 p-4 shadow-lg"
              >
                <h2 className="mb-3 text-sm font-semibold text-zinc-200">
                  Invite Member
                </h2>
                <form className="flex flex-col gap-3" onSubmit={handleCreateInvite}>
                  <input
                    type="email"
                    placeholder="Email address"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                    className="w-full rounded-xl border border-zinc-700/50 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                  />
                  <div className="flex gap-2">
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as "Member" | "Admin")}
                      className="flex-1 rounded-xl border border-zinc-700/50 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
                    >
                      <option value="Member">Member</option>
                      <option value="Admin">Admin</option>
                    </select>
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition-all hover:bg-indigo-400 disabled:opacity-50"
                    >
                      {busy ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-transparent" />
                      ) : (
                        "Invite"
                      )}
                    </button>
                  </div>
                </form>
                <AnimatePresence>
                  {latestCode && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-3 overflow-hidden"
                    >
                      <div className="flex flex-col gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2">
                        <span className="text-[10px] text-zinc-500">Code created:</span>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 truncate font-mono text-xs text-indigo-200">{latestCode}</code>
                          <button
                            type="button"
                            onClick={() => copyInviteCode(latestCode)}
                            className="rounded-lg border border-zinc-600/50 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-100"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.section>
            )}

            {/* Column 3: Join Tenant */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.15 }}
              className="glass-surface flex flex-col rounded-xl border border-zinc-800/40 p-4 shadow-lg"
            >
              <h2 className="mb-3 text-sm font-semibold text-zinc-200">
                Join Tenant
              </h2>
              <form className="flex flex-col gap-3" onSubmit={handleJoinTenant}>
                <input
                  placeholder="Invite code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  required
                  className="w-full rounded-xl border border-zinc-700/50 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                  required
                  className="w-full rounded-xl border border-zinc-700/50 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-xl bg-emerald-500/90 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-emerald-400 disabled:opacity-50"
                >
                  {busy ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-transparent" />
                      Joining...
                    </span>
                  ) : (
                    "Join Tenant"
                  )}
                </button>
              </form>
            </motion.section>
          </div>

          {/* Data Management — Owner only */}
          {isOwner && (
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className="mt-8"
            >
              <div className="glass-surface rounded-xl border border-zinc-800/40 p-4 shadow-lg">
                <h2 className="mb-1 text-sm font-semibold text-zinc-200">
                  Data management
                </h2>
                <p className="mb-4 text-xs text-zinc-500">
                  Permanently remove workspaces or the entire tenant. Deleted data cannot be recovered.
                </p>
                <div className="space-y-4">
                  <div>
                    <h3 className="mb-2 text-xs font-medium text-zinc-400">Workspaces</h3>
                    {workspaces.length === 0 ? (
                      <p className="rounded-lg border border-zinc-700/40 bg-zinc-900/40 px-3 py-4 text-center text-xs text-zinc-500">
                        No workspaces to manage
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {workspaces.map((w) => (
                          <li
                            key={w.id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-zinc-700/40 bg-zinc-900/40 px-3 py-2.5"
                          >
                            <span className="truncate text-sm text-zinc-200">{w.name}</span>
                            <button
                              type="button"
                              onClick={() => setDeleteWorkspaceId(w.id)}
                              className="shrink-0 rounded-md border border-red-500/50 px-2.5 py-1 text-[11px] font-medium text-red-400 transition-colors hover:bg-red-500/10 hover:border-red-400/60 hover:text-red-300"
                            >
                              Delete
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="border-t border-zinc-800/60 pt-4">
                    <h3 className="mb-2 text-xs font-medium text-zinc-400">Tenant</h3>
                    <p className="mb-3 text-xs text-zinc-500">
                      Deleting the tenant removes all workspaces, documents, and members.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowDeleteTenantModal(true)}
                      className="rounded-md border border-red-500/50 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 hover:border-red-400/60 hover:text-red-300"
                    >
                      Delete tenant
                    </button>
                  </div>
                </div>
              </div>
            </motion.section>
          )}

          </div>
          <ConfirmDeleteModal
            open={!!deleteWorkspaceId}
            onClose={() => setDeleteWorkspaceId(null)}
            onConfirm={handleDeleteWorkspace}
            title="Delete workspace"
            description="This will permanently delete the workspace and all documents inside it. All embeddings and storage files will be removed. This action cannot be undone."
            confirmLabel="Type DELETE to confirm"
            confirmValue="DELETE"
          />
          <ConfirmDeleteModal
            open={showDeleteTenantModal}
            onClose={() => setShowDeleteTenantModal(false)}
            onConfirm={handleDeleteTenant}
            title="Delete tenant"
            description="This will permanently delete the entire tenant, all workspaces, documents, members, and associated data. You will be signed out. This action cannot be undone."
            confirmLabel="Type DELETE to confirm"
            confirmValue="DELETE"
          />
        </div>
      </div>
    </main>
  );
}
