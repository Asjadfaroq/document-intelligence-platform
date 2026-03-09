"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getApiBase, readResponseBody, formatError, AuthResponse } from "../lib/api";

type TenantMember = {
  id: string;
  email: string;
  role: string;
  createdAt: string;
};

export default function TeamPage() {
  const router = useRouter();
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"Member" | "Admin">("Member");
  const [latestCode, setLatestCode] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    async function init() {
      try {
        const res = await fetch(`${getApiBase()}/auth/me`, { credentials: "include" });
        if (!res.ok) throw new Error("Unauthorized");
        const data = (await res.json()) as AuthResponse;
        if (cancelled) return;
        await loadMembers();
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

  async function loadMembers() {
    const res = await fetch(`${getApiBase()}/tenant/members`, { credentials: "include" });
    const body = await readResponseBody(res);
    if (!res.ok) {
      throw new Error(formatError(res.status, body));
    }
    const data = Array.isArray(body) ? (body as TenantMember[]) : [];
    setMembers(data);
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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Team</h1>
        <Link
          href="/"
          className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm font-medium hover:bg-zinc-700"
        >
          Back to dashboard
        </Link>
      </div>

      <section className="rounded border border-zinc-700 p-4">
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

      <section className="rounded border border-zinc-700 p-4">
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

      <p className="text-sm text-zinc-400">{status}</p>
    </main>
  );
}

