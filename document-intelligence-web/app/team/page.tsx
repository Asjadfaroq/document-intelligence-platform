"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getApiBase, readResponseBody, formatError, AuthResponse } from "../lib/api";

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

export default function TeamPage() {
  const router = useRouter();
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

  const isLoggedIn = Boolean(role);

  const canCreateWorkspace = role === "Owner" || role === "Admin";

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
    return () => {
      cancelled = true;
    };
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
    if (data.length > 0) setWorkspaceId((prev) => prev || data[0].id);
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
    if (!res.ok) {
      throw new Error(formatError(res.status, body));
    }
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
      if (!res.ok) {
        throw new Error(formatError(res.status, body));
      }
      if (!body || typeof body !== "object" || !("role" in body)) {
        throw new Error("Unexpected response from switch-tenant.");
      }
      const auth = body as AuthResponse;
      setUserFromAuth(auth);
      setActiveTenantId(auth.tenantId);
      await loadWorkspaces();
      setStatus("Tenant switched.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to switch tenant.");
    }
  }

  async function handleRefreshWorkspaces() {
    if (!isLoggedIn) {
      setStatus("Login first.");
      return;
    }
    setStatus("Refreshing workspaces...");
    try {
      await loadWorkspaces();
      setStatus("Workspaces refreshed.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to refresh workspaces.");
    }
  }

  async function handleCreateInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setStatus("Creating invite...");
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
      setStatus("Invite created. Share this code with the user.");
      setInviteEmail("");
      await loadMembers();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to create invite.");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinTenant(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!joinCode.trim()) {
      setStatus("Invite code is required.");
      return;
    }
    setBusy(true);
    setStatus("Joining tenant with invite code...");
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
      setStatus("Joined tenant successfully. You can now switch tenants from the sidebar.");
      setJoinCode("");
      setJoinPassword("");
      await loadMembers();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to join tenant.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-zinc-50">
      <div className="flex min-h-screen w-full">
        {/* Sidebar (same as dashboard) */}
        <aside className="hidden w-64 flex-col border-r border-zinc-800 bg-zinc-950 p-4 md:flex">
          <div className="mb-6">
            <h1 className="text-lg font-semibold">Document Intelligence</h1>
            <p className="mt-1 text-xs text-zinc-500">
              {email} &middot; {role}
            </p>
          </div>

          <div className="mb-4 space-y-2">
            <p className="text-xs font-semibold uppercase text-zinc-500">Tenant</p>
            <select
              className="w-full rounded border border-zinc-700 bg-transparent p-2 text-sm"
              value={activeTenantId}
              onChange={(e) => handleSwitchTenant(e.target.value)}
              disabled={tenants.length === 0}
            >
              <option value="">Select tenant</option>
              {tenants.map((t) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {t.tenantName} ({t.role})
                </option>
              ))}
            </select>
          </div>

          <div className="mb-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase text-zinc-500">Workspaces</p>
              <button
                type="button"
                className="text-xs text-zinc-400 hover:text-zinc-200"
                onClick={handleRefreshWorkspaces}
              >
                Refresh
              </button>
            </div>
            <select
              className="w-full rounded border border-zinc-700 bg-transparent p-2 text-sm"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              disabled={workspaces.length === 0}
            >
              <option value="">Select workspace</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            {canCreateWorkspace && (
              <button
                type="button"
                className="mt-1 w-full rounded bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700"
                onClick={() => router.push("/")} // creation is on dashboard
              >
                New workspace
              </button>
            )}
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
            {canCreateWorkspace && (
              <a
                href="/admin"
                className="block rounded px-3 py-2 text-zinc-200 hover:bg-zinc-800"
              >
                Admin
              </a>
            )}
          </nav>

          <div className="mt-auto space-y-2 text-sm">
            <p className="text-xs font-semibold uppercase text-zinc-500">Session</p>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full rounded border border-zinc-700 px-3 py-2 text-left text-zinc-200 hover:bg-zinc-800"
            >
              Logout
            </button>
            {status && (
              <p className="text-xs text-zinc-500 line-clamp-3">{status}</p>
            )}
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 p-4 md:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-2xl font-semibold">Team</h1>
          </div>

          <section className="rounded border border-zinc-700 bg-zinc-950/40 p-4">
        <h2 className="mb-2 text-lg font-medium">Members</h2>
        {members.length === 0 ? (
          <p className="text-sm text-zinc-400">No members found.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded border border-zinc-700 px-3 py-2"
              >
                <span>
                  {m.email}{" "}
                  <span className="text-xs text-zinc-400">({m.role})</span>
                </span>
                <span className="text-xs text-zinc-500">
                  Joined {new Date(m.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
          </section>

          <section className="mt-4 rounded border border-zinc-700 bg-zinc-950/40 p-4">
        <h2 className="mb-2 text-lg font-medium">Invite Member</h2>
        <form className="flex flex-col gap-3 md:flex-row" onSubmit={handleCreateInvite}>
          <input
            className="flex-1 rounded border border-zinc-600 bg-transparent p-2"
            type="email"
            placeholder="User email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
          />
          <select
            className="rounded border border-zinc-600 bg-transparent p-2"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as "Member" | "Admin")}
          >
            <option value="Member">Member</option>
            <option value="Admin">Admin</option>
          </select>
          <button
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            type="submit"
            disabled={busy}
          >
            {busy ? "Creating..." : "Create Invite"}
          </button>
        </form>
        {latestCode && (
          <p className="mt-3 text-sm text-zinc-300">
            Invite code:{" "}
            <span className="font-mono rounded bg-zinc-900 px-2 py-1">{latestCode}</span>
          </p>
        )}
      </section>

      <section className="rounded border border-zinc-700 p-4">
        <h2 className="mb-2 text-lg font-medium">Join Another Tenant</h2>
        <form className="flex flex-col gap-3 md:flex-row" onSubmit={handleJoinTenant}>
          <input
            className="flex-1 rounded border border-zinc-600 bg-transparent p-2"
            placeholder="Invite code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            required
          />
          <input
            className="rounded border border-zinc-600 bg-transparent p-2"
            type="password"
            placeholder="Password"
            value={joinPassword}
            onChange={(e) => setJoinPassword(e.target.value)}
            required
          />
          <button
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            type="submit"
            disabled={busy}
          >
            {busy ? "Joining..." : "Join Tenant"}
          </button>
        </form>
          </section>
        </div>
      </div>
    </main>
  );
}

