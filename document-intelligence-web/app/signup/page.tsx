"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getApiBase, readResponseBody, formatError } from "../lib/api";
import { useToast } from "../components/ToastProvider";

export default function SignUpPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    fetch(`${getApiBase()}/auth/me`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) router.replace("/");
      })
      .catch(() => { /* ignore */ });
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password !== confirmPassword) {
      const msg = "Passwords do not match.";
      setStatus(msg);
      showToast(msg, "error");
      return;
    }
    setBusy(true);
    setStatus("Creating account...");
    try {
      const res = await fetch(`${getApiBase()}/auth/signup`, {
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
      setStatus("Account created. Redirecting...");
      showToast("Account created.", "success");
      router.replace("/");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Create account failed.";
      setStatus(msg);
      showToast(msg, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-dark-bg app-grid mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 p-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:p-6">
      <h1 className="text-2xl font-semibold text-zinc-100">Create Account</h1>
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
        <input
          className="rounded-lg border border-zinc-600/80 bg-zinc-800/50 px-3 py-2.5 text-zinc-100 placeholder-zinc-500 transition-colors focus:border-indigo-500/60 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
          type="password"
          placeholder="Confirm password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />
        <button
          className="rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-60"
          type="submit"
          disabled={busy}
        >
          {busy ? "Creating..." : "Create Account"}
        </button>
      </form>
      <p className="text-sm text-zinc-400">{status}</p>
      <p className="text-sm text-zinc-400">
        Already have an account?{" "}
        <Link href="/signin" className="text-blue-400 underline hover:no-underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
