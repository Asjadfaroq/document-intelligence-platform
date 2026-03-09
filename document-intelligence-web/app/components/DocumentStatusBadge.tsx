import React from "react";

export type DocumentStatus = "uploaded" | "processing" | "ready" | "failed";

const STATUS_LABELS: Record<DocumentStatus, { en: string; ar: string }> = {
  uploaded: { en: "Uploaded", ar: "تم الرفع" },
  processing: { en: "Processing", ar: "قيد المعالجة" },
  ready: { en: "Ready", ar: "جاهز" },
  failed: { en: "Failed", ar: "فشل" },
};

const STATUS_STYLES: Record<DocumentStatus, string> = {
  uploaded:
    "bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-200",
  processing:
    "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200",
  ready:
    "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200",
  failed:
    "bg-rose-50 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-200",
};

export function mapStatusCode(code?: number | null): DocumentStatus {
  switch (code) {
    case 0:
      return "uploaded";
    case 1:
      return "processing";
    case 2:
      return "ready";
    case 3:
      return "failed";
    default:
      return "uploaded";
  }
}

export function DocumentStatusBadge({
  status,
  locale = "en",
}: {
  status: DocumentStatus;
  locale?: "en" | "ar";
}) {
  const label = STATUS_LABELS[status][locale];
  const base = STATUS_STYLES[status];

  const dotClass =
    status === "failed"
      ? "bg-rose-500"
      : status === "ready"
      ? "bg-emerald-500"
      : status === "processing"
      ? "bg-amber-400 animate-pulse"
      : "bg-blue-500";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${base}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      <span>{label}</span>
    </span>
  );
}

