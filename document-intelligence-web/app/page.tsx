"use client";

import { FormEvent, useMemo, useState } from "react";

type LoginResponse = {
  accessToken: string;
  tenantId: string;
  email: string;
  role: string;
};

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
};

type ChatItem = {
  id: string;
  question: string;
  mode: "vector" | "hybrid";
  answer: string;
  sources: SourceDocument[];
};

const quickQuestions = [
  "What is the candidate's current role?",
  "List the top technical skills from this CV.",
  "Summarize experience in 5 bullet points.",
];

async function readResponseBody(res: Response): Promise<unknown | null> {
  const raw = await res.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function normalizeToken(raw: string): string {
  return raw.replace(/^Bearer\s+/i, "").replace(/\r/g, "").replace(/\n/g, "").trim();
}

function formatError(status: number, body: unknown): string {
  if (typeof body === "string" && body.trim().length > 0) {
    return body;
  }
  if (body && typeof body === "object") {
    return JSON.stringify(body);
  }
  return `Request failed with status ${status}.`;
}

export default function Home() {
  const [apiBase, setApiBase] = useState(
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5224",
  );
  const [tenantSlug, setTenantSlug] = useState("acme");
  const [email, setEmail] = useState("owner@acme.com");
  const [password, setPassword] = useState("Password123!");
  const [token, setToken] = useState("");
  const [role, setRole] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [language, setLanguage] = useState<string>("");
  const [topK, setTopK] = useState(5);
  const [mode, setMode] = useState<"vector" | "hybrid">("hybrid");
  const [question, setQuestion] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [status, setStatus] = useState<string>("");
  const [busyLogin, setBusyLogin] = useState(false);
  const [busyUpload, setBusyUpload] = useState(false);
  const [busyAsk, setBusyAsk] = useState(false);
  const normalizedToken = useMemo(() => normalizeToken(token), [token]);
  const isLoggedIn = Boolean(normalizedToken);

  const canCallApi = useMemo(
    () => Boolean(apiBase.trim() && normalizedToken && workspaceId.trim()),
    [apiBase, normalizedToken, workspaceId],
  );

  async function loadWorkspaces(jwt: string) {
    const res = await fetch(`${apiBase}/workspaces`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    });
    const body = await readResponseBody(res);
    if (!res.ok) {
      throw new Error(formatError(res.status, body));
    }
    const data = Array.isArray(body) ? (body as Workspace[]) : [];
    setWorkspaces(data);
    if (data.length > 0) {
      setWorkspaceId(data[0].id);
    }
  }

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusyLogin(true);
    setStatus("Logging in...");
    try {
      const res = await fetch(`${apiBase}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantSlug: tenantSlug.trim(),
          email: email.trim(),
          password,
        }),
      });
      const body = await readResponseBody(res);
      if (!res.ok) {
        throw new Error(formatError(res.status, body));
      }

      if (!body || typeof body !== "object" || !("accessToken" in body)) {
        throw new Error("Unexpected login response format.");
      }
      const login = body as LoginResponse;
      const jwt = normalizeToken(login.accessToken);
      setToken(jwt);
      setRole(login.role);
      await loadWorkspaces(jwt);
      setStatus("Login successful. Workspace loaded.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusyLogin(false);
    }
  }

  async function handleRefreshWorkspaces() {
    if (!isLoggedIn) {
      setStatus("Login first.");
      return;
    }
    setStatus("Refreshing workspaces...");
    try {
      await loadWorkspaces(normalizedToken);
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

      const res = await fetch(`${apiBase}/documents/upload?${query.toString()}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${normalizedToken}`,
        },
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
      const res = await fetch(`${apiBase}/workspaces/${workspaceId}/ask`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${normalizedToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: q.trim(),
          topK,
          mode,
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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Document Intelligence Q&A</h1>

      <section className="grid gap-3 rounded border border-zinc-700 p-4 md:grid-cols-3">
        <input
          className="rounded border border-zinc-600 bg-transparent p-2"
          placeholder="API base (http://localhost:5224)"
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value)}
        />
        <input
          className="rounded border border-zinc-600 bg-transparent p-2"
          placeholder="Tenant slug"
          value={tenantSlug}
          onChange={(e) => setTenantSlug(e.target.value)}
        />
        <button
          type="button"
          className="rounded border border-zinc-600 p-2 text-sm hover:bg-zinc-800"
          onClick={handleRefreshWorkspaces}
          disabled={!isLoggedIn}
        >
          Refresh Workspaces
        </button>
      </section>

      <section className="rounded border border-zinc-700 p-4">
        <h2 className="mb-2 text-lg font-medium">Login</h2>
        <form className="grid gap-3 md:grid-cols-4" onSubmit={handleLogin}>
          <input
            className="rounded border border-zinc-600 bg-transparent p-2"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="rounded border border-zinc-600 bg-transparent p-2"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <select
            className="rounded border border-zinc-600 bg-transparent p-2"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            disabled={!isLoggedIn || workspaces.length === 0}
          >
            <option value="">
              {isLoggedIn ? "Select workspace" : "Login to load workspaces"}
            </option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.id.slice(0, 8)}...)
              </option>
            ))}
          </select>
          <button
            className="rounded bg-blue-600 p-2 font-medium text-white disabled:opacity-60"
            type="submit"
            disabled={busyLogin}
          >
            {busyLogin ? "Logging in..." : "Login"}
          </button>
        </form>
        {isLoggedIn && (
          <p className="mt-2 text-xs text-zinc-400">
            Logged in as {email} ({role}). Token managed internally.
          </p>
        )}
      </section>

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
        {chat.map((item) => (
          <article key={item.id} className="rounded border border-zinc-700 p-4">
            <p className="text-sm text-zinc-400">
              mode={item.mode}
            </p>
            <p className="font-medium">Q: {item.question}</p>
            <p className="mt-2 whitespace-pre-wrap">A: {item.answer}</p>
            <div className="mt-3">
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
        ))}
      </section>
    </main>
  );
}
