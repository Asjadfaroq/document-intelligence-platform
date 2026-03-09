import React from "react";
import { SourceChunkCard } from "./SourceChunkCard";

type Role = "user" | "assistant";

type SourceLike = {
  id: string;
  fileName: string;
  language?: string | null;
  status?: number | null;
  storagePath?: string;
};

export function ChatMessageBubble({
  role,
  content,
  createdAt,
  sources,
  locale = "en",
  rtl = false,
}: {
  role: Role;
  content: string;
  createdAt: string | Date;
  sources?: SourceLike[];
  locale?: "en" | "ar";
  rtl?: boolean;
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

  return (
    <div className={`flex ${alignment}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          isUser
            ? "bg-sky-600 text-white"
            : "bg-zinc-900 text-zinc-50 border border-zinc-700"
        } ${rtl ? "text-right" : "text-left"}`}
      >
        <div className="mb-1 flex items-center justify-between gap-2 text-[11px] opacity-75">
          <span className="font-medium">
            {isUser
              ? locale === "ar"
                ? "أنت"
                : "You"
              : locale === "ar"
              ? "المساعد"
              : "Assistant"}
          </span>
          <span>{timeStr}</span>
        </div>
        <div className="whitespace-pre-wrap text-[13px] leading-relaxed">
          {content}
        </div>
        {!isUser && sources && sources.length > 0 && (
          <div className="mt-2 space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              {locale === "ar" ? "المصادر" : "Sources"}
            </p>
            {sources.map((s) => (
              <SourceChunkCard
                key={s.id}
                source={s}
                locale={locale}
                rtl={rtl}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

