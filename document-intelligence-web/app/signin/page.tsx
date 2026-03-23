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
import AuthLayout from "../components/AuthLayout";
import PasswordInput from "../components/PasswordInput";

const inputBase =
  "w-full rounded-xl border border-zinc-600/80 bg-zinc-800/40 pl-10 pr-4 py-3 text-zinc-100 placeholder-zinc-500 transition-all duration-200 focus:border-indigo-500/60 focus:bg-zinc-800/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

const inputIcon = "absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-zinc-500";

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
    <AuthLayout title="Welcome back" subtitle="Sign in to continue to your workspace">
      <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label htmlFor="email" className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Email
          </label>
          <div className="relative">
            <svg className={inputIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <input
              id="email"
              className={inputBase}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Password
          </label>
          <PasswordInput
            id="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-300">
              Demo Credentials
            </p>
            <span className="text-[11px] text-zinc-500">For local testing</span>
          </div>
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-zinc-400">Email</span>
              <code className="rounded-lg border border-zinc-700/60 bg-zinc-950/30 px-2.5 py-1 font-mono text-xs text-zinc-100">
                owner@acme.com
              </code>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-zinc-400">Password</span>
              <code className="rounded-lg border border-zinc-700/60 bg-zinc-950/30 px-2.5 py-1 font-mono text-xs text-zinc-100">
                Password123!
              </code>
            </div>
          </div>
        </div>

        {status && (
          <p className="text-sm text-zinc-400" role="status">
            {status}
          </p>
        )}

        <button
          className="mt-1 rounded-xl bg-indigo-600 px-4 py-3 font-medium text-white shadow-lg shadow-indigo-500/25 transition-all hover:bg-indigo-500 hover:shadow-indigo-500/30 disabled:opacity-60 disabled:hover:bg-indigo-600"
          type="submit"
          disabled={busy}
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>

        <div className="relative my-2">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-700/60" />
          </div>
          <div className="relative flex justify-center text-xs text-zinc-500">
            <span className="bg-zinc-900/40 px-3">or</span>
          </div>
        </div>

        <p className="text-center text-sm text-zinc-400">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-indigo-400 underline-offset-2 hover:text-indigo-300 hover:underline"
          >
            Create account
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
