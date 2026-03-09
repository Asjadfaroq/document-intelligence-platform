import React, { useState } from "react";
import { DocumentStatusBadge, mapStatusCode } from "./DocumentStatusBadge";

type SourceLike = {
  id: string;
  fileName: string;
  language?: string | null;
  status?: number | null;
  storagePath?: string;
};

export function SourceChunkCard({
  source,
  locale = "en",
  rtl = false,
}: {
  source: SourceLike;
  locale?: "en" | "ar";
  rtl?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const status = mapStatusCode(source.status ?? undefined);

  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900/60 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between px-3 py-2 text-left ${
          rtl ? "flex-row-reverse" : ""
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-semibold text-white">
            {source.id.slice(0, 2).toUpperCase()}
          </span>
          <span className="truncate font-medium">{source.fileName}</span>
        </div>
        <div className="flex items-center gap-2">
          <DocumentStatusBadge status={status} locale={locale} />
          <span className="text-[11px] text-zinc-400">
            {open
              ? locale === "ar"
                ? "إخفاء التفاصيل"
                : "Hide details"
              : locale === "ar"
              ? "عرض التفاصيل"
              : "Show details"}
          </span>
        </div>
      </button>
      {open && (
        <div className="border-t border-zinc-700 px-3 py-2 text-[11px] text-zinc-300">
          {source.language && (
            <p className="mb-1">
              <span className="font-semibold">
                {locale === "ar" ? "اللغة:" : "Language:"}
              </span>{" "}
              {source.language}
            </p>
          )}
          {source.storagePath && (
            <p className="break-all">
              <span className="font-semibold">
                {locale === "ar" ? "المسار:" : "Path:"}
              </span>{" "}
              {source.storagePath}
            </p>
          )}
          {!source.language && !source.storagePath && (
            <p className="text-zinc-400">
              {locale === "ar"
                ? "لا توجد تفاصيل إضافية."
                : "No additional details."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

