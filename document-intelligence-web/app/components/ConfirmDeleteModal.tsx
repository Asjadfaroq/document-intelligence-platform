"use client";

import { useState, FormEvent, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmValue?: string;
};

export default function ConfirmDeleteModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Type DELETE to confirm",
  confirmValue = "DELETE",
}: Props) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setValue("");
      setError(null);
    }
  }, [open]);

  const isValid = value === confirmValue;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid || busy) return;
    setError(null);
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-title"
        >
          <button
            type="button"
            className="absolute inset-0"
            onClick={onClose}
            aria-label="Close"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-md rounded-2xl border border-zinc-700/60 bg-zinc-900/95 p-6 shadow-2xl ring-1 ring-white/5"
          >
        <h2 id="confirm-delete-title" className="text-lg font-semibold text-zinc-100">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          {description}
        </p>
        <form onSubmit={handleSubmit} className="mt-5">
          <label htmlFor="confirm-input" className="block text-xs font-medium text-zinc-500">
            {confirmLabel}
          </label>
          <input
            id="confirm-input"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-zinc-600/60 bg-zinc-800/80 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500/40"
            placeholder={confirmValue}
            autoFocus
            disabled={busy}
            autoComplete="off"
          />
          {error && (
            <p className="mt-2 text-sm text-red-400">{error}</p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-600/60 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800/80"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isValid || busy}
              className="rounded-lg bg-red-600/90 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-40 disabled:hover:bg-red-600/90"
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
