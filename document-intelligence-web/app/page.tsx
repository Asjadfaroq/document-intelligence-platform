"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getApiBase, readResponseBody, formatError, AuthResponse } from "./lib/api";
import CreateWorkspaceModal from "./components/CreateWorkspaceModal";

type Workspace = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
};

type SourceDocument = {
  id: string;
  workspaceId: string;
  fileName: string;
  storagePath: string;
  language: string | null;
  status: number;
  createdAt: string;
};

type AskResponse = {
  answer: string;
  sources: SourceDocument[];
  latencyMs?: number;
};

type ChatItem = {
  id: string;
  question: string;
  mode: "vector" | "hybrid";
  answer: string;
  sources: SourceDocument[];
  answerLanguage?: AnswerLanguagePreference;
};

type TenantMembership = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: string;
};

const quickQuestions = [
  "What is the candidate's current role?",
  "List the top technical skills from this CV.",
  "Summarize experience in 5 bullet points.",
];

/** Arabic script range (includes Arabic, Persian, Urdu, etc.). */
const ARABIC_SCRIPT_REGEX = /[\u0600-\u06FF]/;

function hasArabicScript(text: string): boolean {
  return ARABIC_SCRIPT_REGEX.test(text);
}

type AnswerLanguagePreference = "auto" | "en" | "ar";

function resolveAnswerDir(
  preference: AnswerLanguagePreference,
  answerText: string,
): "ltr" | "rtl" {
  if (preference === "ar") return "rtl";
  if (preference === "en") return "ltr";
  return hasArabicScript(answerText) ? "rtl" : "ltr";
}

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [tenants, setTenants] = useState<TenantMembership[]>([]);
  const [activeTenantId, setActiveTenantId] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [language, setLanguage] = useState<string>("");
  const [topK, setTopK] = useState(5);
  const [mode, setMode] = useState<"vector" | "hybrid">("hybrid");
  const [answerLanguage, setAnswerLanguage] = useState<AnswerLanguagePreference>("auto");
  const [question, setQuestion] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [status, setStatus] = useState<string>("");
  const [authChecked, setAuthChecked] = useState(false);
  const [busyUpload, setBusyUpload] = useState(false);
  const [busyAsk, setBusyAsk] = useState(false);
  const [showCreateWorkspaceModal, setShowCreateWorkspaceModal] = useState(false);
  const isLoggedIn = Boolean(role);

  const canCallApi = useMemo(
    () => Boolean(getApiBase().trim() && isLoggedIn && workspaceId.trim()),
    [isLoggedIn, workspaceId],
  );

  const canCreateWorkspace = role === "Owner" || role === "Admin";

  function setUserFromAuth(a: AuthResponse) {
    setEmail(a.email ?? "");
    setRole(a.role ?? "");
    setActiveTenantId(a.tenantId ?? "");
  }

  // Check session; if not logged in, redirect to sign in
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    async function init() {
      try {
        const res = await fetch(`${getApiBase()}/auth/me`, { credentials: "include" });
        if (!res.ok) {
          throw new Error("Unauthorized");
        }
        const data = (await res.json()) as AuthResponse;
        if (cancelled) return;
        setAuthChecked(true);
        setUserFromAuth(data);
        await Promise.all([loadWorkspaces(), loadTenants(data.tenantId)]);
      } catch {
        if (cancelled) return;
        setAuthChecked(true);
        router.replace("/signin");
      }
    }
    void init();
    return () => { cancelled = true; };
  }, [router]);

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

  async function handleCreateWorkspaceSubmit(
    name: string,
    description: string | null,
  ): Promise<string | null> {
    const res = await fetchWithAuth(`${getApiBase()}/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    const body = await readResponseBody(res);
    if (!res.ok) {
      if (res.status === 403) throw new Error("Only Owner or Admin can create workspaces.");
      throw new Error(formatError(res.status, body));
    }
    const data = body as { id: string };
    await loadWorkspaces();
    setWorkspaceId(data.id);
    setStatus("Workspace created.");
    return data.id;
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

  async function handleUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canCallApi || !uploadFile) {
      setStatus("Login, select workspace, and choose a PDF first.");
      return;
    }

    setBusyUpload(true);
    setStatus("Uploading and enqueueing ingestion...");
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      const query = new URLSearchParams({ workspaceId: workspaceId.trim() });
      if (language.trim()) query.set("language", language.trim());

      const res = await fetchWithAuth(`${getApiBase()}/documents/upload?${query.toString()}`, {
        method: "POST",
        headers: {},
        body: form,
      });

      const body = await readResponseBody(res);
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("Unauthorized. Please login again.");
        }
        throw new Error(formatError(res.status, body));
      }

      setStatus("Upload complete. Ingestion started. Wait until document status is Ready.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusyUpload(false);
    }
  }

  async function ask(q: string) {
    if (!canCallApi || !q.trim()) {
      setStatus("Login, select workspace, and enter a question.");
      return;
    }

    setBusyAsk(true);
    setStatus("Running RAG query...");
    try {
      const languageHint =
        answerLanguage === "auto" ? undefined : answerLanguage === "ar" ? "ar" : "en";

      const res = await fetchWithAuth(`${getApiBase()}/workspaces/${workspaceId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q.trim(),
          topK,
          mode,
          languageHint,
        }),
      });

      const body = await readResponseBody(res);
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("Unauthorized. Please login again.");
        }
        throw new Error(formatError(res.status, body));
      }

      if (!body || typeof body !== "object" || !("answer" in body) || !("sources" in body)) {
        throw new Error("Unexpected response format from /ask endpoint.");
      }

      const json = body as AskResponse;

      setChat((prev) => [
        {
          id: crypto.randomUUID(),
          question: q.trim(),
          mode,
          answer: json.answer,
          sources: json.sources,
          answerLanguage,
        },
        ...prev,
      ]);
      setQuestion("");
      setStatus("Answer received.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Ask failed.");
    } finally {
      setBusyAsk(false);
    }
  }

  if (!authChecked || !isLoggedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-zinc-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Document Intelligence Q&A</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/team"
            className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm font-medium hover:bg-zinc-700"
          >
            Team
          </Link>
          {canCreateWorkspace && (
            <a
              href="/admin"
              className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm font-medium hover:bg-zinc-700"
            >
              Admin Dashboard
            </a>
          )}
          {isLoggedIn && (
            <button
              type="button"
              onClick={handleLogout}
              className="rounded border border-zinc-600 px-3 py-2 text-sm hover:bg-zinc-800"
            >
              Logout
            </button>
          )}
        </div>
      </div>

      <section className="grid gap-3 rounded border border-zinc-700 p-4 md:grid-cols-2">
        <p className="text-sm text-zinc-400">
          Logged in as {email} ({role})
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded border border-zinc-600 bg-transparent p-2"
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
          <select
            className="rounded border border-zinc-600 bg-transparent p-2"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            disabled={workspaces.length === 0}
          >
            <option value="">Select workspace</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.id.slice(0, 8)}...)
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded border border-zinc-600 p-2 text-sm hover:bg-zinc-800"
            onClick={handleRefreshWorkspaces}
          >
            Refresh Workspaces
          </button>
          {canCreateWorkspace && (
            <button
              type="button"
              className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              onClick={() => setShowCreateWorkspaceModal(true)}
            >
              Create workspace
            </button>
          )}
        </div>
      </section>

      <CreateWorkspaceModal
        open={showCreateWorkspaceModal}
        onClose={() => setShowCreateWorkspaceModal(false)}
        onSubmit={handleCreateWorkspaceSubmit}
      />

      <section className="rounded border border-zinc-700 p-4">
        <h2 className="mb-2 text-lg font-medium">1) Re-upload PDF</h2>
        <form className="grid gap-3 md:grid-cols-4" onSubmit={handleUpload}>
          <input
            type="file"
            accept="application/pdf"
            className="rounded border border-zinc-600 bg-transparent p-2 md:col-span-2"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
          />
          <input
            className="rounded border border-zinc-600 bg-transparent p-2"
            placeholder="Language (optional: en/ar)"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          />
          <button
            className="rounded bg-blue-600 p-2 font-medium text-white disabled:opacity-60"
            disabled={busyUpload || !isLoggedIn || !workspaceId || !uploadFile}
            type="submit"
          >
            {busyUpload ? "Uploading..." : "Upload"}
          </button>
        </form>
      </section>

      <section className="rounded border border-zinc-700 p-4">
        <h2 className="mb-2 text-lg font-medium">2) Ask Questions</h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="text-sm">Mode:</label>
          <select
            className="rounded border border-zinc-600 bg-transparent p-2"
            value={mode}
            onChange={(e) => setMode(e.target.value as "vector" | "hybrid")}
          >
            <option value="vector">vector</option>
            <option value="hybrid">hybrid</option>
          </select>
          <label className="ml-2 text-sm">TopK:</label>
          <input
            type="number"
            min={1}
            max={10}
            className="w-24 rounded border border-zinc-600 bg-transparent p-2"
            value={topK}
            onChange={(e) => setTopK(Number(e.target.value))}
          />
          <label className="ml-2 text-sm">Answer in:</label>
          <select
            className="rounded border border-zinc-600 bg-transparent p-2"
            value={answerLanguage}
            onChange={(e) => setAnswerLanguage(e.target.value as AnswerLanguagePreference)}
            title="Force answer language (Auto = follow question/content)"
          >
            <option value="auto">Auto</option>
            <option value="en">English</option>
            <option value="ar">Arabic</option>
          </select>
        </div>

        <div className="mb-2 flex flex-wrap gap-2">
          {quickQuestions.map((q) => (
            <button
              key={q}
              className="rounded border border-zinc-600 px-3 py-1 text-sm hover:bg-zinc-800"
              onClick={() => ask(q)}
              type="button"
            >
              {q}
            </button>
          ))}
        </div>

        <form
          className="flex flex-col gap-2 md:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <input
            className="flex-1 rounded border border-zinc-600 bg-transparent p-2"
            placeholder="Ask factual questions from the uploaded PDF..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button
            className="rounded bg-emerald-600 px-4 py-2 font-medium text-white disabled:opacity-60"
            disabled={busyAsk || !isLoggedIn || !workspaceId || !question.trim()}
            type="submit"
          >
            {busyAsk ? "Asking..." : "Ask"}
          </button>
        </form>
      </section>

      <p className="text-sm text-zinc-400">{status}</p>

      <section className="space-y-3 pb-10">
        {chat.map((item) => {
          const answerDir = resolveAnswerDir(item.answerLanguage ?? "auto", item.answer);
          return (
            <article
              key={item.id}
              className="rounded border border-zinc-700 p-4"
              dir={answerDir}
            >
              <p className="text-sm text-zinc-400">mode={item.mode}</p>
              <p className="font-medium">Q: {item.question}</p>
              <p className="mt-2 whitespace-pre-wrap" dir={answerDir}>
                A: {item.answer}
              </p>
              <div className="mt-3" dir="ltr">
                <p className="mb-1 text-sm font-medium">Sources</p>
                <ul className="space-y-1 text-sm text-zinc-300">
                  {item.sources.length === 0 && <li>No sources returned.</li>}
                  {item.sources.map((src) => (
                    <li key={src.id} className="rounded bg-zinc-900 p-2">
                      {src.fileName} - {src.id}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
