import React, { useState } from "react";

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

  return (
    <div className="rounded border border-zinc-700/50 bg-zinc-900/40 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-1.5 px-2 py-1.5 text-left ${
          rtl ? "flex-row-reverse" : ""
        }`}
      >
        <span className="truncate text-[11px] text-zinc-300">{source.fileName}</span>
        <span className="flex-shrink-0 text-[10px] text-zinc-500">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <div className="border-t border-zinc-700/50 px-2 py-1.5 text-[11px] text-zinc-400">
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

