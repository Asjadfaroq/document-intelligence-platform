"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getApiBase,
  readResponseBody,
  formatError,
  AuthResponse,
} from "../lib/api";
import { useToast } from "../components/ToastProvider";

export default function SignInPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    fetch(`${getApiBase()}/auth/me`, { credentials: "include" })
      .then((res) => res.ok ? res.json() : null)
      .then((data: AuthResponse | null) => {
        if (data) router.replace("/");
      })
      .catch(() => { /* ignore */ });
  }, [router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setStatus("Signing in...");
    try {
      const res = await fetch(`${getApiBase()}/auth/login-simple`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });
      const body = await readResponseBody(res);
      if (!res.ok) throw new Error(formatError(res.status, body));
      if (!body || typeof body !== "object" || !("role" in body))
        throw new Error("Unexpected response.");
      setStatus("Success. Redirecting...");
      showToast("Signed in successfully.", "success");
      router.replace("/");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Sign in failed.";
      setStatus(msg);
      showToast(msg, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-dark-bg app-grid mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 p-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:p-6">
      <h1 className="text-2xl font-semibold text-zinc-100">Sign In</h1>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <input
          className="rounded-lg border border-zinc-600/80 bg-zinc-800/50 px-3 py-2.5 text-zinc-100 placeholder-zinc-500 transition-colors focus:border-indigo-500/60 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="rounded-lg border border-zinc-600/80 bg-zinc-800/50 px-3 py-2.5 text-zinc-100 placeholder-zinc-500 transition-colors focus:border-indigo-500/60 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button
          className="rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-60"
          type="submit"
          disabled={busy}
        >
          {busy ? "Signing in..." : "Sign In"}
        </button>
      </form>
      <p className="text-sm text-zinc-400">{status}</p>
      <p className="text-sm text-zinc-400">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-blue-400 underline hover:no-underline">
          Create account
        </Link>
      </p>
    </main>
  );
}
