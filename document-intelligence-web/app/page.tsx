"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getApiBase,
  readResponseBody,
  formatError,
  AuthResponse,
} from "./lib/api";
import CreateWorkspaceModal from "./components/CreateWorkspaceModal";
import { useLanguage } from "./components/LanguageProvider";
import { useToast } from "./components/ToastProvider";
import { ChatMessageBubble } from "./components/ChatMessageBubble";

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
  createdAt: string;
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
  const { locale, dir, toggleLocale } = useLanguage();
  const rtl = dir === "rtl";
  const { showToast } = useToast();
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
      const msg =
        locale === "ar"
          ? "سجل الدخول واختر مساحة عمل ثم ملف PDF أولاً."
          : "Login, select a workspace, and choose a PDF first.";
      setStatus(msg);
      showToast(msg, "error");
      return;
    }

    setBusyUpload(true);
    setStatus(
      locale === "ar"
        ? "جاري الرفع وبدء المعالجة..."
        : "Uploading and enqueueing ingestion...",
    );
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

      const msg =
        locale === "ar"
          ? "تم الرفع. بدأت عملية المعالجة. انتظر حتى تصبح حالة المستند جاهزة."
          : "Upload complete. Ingestion started. Wait until document status is Ready.";
      setStatus(msg);
      showToast(msg, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed.";
      setStatus(msg);
      showToast(msg, "error");
    } finally {
      setBusyUpload(false);
    }
  }

  async function ask(q: string) {
    if (!canCallApi || !q.trim()) {
      const msg =
        locale === "ar"
          ? "سجل الدخول واختر مساحة عمل ثم اكتب سؤالاً."
          : "Login, select a workspace, and enter a question.";
      setStatus(msg);
      showToast(msg, "error");
      return;
    }

    setBusyAsk(true);
    setStatus(
      locale === "ar" ? "جاري تنفيذ استعلام RAG..." : "Running RAG query...",
    );
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

      const createdAt = new Date().toISOString();

      setChat((prev) => {
        const next: ChatItem = {
          id: crypto.randomUUID(),
          question: q.trim(),
          mode,
          answer: json.answer,
          sources: json.sources,
          createdAt,
          answerLanguage,
        };
        return [next, ...prev];
      });
      setQuestion("");
      const msg =
        locale === "ar" ? "تم استلام الإجابة." : "Answer received.";
      setStatus(msg);
      showToast(msg, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ask failed.";
      setStatus(msg);
      showToast(msg, "error");
    } finally {
      setBusyAsk(false);
    }
  }

  if (!authChecked || !isLoggedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black p-6">
        <p className="text-zinc-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-zinc-50" dir={dir}>
      <div className="flex min-h-screen w-full">
        {/* Sidebar */}
        <aside className="hidden w-64 flex-col border-r border-zinc-800 bg-zinc-950 p-4 md:flex">
          <div className="mb-6">
            <h1 className="text-lg font-semibold">
              {locale === "ar" ? "نظام الذكاء المستندي" : "Document Intelligence"}
            </h1>
            <p className="mt-1 text-xs text-zinc-500">
              {email} &middot; {role}
            </p>
          </div>

          <div className="mb-4 space-y-2">
            <p className="text-xs font-semibold uppercase text-zinc-500">
              {locale === "ar" ? "المستأجر" : "Tenant"}
            </p>
            <select
              className="w-full rounded border border-zinc-700 bg-transparent p-2 text-sm"
              value={activeTenantId}
              onChange={(e) => handleSwitchTenant(e.target.value)}
              disabled={tenants.length === 0}
            >
              <option value="">
                {locale === "ar" ? "اختر المستأجر" : "Select tenant"}
              </option>
              {tenants.map((t) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {t.tenantName} ({t.role})
                </option>
              ))}
            </select>
          </div>

          <div className="mb-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase text-zinc-500">
                {locale === "ar" ? "مساحات العمل" : "Workspaces"}
              </p>
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
              <option value="">
                {locale === "ar" ? "اختر مساحة عمل" : "Select workspace"}
              </option>
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
                onClick={() => setShowCreateWorkspaceModal(true)}
              >
                {locale === "ar" ? "مساحة عمل جديدة" : "New workspace"}
              </button>
            )}
          </div>

          <nav className="mb-4 space-y-1 text-sm">
            <Link
              href="/"
              className="block rounded px-3 py-2 text-zinc-200 hover:bg-zinc-800"
            >
              {locale === "ar" ? "لوحة التحكم" : "Dashboard"}
            </Link>
            <Link
              href="/team"
              className="block rounded px-3 py-2 text-zinc-200 hover:bg-zinc-800"
            >
              {locale === "ar" ? "الفريق" : "Team"}
            </Link>
            {canCreateWorkspace && (
              <a
                href="/admin"
                className="block rounded px-3 py-2 text-zinc-200 hover:bg-zinc-800"
              >
                {locale === "ar" ? "التحليلات" : "Admin"}
              </a>
            )}
          </nav>

          <div className="mt-auto space-y-2 text-sm">
            <p className="text-xs font-semibold uppercase text-zinc-500">
              {locale === "ar" ? "الجلسة" : "Session"}
            </p>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full rounded border border-zinc-700 px-3 py-2 text-left text-zinc-200 hover:bg-zinc-800"
            >
              {locale === "ar" ? "تسجيل الخروج" : "Logout"}
            </button>
            {status && (
              <p className="text-xs text-zinc-500 line-clamp-3">{status}</p>
            )}
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 p-4 md:p-6">
          <header className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">
                {locale === "ar" ? "مساحة عمل الأسئلة والأجوبة" : "Q&A Workspace"}
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                {locale === "ar"
                  ? "قم برفع ملفات PDF واطرح أسئلة مركزة."
                  : "Upload PDFs and ask focused questions."}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleLocale}
              className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              {locale === "ar" ? "English" : "العربية"}
            </button>
          </header>

          <CreateWorkspaceModal
            open={showCreateWorkspaceModal}
            onClose={() => setShowCreateWorkspaceModal(false)}
            onSubmit={handleCreateWorkspaceSubmit}
          />

          <section className="mb-4 rounded border border-zinc-700 bg-zinc-950/40 p-4">
            <h3 className="mb-2 text-sm font-medium text-zinc-200">
              {locale === "ar" ? "رفع مستند" : "Upload document"}
            </h3>
            <form className="grid gap-3 md:grid-cols-[1.6fr,1fr,auto]" onSubmit={handleUpload}>
              <input
                type="file"
                accept="application/pdf"
                className="rounded border border-zinc-700 bg-transparent p-2 text-sm"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              />
              <input
                className="rounded border border-zinc-700 bg-transparent p-2 text-sm"
                placeholder={
                  locale === "ar"
                    ? "اللغة (اختياري: en/ar)"
                    : "Language (optional: en/ar)"
                }
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              />
              <button
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                disabled={busyUpload || !isLoggedIn || !workspaceId || !uploadFile}
                type="submit"
              >
                {busyUpload
                  ? locale === "ar"
                    ? "جاري الرفع..."
                    : "Uploading..."
                  : locale === "ar"
                  ? "رفع"
                  : "Upload"}
              </button>
            </form>
          </section>

          <section className="mb-4 rounded border border-zinc-700 bg-zinc-950/40 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-medium text-zinc-200">
                {locale === "ar" ? "اطرح الأسئلة" : "Ask questions"}
              </h3>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <label>{locale === "ar" ? "الوضع" : "Mode"}</label>
                <select
                  className="rounded border border-zinc-700 bg-transparent p-1 text-xs"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "vector" | "hybrid")}
                >
                  <option value="vector">vector</option>
                  <option value="hybrid">hybrid</option>
                </select>
                <label>TopK</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  className="w-16 rounded border border-zinc-700 bg-transparent p-1 text-xs"
                  value={topK}
                  onChange={(e) => setTopK(Number(e.target.value))}
                />
                <label>{locale === "ar" ? "لغة الإجابة" : "Answer in"}</label>
                <select
                  className="rounded border border-zinc-700 bg-transparent p-1 text-xs"
                  value={answerLanguage}
                  onChange={(e) => setAnswerLanguage(e.target.value as AnswerLanguagePreference)}
                  title="Force answer language (Auto = follow question/content)"
                >
                  <option value="auto">
                    {locale === "ar" ? "تلقائي" : "Auto"}
                  </option>
                  <option value="en">
                    {locale === "ar" ? "الإنجليزية" : "English"}
                  </option>
                  <option value="ar">
                    {locale === "ar" ? "العربية" : "Arabic"}
                  </option>
                </select>
              </div>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              {quickQuestions.map((q) => (
                <button
                  key={q}
                  className="rounded border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800"
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
                className="flex-1 rounded border border-zinc-700 bg-transparent p-2 text-sm"
                placeholder={
                  locale === "ar"
                    ? "اطرح أسئلة دقيقة عن ملف الـ PDF المرفوع..."
                    : "Ask factual questions from the uploaded PDF..."
                }
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <button
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                disabled={busyAsk || !isLoggedIn || !workspaceId || !question.trim()}
                type="submit"
              >
                {busyAsk
                  ? locale === "ar"
                    ? "جاري السؤال..."
                    : "Asking..."
                  : locale === "ar"
                  ? "اسأل"
                  : "Ask"}
              </button>
            </form>
          </section>

          <section className="space-y-3 pb-10">
            {chat.map((item) => {
              const answerDir = resolveAnswerDir(
                item.answerLanguage ?? "auto",
                item.answer,
              );
              const answerRtl = answerDir === "rtl";
              return (
                <div key={item.id} className="space-y-2">
                  <ChatMessageBubble
                    role="user"
                    content={item.question}
                    createdAt={item.createdAt}
                    locale={locale === "ar" ? "ar" : "en"}
                    rtl={rtl}
                  />
                  <ChatMessageBubble
                    role="assistant"
                    content={item.answer}
                    createdAt={item.createdAt}
                    sources={item.sources}
                    locale={locale === "ar" ? "ar" : "en"}
                    rtl={answerRtl}
                  />
                </div>
              );
            })}
          </section>
        </div>
      </div>
    </main>
  );
}
