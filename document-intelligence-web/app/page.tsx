"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
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
  "What are the key skills in this CV?",
  "Summarize the document",
  "What technologies are mentioned?",
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
  const [uploadHistory, setUploadHistory] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [streamingChatId, setStreamingChatId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const questionTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
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
      showToast("Tenant switched.", "success");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to switch tenant.";
      setStatus(msg);
      showToast(msg, "error");
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
    showToast("Workspace created.", "success");
    return data.id;
  }

  async function handleRefreshWorkspaces() {
    if (!isLoggedIn) {
      const msg = "Login first.";
      setStatus(msg);
      showToast(msg, "error");
      return;
    }
    setStatus("Refreshing workspaces...");
    try {
      await loadWorkspaces();
      setStatus("Workspaces refreshed.");
      showToast("Workspaces refreshed.", "success");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to refresh workspaces.";
      setStatus(msg);
      showToast(msg, "error");
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
      setUploadHistory((prev) =>
        uploadFile ? [uploadFile.name, ...prev].slice(0, 10) : prev,
      );
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
    setStreamingChatId(null);
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

      const id = crypto.randomUUID();
      setChat((prev) => {
        const next: ChatItem = {
          id,
          question: q.trim(),
          mode,
          answer: json.answer,
          sources: json.sources,
          createdAt,
          answerLanguage,
        };
        return [...prev, next];
      });
      setStreamingChatId(id);
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

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [chat.length]);

  useEffect(() => {
    const el = questionTextAreaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [question]);

  function handleCopyAnswer(answer: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(answer);
    showToast("Answer copied to clipboard.", "success");
  }

  function handleRegenerate(chatItem: ChatItem) {
    void ask(chatItem.question);
  }

  if (!authChecked || !isLoggedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black p-6">
        <p className="text-zinc-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="h-screen bg-gradient-to-b from-[#050816] via-black to-black text-zinc-50" dir={dir}>
      <div className="flex h-screen w-full overflow-hidden">
        {/* Sidebar */}
        <aside className="hidden w-72 flex-col border-r border-zinc-900/80 bg-zinc-950/80 p-4 backdrop-blur md:flex">
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

          <div className="mb-4 space-y-3 text-xs">
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                {locale === "ar" ? "سجل المحادثة" : "Chat history"}
              </p>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-zinc-800/80 bg-zinc-950/40 p-2">
                {chat.length === 0 && (
                  <p className="text-[11px] text-zinc-500">
                    {locale === "ar" ? "لا توجد محادثات بعد." : "No conversations yet."}
                  </p>
                )}
                {chat
                  .slice()
                  .reverse()
                  .slice(0, 8)
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="line-clamp-1 w-full rounded px-2 py-1 text-left text-[11px] text-zinc-300 hover:bg-zinc-800/80"
                      title={item.question}
                      onClick={() => {
                        if (!chatEndRef.current) return;
                        chatEndRef.current.scrollIntoView({
                          behavior: "smooth",
                          block: "end",
                        });
                      }}
                    >
                      {item.question}
                    </button>
                  ))}
              </div>
            </div>

            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                {locale === "ar" ? "سجل الرفع" : "Upload history"}
              </p>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-zinc-800/80 bg-zinc-950/40 p-2">
                {uploadHistory.length === 0 && (
                  <p className="text-[11px] text-zinc-500">
                    {locale === "ar" ? "لا توجد عمليات رفع بعد." : "No uploads yet."}
                  </p>
                )}
                {uploadHistory.map((name, idx) => (
                  <p
                    key={`${name}-${idx}`}
                    className="line-clamp-1 rounded px-2 py-1 text-[11px] text-zinc-300"
                    title={name}
                  >
                    {name}
                  </p>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                {locale === "ar" ? "الإعدادات" : "Settings"}
              </p>
              <div className="space-y-1 rounded-md border border-zinc-800/80 bg-zinc-950/40 p-2">
                <div className="flex items-center justify-between text-[11px] text-zinc-300">
                  <span>{locale === "ar" ? "الوضع الداكن" : "Dark mode"}</span>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
                    {locale === "ar" ? "مفعل" : "On"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-300">
                  <span>{locale === "ar" ? "لغة الواجهة" : "Interface language"}</span>
                  <span className="text-[10px] text-zinc-400">
                    {locale === "ar" ? "العربية" : "English"}
                  </span>
                </div>
              </div>
            </div>
          </div>

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
        <div className="flex-1 flex flex-col p-3 md:p-6">
          <header className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="bg-gradient-to-r from-zinc-50 to-zinc-400 bg-clip-text text-xl font-semibold text-transparent md:text-2xl">
                {locale === "ar" ? "مساعد المستندات الذكي" : "Document Intelligence Assistant"}
              </h2>
              <p className="mt-1 text-xs text-zinc-400 md:text-sm">
                {locale === "ar"
                  ? "ارفع ملفات PDF واسأل أسئلة شبيهة بمحادثات الذكاء الاصطناعي."
                  : "Upload PDFs and chat with an AI that understands your documents."}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleLocale}
              className="rounded-full border border-zinc-700/70 bg-zinc-950/60 px-3 py-1 text-xs text-zinc-300 shadow-sm transition hover:border-zinc-500 hover:bg-zinc-800/80"
            >
              {locale === "ar" ? "English" : "العربية"}
            </button>
          </header>

          <CreateWorkspaceModal
            open={showCreateWorkspaceModal}
            onClose={() => setShowCreateWorkspaceModal(false)}
            onSubmit={handleCreateWorkspaceSubmit}
          />

          <section className="flex flex-1 min-h-0 flex-col rounded-3xl border border-zinc-800/80 bg-gradient-to-b from-zinc-950/60 via-zinc-950/40 to-black/80 p-3 shadow-[0_0_80px_rgba(15,23,42,0.8)] md:p-4 lg:p-6">
            {/* Upload area / empty state */}
            {chat.length === 0 && !uploadFile && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 rounded-2xl border border-dashed border-zinc-700/70 bg-zinc-950/50 p-6 text-center shadow-inner"
              >
                <p className="text-sm font-medium text-zinc-100">
                  {locale === "ar"
                    ? "ارفع المستندات لبدء طرح الأسئلة"
                    : "Upload documents to start asking questions"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {locale === "ar"
                    ? "اسحب وأفلت ملفات PDF هنا، أو استخدم زر التصفح أدناه."
                    : "Drag and drop PDFs here, or use the picker below."}
                </p>
              </motion.div>
            )}

            <form
              onSubmit={handleUpload}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragActive(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const file = e.dataTransfer.files?.[0];
                if (file && file.type === "application/pdf") {
                  setUploadFile(file);
                }
              }}
              className={`mb-3 flex items-center gap-3 rounded-2xl border border-dashed border-zinc-700/70 bg-zinc-950/50 px-3 py-2 text-xs transition hover:border-zinc-500/90 ${
                dragActive ? "border-emerald-500/60 bg-zinc-900/80" : ""
              }`}
            >
              <div className="flex flex-1 items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-sky-500/10 text-emerald-300 shadow-inner">
                  📄
                </span>
                <div className="flex flex-col">
                  <span className="text-[11px] font-medium text-zinc-200">
                    {locale === "ar"
                      ? "اسحب ملف PDF هنا أو انقر للاختيار"
                      : "Drag a PDF here or click to browse"}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {locale === "ar"
                      ? "يتم معالجة المستندات وتحضيرها لأسئلة RAG."
                      : "Documents will be processed and indexed for RAG."}
                  </span>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {uploadFile && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200">
                        <span className="line-clamp-1 max-w-[140px]">
                          {uploadFile.name}
                        </span>
                        <button
                          type="button"
                          className="ml-1 text-[10px] text-emerald-300/80 hover:text-emerald-100"
                          onClick={() => setUploadFile(null)}
                        >
                          ✕
                        </button>
                      </span>
                    )}
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      id="pdf-upload-input"
                      onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                    />
                    <label
                      htmlFor="pdf-upload-input"
                      className="inline-flex cursor-pointer items-center rounded-full border border-zinc-700/80 bg-zinc-900/60 px-2 py-0.5 text-[11px] text-zinc-200 shadow-sm transition hover:border-zinc-500 hover:bg-zinc-800/80"
                    >
                      {locale === "ar" ? "استعراض" : "Browse"}
                    </label>
                    <input
                      className="w-40 rounded-full border border-zinc-700/70 bg-zinc-950/60 px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-500/70 focus:outline-none"
                      placeholder={
                        locale === "ar"
                          ? "اللغة (اختياري: en/ar)"
                          : "Language (optional: en/ar)"
                      }
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <button
                className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-emerald-500 to-sky-500 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg shadow-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busyUpload || !isLoggedIn || !workspaceId || !uploadFile}
                type="submit"
              >
                {busyUpload && (
                  <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-transparent" />
                )}
                {busyUpload
                  ? locale === "ar"
                    ? "جاري الرفع..."
                    : "Uploading..."
                  : locale === "ar"
                  ? "رفع"
                  : "Upload"}
              </button>
            </form>

            {busyUpload && (
              <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900/80">
                <div className="h-full w-1/2 animate-[shimmer_1.4s_infinite] rounded-full bg-gradient-to-r from-emerald-500/70 via-sky-500/80 to-emerald-500/70" />
              </div>
            )}

            {/* Chat area */}
            <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3 md:p-4">
              {/* Top controls and suggestions */}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-300">
                  <span className="rounded-full bg-zinc-900/80 px-2 py-0.5 text-zinc-400">
                    {locale === "ar" ? "الوضع" : "Mode"}
                  </span>
                  <select
                    className="rounded-full border border-zinc-700/70 bg-zinc-950/80 px-2 py-0.5 text-[11px]"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as "vector" | "hybrid")}
                  >
                    <option value="vector">vector</option>
                    <option value="hybrid">hybrid</option>
                  </select>
                  <span className="rounded-full bg-zinc-900/80 px-2 py-0.5 text-zinc-400">
                    TopK
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    className="w-16 rounded-full border border-zinc-700/70 bg-zinc-950/80 px-2 py-0.5 text-[11px]"
                    value={topK}
                    onChange={(e) => setTopK(Number(e.target.value))}
                  />
                  <span className="rounded-full bg-zinc-900/80 px-2 py-0.5 text-zinc-400">
                    {locale === "ar" ? "لغة الإجابة" : "Answer in"}
                  </span>
                  <select
                    className="rounded-full border border-zinc-700/70 bg-zinc-950/80 px-2 py-0.5 text-[11px]"
                    value={answerLanguage}
                    onChange={(e) =>
                      setAnswerLanguage(e.target.value as AnswerLanguagePreference)
                    }
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

              {chat.length === 0 && (
                <div className="mb-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-3 text-[12px] text-zinc-300">
                  <p className="mb-2 font-medium">
                    {locale === "ar"
                      ? "جرّب أحد هذه الأسئلة على مستنداتك:"
                      : "Try asking one of these on your documents:"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {quickQuestions.map((q) => (
                      <button
                        key={q}
                        type="button"
                        className="rounded-full border border-zinc-700/80 bg-zinc-950/80 px-3 py-1 text-[11px] text-zinc-200 transition hover:border-emerald-500/60 hover:bg-emerald-500/10"
                        onClick={() => ask(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Messages list */}
              <div className="mb-2 flex-1 space-y-3 overflow-y-auto pr-1">
                <AnimatePresence initial={false}>
                  {chat.map((item) => {
                    const answerDir = resolveAnswerDir(
                      item.answerLanguage ?? "auto",
                      item.answer,
                    );
                    const answerRtl = answerDir === "rtl";
                    const isStreaming = streamingChatId === item.id;

                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-1.5"
                      >
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
                          streaming={isStreaming}
                          actions={
                            <>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-full border border-zinc-700/70 bg-zinc-900/80 px-2 py-0.5 hover:border-zinc-500 hover:text-zinc-200"
                                onClick={() => handleCopyAnswer(item.answer)}
                              >
                                <span>⧉</span>
                                <span>
                                  {locale === "ar" ? "نسخ" : "Copy"}
                                </span>
                              </button>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-full border border-zinc-700/70 bg-zinc-900/80 px-2 py-0.5 hover:border-emerald-500 hover:text-emerald-300"
                                onClick={() => handleRegenerate(item)}
                              >
                                <span>⟳</span>
                                <span>
                                  {locale === "ar" ? "إعادة توليد" : "Regenerate"}
                                </span>
                              </button>
                            </>
                          }
                        />
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                <div ref={chatEndRef} />
              </div>

              {/* Thinking steps / loader */}
              <AnimatePresence>
                {busyAsk && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    className="mb-2 rounded-2xl border border-zinc-800/80 bg-zinc-950/70 p-3 text-[11px] text-zinc-300"
                  >
                    <p className="mb-2 font-medium">
                      {locale === "ar"
                        ? "المساعد يفكر في إجابتك..."
                        : "The assistant is thinking..."}
                    </p>
                    <ThinkingSteps locale={locale === "ar" ? "ar" : "en"} />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Sticky input */}
              <form
                className="mt-auto flex flex-col gap-2 rounded-2xl border border-zinc-800/80 bg-zinc-950/80 p-2 shadow-[0_0_40px_rgba(15,23,42,0.8)] md:flex-row md:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(question);
                }}
              >
                <div className="flex flex-1 items-end gap-2">
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900/90 text-zinc-300 shadow-sm transition hover:bg-zinc-800"
                    title={
                      locale === "ar"
                        ? "اختيار ملف PDF"
                        : "Attach a PDF"
                    }
                    onClick={() => {
                      const input = document.getElementById(
                        "pdf-upload-input",
                      ) as HTMLInputElement | null;
                      input?.click();
                    }}
                  >
                    📎
                  </button>
                  <div className="relative flex-1">
                    <textarea
                      ref={questionTextAreaRef}
                      className="max-h-32 min-h-[40px] w-full resize-none rounded-2xl border border-zinc-700/80 bg-zinc-950/80 px-3 py-2 text-[13px] leading-relaxed text-zinc-50 placeholder:text-zinc-600 focus:border-emerald-500/70 focus:outline-none"
                      placeholder={
                        locale === "ar"
                          ? "اطرح أسئلة دقيقة حول مستنداتك..."
                          : "Ask precise questions about your documents..."
                      }
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                    />
                    {uploadFile && (
                      <div className="pointer-events-none absolute -top-4 left-2 flex gap-1 text-[10px] text-emerald-300">
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5">
                          <span className="mr-1">●</span>
                          {locale === "ar" ? "سيتم استخدام هذا الملف" : "Using selected file"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <select
                    className="h-9 rounded-full border border-zinc-700/80 bg-zinc-950/80 px-2 text-[11px] text-zinc-200"
                    value={workspaceId}
                    onChange={(e) => setWorkspaceId(e.target.value)}
                  >
                    <option value="">
                      {locale === "ar" ? "مساحة العمل" : "Workspace"}
                    </option>
                    {workspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="inline-flex h-9 items-center justify-center rounded-full bg-gradient-to-r from-emerald-500 to-sky-500 px-5 text-[12px] font-semibold text-white shadow-lg shadow-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={busyAsk || !isLoggedIn || !workspaceId || !question.trim()}
                    type="submit"
                  >
                    {busyAsk ? (
                      <span className="flex items-center gap-2">
                        <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-transparent" />
                        {locale === "ar" ? "جاري التوليد..." : "Generating..."}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span>Ask</span>
                        <span>↩︎</span>
                      </span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function ThinkingSteps({ locale }: { locale: "en" | "ar" }) {
  const steps =
    locale === "ar"
      ? [
          "قراءة المستندات...",
          "البحث في المتجهات الدلالية...",
          "توليد الإجابة...",
        ]
      : ["Reading documents...", "Searching semantic vectors...", "Generating answer..."];

  return (
    <div className="space-y-1.5">
      {steps.map((step, index) => (
        <motion.div
          key={step}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.2, duration: 0.25 }}
          className="flex items-center gap-2"
        >
          <span className="relative inline-flex h-4 w-4 items-center justify-center">
            <span className="absolute inline-flex h-4 w-4 animate-ping rounded-full bg-emerald-500/40" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-[11px] text-zinc-300">{step}</span>
        </motion.div>
      ))}
    </div>
  );
}
