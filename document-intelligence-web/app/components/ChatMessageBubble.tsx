import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { SourceChunkCard } from "./SourceChunkCard";

type Role = "user" | "assistant";

type SourceLike = {
  id: string;
  fileName: string;
  language?: string | null;
  status?: number | null;
  storagePath?: string;
};

/** Renders text with **bold** segments. */
function renderWithBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-zinc-50">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

export function ChatMessageBubble({
  role,
  content,
  createdAt,
  sources,
  locale = "en",
  rtl = false,
  streaming = false,
  actions,
}: {
  role: Role;
  content: string;
  createdAt: string | Date;
  sources?: SourceLike[];
  locale?: "en" | "ar";
  rtl?: boolean;
  streaming?: boolean;
  actions?: React.ReactNode;
}) {
  const isUser = role === "user";
  const date = new Date(createdAt);
  const timeStr = date.toLocaleTimeString(
    locale === "ar" ? "ar-EG" : "en-US",
    { hour: "2-digit", minute: "2-digit" },
  );

  const alignment =
    isUser && !rtl
      ? "justify-end"
      : isUser && rtl
      ? "justify-start"
      : !isUser && !rtl
      ? "justify-start"
      : "justify-end";

  const [displayedContent, setDisplayedContent] = useState(
    streaming ? "" : content,
  );

  useEffect(() => {
    if (!streaming) {
      setDisplayedContent(content);
      return;
    }

    setDisplayedContent("");
    const words = content.split(" ");
    let index = 0;

    const interval = window.setInterval(() => {
      index += 1;
      setDisplayedContent(words.slice(0, index).join(" "));
      if (index >= words.length) {
        window.clearInterval(interval);
      }
    }, 25);

    return () => window.clearInterval(interval);
  }, [content, streaming]);

  return (
    <div className={`group flex ${alignment}`}>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
          isUser
            ? "bg-indigo-500/95 text-white shadow-md"
            : "bg-zinc-800/70 text-zinc-100 border border-zinc-700/30 backdrop-blur-sm"
        } ${rtl ? "text-right" : "text-left"}`}
      >
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-zinc-400">
          <span>{isUser ? (locale === "ar" ? "أنت" : "You") : (locale === "ar" ? "المساعد" : "Assistant")}</span>
          <span className="tabular-nums">{timeStr}</span>
        </div>
        <div className="whitespace-pre-wrap text-[13px] leading-relaxed">
          {isUser ? displayedContent : renderWithBold(displayedContent)}
          {streaming && (
            <span className="ml-1 inline-flex gap-0.5">
              <span className="h-1 w-1 animate-pulse rounded-full bg-zinc-400" />
              <span className="h-1 w-1 animate-pulse rounded-full bg-zinc-500 [animation-delay:100ms]" />
              <span className="h-1 w-1 animate-pulse rounded-full bg-zinc-600 [animation-delay:200ms]" />
            </span>
          )}
        </div>
        {!isUser && sources && sources.length > 0 && (
          <ExpandableSources sources={sources} locale={locale} rtl={rtl} />
        )}
        {actions && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-zinc-600/30 pt-1.5">
            {actions}
          </div>
        )}
      </motion.div>
    </div>
  );
}

function ExpandableSources({
  sources,
  locale,
  rtl,
}: {
  sources: SourceLike[];
  locale: "en" | "ar";
  rtl: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-1.5 rounded px-1.5 py-1 text-[10px] text-zinc-500 hover:bg-zinc-700/40 hover:text-zinc-400 ${
          rtl ? "flex-row-reverse text-right" : "text-left"
        }`}
      >
        <span>{locale === "ar" ? "المصادر" : "Sources"} ({sources.length})</span>
        <span className={`transition-transform ${open ? "rotate-180" : ""}`}>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {sources.map((s) => (
            <SourceChunkCard key={s.id} source={s} locale={locale} rtl={rtl} />
          ))}
        </div>
      )}
    </div>
  );
}

