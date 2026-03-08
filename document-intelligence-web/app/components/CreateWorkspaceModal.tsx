"use client";

import { FormEvent, useEffect, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Returns the new workspace id on success, null on error. */
  onSubmit: (name: string, description: string | null) => Promise<string | null>;
};

export default function CreateWorkspaceModal({ open, onClose, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setError(null);
    }
  }, [open]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await onSubmit(trimmedName, description.trim() || null);
      if (id) {
        onClose();
      } else {
        setError("Failed to create workspace.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workspace.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-workspace-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-zinc-600 bg-zinc-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="create-workspace-title" className="text-lg font-semibold">
            Create workspace
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="workspace-name" className="mb-1 block text-sm text-zinc-400">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              id="workspace-name"
              type="text"
              className="w-full rounded border border-zinc-600 bg-transparent p-2"
              placeholder="Workspace name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="workspace-description" className="mb-1 block text-sm text-zinc-400">
              Description (optional)
            </label>
            <input
              id="workspace-description"
              type="text"
              className="w-full rounded border border-zinc-600 bg-transparent p-2"
              placeholder="Short description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
            />
          </div>
          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-zinc-600 px-4 py-2 text-sm hover:bg-zinc-800"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              disabled={busy || !name.trim()}
            >
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
