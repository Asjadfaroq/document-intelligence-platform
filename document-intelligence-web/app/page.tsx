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
import ConfirmDeleteModal from "./components/ConfirmDeleteModal";
import { AppFooter } from "./components/AppFooter";
import { useLanguage } from "./components/LanguageProvider";
import { useToast } from "./components/ToastProvider";
import { ChatMessageBubble } from "./components/ChatMessageBubble";
import { DocumentStatusBadge, mapStatusCode } from "./components/DocumentStatusBadge";

type Workspace = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
};

type DocumentInWorkspace = {
  id: string;
  workspaceId: string;
  fileName: string;
  storagePath: string;
  language: string | null;
  status: number;
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
  const [topK, setTopK] = useState(8);
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
  const [uploadJustSucceeded, setUploadJustSucceeded] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [documents, setDocuments] = useState<DocumentInWorkspace[]>([]);
  const [documentsExpanded, setDocumentsExpanded] = useState(false);
  const [deleteDocumentId, setDeleteDocumentId] = useState<string | null>(null);
  const [streamingChatId, setStreamingChatId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const questionTextAreaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!sidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [sidebarOpen]);
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

  useEffect(() => {
    if (!workspaceId || !canCallApi) return;
    void loadDocuments();
  }, [workspaceId, canCallApi]);

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
    if (data.length > 0) {
      setWorkspaceId((prev) => prev || data[0].id);
    } else {
      setWorkspaceId("");
    }
  }

  async function loadDocuments() {
    if (!workspaceId.trim()) {
      setDocuments([]);
      return;
    }
    const res = await fetchWithAuth(
      `${getApiBase()}/documents/workspaces/${workspaceId}`,
    );
    const body = await readResponseBody(res);
    if (!res.ok) {
      setDocuments([]);
      return;
    }
    const data = Array.isArray(body) ? (body as DocumentInWorkspace[]) : [];
    setDocuments(data);
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
    setDocuments([]);
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
      setChat([]);
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

  async function handleDeleteDocument() {
    if (!deleteDocumentId) return;
    const res = await fetchWithAuth(
      `${getApiBase()}/documents/${deleteDocumentId}`,
      { method: "DELETE" },
    );
    if (res.status === 404) {
      setDeleteDocumentId(null);
      await loadDocuments();
      showToast("Document may have been removed. List refreshed.", "info");
      return;
    }
    if (!res.ok) {
      const body = await readResponseBody(res);
      throw new Error(
        typeof body === "object" && body && "error" in body
          ? String((body as { error: string }).error)
          : formatError(res.status, body),
      );
    }
    setDeleteDocumentId(null);
    showToast("Document deleted.", "success");
    await loadDocuments();
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
    if (!canCallApi || !uploadFile || busyUpload) {
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
      setUploadFile(null);
      const fileInput = document.getElementById("pdf-upload-input") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
      setUploadJustSucceeded(true);
      setTimeout(() => setUploadJustSucceeded(false), 3500);
      await loadDocuments();
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
    setQuestion("");
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
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.length]);

  useEffect(() => {
    const el = questionTextAreaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [question]);

  useEffect(() => {
    if (!showSettings) return;
    const close = () => setShowSettings(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [showSettings]);

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
      <main className="app-dark-bg app-grid flex min-h-screen items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500/40 border-t-indigo-400" />
          <p className="text-sm text-zinc-400">Loading...</p>
        </motion.div>
      </main>
    );
  }

  return (
    <main className="app-dark-bg app-grid min-h-dvh text-zinc-50 md:min-h-screen" dir={dir}>
      <div className="flex min-h-dvh w-full overflow-hidden md:min-h-screen">
        {/* Mobile drawer overlay — always in DOM for smooth transition; no backdrop-blur */}
        <div
          className={`drawer-overlay md:hidden ${sidebarOpen ? "is-open" : ""}`}
          onClick={() => setSidebarOpen(false)}
          aria-hidden={!sidebarOpen}
        />
        {/* Sidebar: drawer on mobile, inline on desktop */}
        <aside
          className={`drawer-panel flex flex-col overflow-y-auto p-3 md:flex-shrink-0 ${sidebarOpen ? "is-open" : ""}`}
        >
          <h1 className="mb-4 text-sm font-semibold tracking-tight text-zinc-100">
            {locale === "ar" ? "الذكاء المستندي" : "Doc Intelligence"}
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
                <button
                  type="button"
                  className="rounded-lg bg-zinc-700/60 px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-600/60"
                  onClick={() => setShowCreateWorkspaceModal(true)}
                  title={locale === "ar" ? "مساحة عمل جديدة" : "New workspace"}
                >
                  +
                </button>
              )}
            </div>
          </div>

          <nav className="mt-3 space-y-0.5 border-t border-zinc-800/50 pt-3">
            <Link href="/" className="nav-link block rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200" onClick={() => setSidebarOpen(false)}>
              {locale === "ar" ? "لوحة التحكم" : "Dashboard"}
            </Link>
            <Link href="/team" className="nav-link block rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200" onClick={() => setSidebarOpen(false)}>
              {locale === "ar" ? "الفريق" : "Team"}
            </Link>
            {canCreateWorkspace && (
              <a href="/admin" className="nav-link block rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200" onClick={() => setSidebarOpen(false)}>
                {locale === "ar" ? "التحليلات" : "Admin"}
              </a>
            )}
          </nav>

          <div className="mt-3 flex-1 space-y-1 overflow-hidden border-t border-zinc-800/50 pt-3">
            <p className="text-[10px] font-medium text-zinc-500">
              {locale === "ar" ? "المحادثات" : "Conversations"}
            </p>
            <div className="max-h-32 overflow-y-auto">
              {chat.length === 0 ? (
                <p className="px-2 py-1 text-[11px] text-zinc-600">{locale === "ar" ? "—" : "—"}</p>
              ) : (
                chat.slice().reverse().slice(0, 6).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="line-clamp-1 w-full rounded px-2 py-1 text-left text-[11px] text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300"
                    title={item.question}
                    onClick={() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" })}
                  >
                    {item.question}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="mt-auto border-t border-zinc-800/50 pt-3">
            <button
              type="button"
              onClick={handleLogout}
              className="w-full rounded-lg px-2.5 py-1.5 text-left text-xs text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
            >
              {locale === "ar" ? "تسجيل الخروج" : "Logout"}
            </button>
            <AppFooter variant="compact" />
          </div>
        </aside>

        {/* Main content */}
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden p-2 sm:p-3 md:p-4"
        >
          {/* Mobile header with hamburger */}
          <header className="mb-2 flex items-center justify-between gap-2 sm:mb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200 md:hidden"
                aria-label="Open menu"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <h2 className="truncate text-base font-semibold tracking-tight text-zinc-100 sm:text-lg">
                {locale === "ar" ? "المحادثة" : "Chat"}
              </h2>
            </div>
            <button
              type="button"
              onClick={toggleLocale}
              className="rounded-lg border border-zinc-700/40 bg-zinc-800/30 px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-600 hover:bg-zinc-700/40 hover:text-zinc-200"
            >
              {locale === "ar" ? "EN" : "العربية"}
            </button>
          </header>

          <CreateWorkspaceModal
            open={showCreateWorkspaceModal}
            onClose={() => setShowCreateWorkspaceModal(false)}
            onSubmit={handleCreateWorkspaceSubmit}
          />
          <ConfirmDeleteModal
            open={!!deleteDocumentId}
            onClose={() => setDeleteDocumentId(null)}
            onConfirm={handleDeleteDocument}
            title={locale === "ar" ? "حذف المستند" : "Delete document"}
            description={
              locale === "ar"
                ? "سيتم حذف المستند وكل أجزائه من التخزين. لا يمكن التراجع عن هذا الإجراء."
                : "This will permanently delete the document and all its chunks from storage. This action cannot be undone."
            }
            confirmLabel="Type DELETE to confirm"
            confirmValue="DELETE"
          />

          <section className="glass-surface flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-700/30 shadow-xl shadow-black/20 sm:rounded-2xl">
            {/* Compact upload bar */}
            <form
              onSubmit={handleUpload}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const file = e.dataTransfer.files?.[0];
                if (file?.type === "application/pdf") setUploadFile(file);
              }}
              className={`flex flex-wrap items-center gap-2 border-b border-zinc-700/30 px-2 py-2 transition-colors sm:flex-nowrap sm:px-3 sm:py-2.5 ${
                dragActive ? "bg-indigo-500/5" : ""
              }`}
            >
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                id="pdf-upload-input"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              />
              <label
                htmlFor="pdf-upload-input"
                className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-zinc-600/40 bg-zinc-800/40 px-2.5 py-1.5 text-[11px] text-zinc-400 transition-colors hover:border-zinc-500 hover:bg-zinc-700/40 hover:text-zinc-200"
              >
                <span>📄</span>
                {uploadFile ? (
                  <span className="max-w-[120px] truncate text-zinc-300">{uploadFile.name}</span>
                ) : (
                  <span>{locale === "ar" ? "رفع PDF" : "Upload PDF"}</span>
                )}
              </label>
              {uploadFile && (
                <button
                  type="button"
                  className="text-[10px] text-zinc-500 hover:text-zinc-300"
                  onClick={() => setUploadFile(null)}
                >
                  ✕
                </button>
              )}
              <input
                className="hidden w-24 rounded border border-zinc-700/50 bg-transparent px-2 py-1 text-[11px] text-zinc-400 placeholder:text-zinc-600 focus:outline-none sm:block"
                placeholder="en/ar"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              />
              {workspaceId && documents.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDocumentsExpanded((v) => !v)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-700/50 hover:text-zinc-300"
                  title={documentsExpanded ? (locale === "ar" ? "طي المستندات" : "Collapse documents") : (locale === "ar" ? "عرض المستندات" : "Show documents")}
                  aria-label={documentsExpanded ? "Collapse documents" : "Expand documents"}
                >
                  <svg
                    className={`h-4 w-4 transition-transform ${documentsExpanded ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              )}
              <motion.button
                type="submit"
                disabled={busyUpload || !uploadFile}
                animate={uploadJustSucceeded ? { scale: [1, 1.05, 1] } : {}}
                transition={{ duration: 0.3 }}
                className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-white transition-all duration-300 ${
                  uploadJustSucceeded
                    ? "bg-emerald-500 shadow-md shadow-emerald-500/30"
                    : "bg-indigo-600/80 hover:bg-indigo-500 disabled:opacity-50"
                }`}
              >
                {busyUpload ? (
                  "…"
                ) : uploadJustSucceeded ? (
                  <>
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 500, damping: 25 }}
                    >
                      ✓
                    </motion.span>
                    {locale === "ar" ? "تم الإرسال" : "Submitted"}
                  </>
                ) : (
                  locale === "ar" ? "رفع" : "Upload"
                )}
              </motion.button>
            </form>

            {busyUpload && (
              <div className="h-0.5 w-full overflow-hidden bg-zinc-900">
                <div className="h-full w-1/3 animate-pulse bg-zinc-600/60" />
              </div>
            )}

            {/* Documents in workspace (collapsible, folded by default) */}
            {workspaceId && documents.length > 0 && documentsExpanded && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="border-b border-zinc-700/30 px-3 py-2"
              >
                <p className="mb-1.5 text-[10px] font-medium text-zinc-500">
                  {locale === "ar" ? "مستندات في المساحة" : "Documents in workspace"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {documents.map((document, index) => (
                    <motion.div
                      key={document.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.03 }}
                      className="flex items-center gap-1.5 rounded-lg border border-zinc-700/40 bg-zinc-900/40 px-2.5 py-1.5"
                    >
                      <span className="max-w-[140px] truncate text-[11px] text-zinc-300" title={document.fileName}>
                        {document.fileName}
                      </span>
                      <DocumentStatusBadge status={mapStatusCode(document.status)} locale={locale === "ar" ? "ar" : "en"} />
                      <button
                        type="button"
                        onClick={() => setDeleteDocumentId(document.id)}
                        className="ml-0.5 rounded p-0.5 text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-300"
                        title={locale === "ar" ? "حذف" : "Delete"}
                        aria-label="Delete document"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Chat area */}
            <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
              {/* No workspaces: prompt to create one */}
              {workspaces.length === 0 && (
                <div className="flex flex-1 flex-col items-center justify-center px-4">
                  <p className="mb-2 text-center text-[17px] font-medium tracking-tight text-zinc-300">
                    {locale === "ar" ? "لا توجد مساحات عمل" : "No workspaces yet"}
                  </p>
                  <p className="mb-6 text-center text-sm text-zinc-500">
                    {locale === "ar"
                      ? "أنشئ مساحة عمل من القائمة الجانبية لبدء تحميل المستندات وطرح الأسئلة."
                      : "Create a workspace from the sidebar to start uploading documents and asking questions."}
                  </p>
                  {canCreateWorkspace && (
                    <motion.button
                      type="button"
                      onClick={() => setShowCreateWorkspaceModal(true)}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="rounded-xl border border-indigo-500/50 bg-indigo-500/20 px-5 py-2.5 text-sm font-medium text-indigo-300 shadow-lg shadow-indigo-500/10 transition-colors hover:bg-indigo-500/30"
                    >
                      {locale === "ar" ? "أنشئ مساحة عمل" : "Create workspace"}
                    </motion.button>
                  )}
                </div>
              )}
              {/* Empty state: centered input (ChatGPT-style) — when we have workspaces */}
              {workspaces.length > 0 && chat.length === 0 && (
                <div className="flex flex-1 flex-col items-center justify-center px-4">
                  <p className="mb-8 text-center text-[17px] font-medium tracking-tight text-zinc-300">
                    {locale === "ar"
                      ? "اطرح أسئلة حول مستنداتك"
                      : "Ask questions about your documents"}
                  </p>
                  <form
                    className="w-full max-w-2xl px-2 sm:px-0"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void ask(question);
                    }}
                  >
                    <div className="input-glow flex items-center gap-2 rounded-xl border border-zinc-600/40 bg-zinc-900/60 px-3 py-2 shadow-lg transition-all duration-200 focus-within:border-indigo-500/50 focus-within:bg-zinc-900/80 sm:gap-3 sm:rounded-2xl sm:px-4 sm:py-3">
                      <button
                        type="button"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800/50 hover:text-zinc-300"
                        title={locale === "ar" ? "إرفاق PDF" : "Attach PDF"}
                        onClick={() => document.getElementById("pdf-upload-input")?.click()}
                      >
                        <span className="text-sm">📎</span>
                      </button>
                      <textarea
                        ref={questionTextAreaRef}
                        className="min-h-[24px] max-h-32 flex-1 resize-none bg-transparent text-[14px] leading-[1.5] text-zinc-100 placeholder:text-zinc-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 sm:text-[14px]"
                        placeholder={locale === "ar" ? "اكتب سؤالك هنا..." : "Type your question here..."}
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        disabled={busyAsk}
                      />
                      <div className="relative flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800/50 hover:text-zinc-300"
                          title={locale === "ar" ? "إعدادات" : "Settings"}
                          onClick={(e) => { e.stopPropagation(); setShowSettings((s) => !s); }}
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        </button>
                        {showSettings && (
                          <motion.div
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2 }}
                            className="absolute bottom-full right-0 mb-1 w-48 rounded-lg border border-zinc-700/60 bg-zinc-900 px-2 py-2 shadow-xl"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="space-y-2 text-[11px]">
                              <div className="flex items-center justify-between">
                                <span className="text-zinc-500">Mode</span>
                                <select
                                  className="rounded border border-zinc-700/50 bg-transparent px-1.5 py-0.5 text-zinc-300"
                                  value={mode}
                                  onChange={(e) => setMode(e.target.value as "vector" | "hybrid")}
                                >
                                  <option value="vector">vector</option>
                                  <option value="hybrid">hybrid</option>
                                </select>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-zinc-500">TopK</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={15}
                                  className="w-12 rounded border border-zinc-700/50 bg-transparent px-1.5 py-0.5 text-zinc-300"
                                  value={topK}
                                  onChange={(e) => setTopK(Number(e.target.value))}
                                />
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-zinc-500">Answer</span>
                                <select
                                  className="rounded border border-zinc-700/50 bg-transparent px-1.5 py-0.5 text-zinc-300"
                                  value={answerLanguage}
                                  onChange={(e) => setAnswerLanguage(e.target.value as AnswerLanguagePreference)}
                                >
                                  <option value="auto">Auto</option>
                                  <option value="en">EN</option>
                                  <option value="ar">AR</option>
                                </select>
                              </div>
                            </div>
                          </motion.div>
                        )}
                        <button
                          type="submit"
                          disabled={busyAsk || !workspaceId || !question.trim()}
                          className="flex h-8 items-center justify-center rounded-lg bg-indigo-500 px-3 text-[12px] font-medium text-white shadow-lg shadow-indigo-500/20 transition-all hover:bg-indigo-400 disabled:opacity-50 sm:px-4"
                        >
                          {busyAsk ? (
                            <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
                          ) : (
                            "Ask"
                          )}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              )}

              {/* Messages list (when chat has content) */}
              <div className={`flex-1 space-y-3 overflow-y-auto px-1 pr-1 sm:px-0 ${chat.length === 0 ? "hidden" : "mb-2"}`}>
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
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
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
                                className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-700/50 hover:text-zinc-200"
                                onClick={() => handleCopyAnswer(item.answer)}
                                title={locale === "ar" ? "نسخ" : "Copy"}
                              >
                                Copy
                              </button>
                              <button
                                type="button"
                                className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-700/50 hover:text-indigo-300"
                                onClick={() => handleRegenerate(item)}
                                title={locale === "ar" ? "إعادة توليد" : "Regenerate"}
                              >
                                ⟳
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

              <AnimatePresence>
                {busyAsk && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="mb-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-3 py-2.5"
                  >
                    <ThinkingSteps locale={locale === "ar" ? "ar" : "en"} />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Sticky input (only when chat has messages) */}
              {chat.length > 0 && (
              <form
                className="mt-auto flex items-center gap-2 border-t border-zinc-700/30 bg-zinc-900/20 px-2 pb-[env(safe-area-inset-bottom)] pt-3 sm:gap-3 sm:px-0"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(question);
                }}
              >
                <button
                  type="button"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800/50 hover:text-zinc-300"
                  title={locale === "ar" ? "إرفاق PDF" : "Attach PDF"}
                  onClick={() => document.getElementById("pdf-upload-input")?.click()}
                >
                  <span className="text-sm">📎</span>
                </button>
                <textarea
                  ref={questionTextAreaRef}
                  className="min-h-[36px] max-h-24 flex-1 resize-none rounded-xl border border-zinc-600/40 bg-zinc-800/50 px-3 py-2 text-[14px] leading-[1.5] text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder={locale === "ar" ? "اسأل عن مستنداتك..." : "Ask about your documents..."}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  disabled={busyAsk}
                />
                <div className="relative flex flex-shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300"
                    title={locale === "ar" ? "إعدادات" : "Settings"}
                    onClick={(e) => { e.stopPropagation(); setShowSettings((s) => !s); }}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                  {showSettings && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className="absolute bottom-full right-0 mb-1 w-48 rounded-lg border border-zinc-700/60 bg-zinc-900 px-2 py-2 shadow-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="space-y-2 text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-500">Mode</span>
                          <select
                            className="rounded border border-zinc-700/50 bg-transparent px-1.5 py-0.5 text-zinc-300"
                            value={mode}
                            onChange={(e) => setMode(e.target.value as "vector" | "hybrid")}
                          >
                            <option value="vector">vector</option>
                            <option value="hybrid">hybrid</option>
                          </select>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-500">TopK</span>
                          <input
                            type="number"
                            min={1}
                            max={15}
                            className="w-12 rounded border border-zinc-700/50 bg-transparent px-1.5 py-0.5 text-zinc-300"
                            value={topK}
                            onChange={(e) => setTopK(Number(e.target.value))}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-500">Answer</span>
                          <select
                            className="rounded border border-zinc-700/50 bg-transparent px-1.5 py-0.5 text-zinc-300"
                            value={answerLanguage}
                            onChange={(e) => setAnswerLanguage(e.target.value as AnswerLanguagePreference)}
                          >
                            <option value="auto">Auto</option>
                            <option value="en">EN</option>
                            <option value="ar">AR</option>
                          </select>
                        </div>
                      </div>
                    </motion.div>
                  )}
                  <button
                    type="submit"
                    disabled={busyAsk || !workspaceId || !question.trim()}
                    className="flex h-8 items-center justify-center rounded-lg bg-indigo-500 px-3 text-[12px] font-medium text-white shadow-lg shadow-indigo-500/20 transition-all hover:bg-indigo-400 disabled:opacity-50 sm:px-4"
                  >
                    {busyAsk ? (
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
                    ) : (
                      "Ask"
                    )}
                  </button>
                </div>
              </form>
              )}
            </div>
          </section>
        </motion.div>
      </div>
    </main>
  );
}

function ThinkingSteps({ locale }: { locale: "en" | "ar" }) {
  const [activeStep, setActiveStep] = useState(0);
  const steps =
    locale === "ar"
      ? ["قراءة المستندات", "البحث في المتجهات", "توليد الإجابة"]
      : ["Reading documents", "Searching vectors", "Generating"];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((s) => (s + 1) % steps.length);
    }, 1200);
    return () => clearInterval(interval);
  }, [steps.length]);

  return (
    <div className="flex items-center gap-2.5">
      {/* AI sparkle icon (Lottie-style: four-pointed star + plus) */}
      <div className="ai-sparkle-glow flex h-5 w-5 shrink-0 items-center justify-center">
        <svg
          className="ai-sparkle-icon h-[18px] w-[18px] text-indigo-400"
          viewBox="0 0 24 24"
        >
          {/* Four-pointed star */}
          <path
            d="M12 2l2.5 7.5H22l-6 4.5 2.5 7.5L12 16l-6.5 5.5 2.5-7.5-6-4.5h7.5L12 2z"
            fill="currentColor"
          />
          {/* Plus in center */}
          <path
            d="M12 9v6M9 12h6"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            fill="none"
            opacity="0.85"
          />
        </svg>
      </div>
      {/* Active step text */}
      <motion.span
        key={activeStep}
        initial={{ opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="min-w-0 truncate text-[11px] font-medium tabular-nums text-zinc-400"
      >
        {steps[activeStep]}…
      </motion.span>
    </div>
  );
}
