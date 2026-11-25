"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import {
  resetLibrary,
  deleteAccount,
  deleteTbrPile,
  deleteOwnedBooks,
} from "@/lib/actions/account";

interface DangerAction {
  key: string;
  title: string;
  description: string;
  confirmPhrase: string;
  buttonLabel: string;
  action: (phrase: string) => Promise<{ success: boolean; error?: string }>;
  redirectAfter?: string;
}

const DANGER_ACTIONS: DangerAction[] = [
  {
    key: "resetLibrary",
    title: "Reset Library",
    description:
      "Permanently deletes all your books, ratings, reviews, reading sessions, notes, goals, favorites, and reading progress. Your account and profile will be kept.",
    confirmPhrase: "reset my library",
    buttonLabel: "Reset Library",
    action: resetLibrary,
  },
  {
    key: "deleteAccount",
    title: "Delete Account",
    description:
      "Permanently deletes your account and all associated data. This cannot be undone.",
    confirmPhrase: "delete my account",
    buttonLabel: "Delete Account",
    action: deleteAccount,
    redirectAfter: "/",
  },
  {
    key: "deleteTbr",
    title: "Delete TBR Pile",
    description:
      "Removes all books marked as 'to be read' and clears your Up Next queue.",
    confirmPhrase: "delete tbr",
    buttonLabel: "Delete TBR",
    action: deleteTbrPile,
  },
  {
    key: "deleteOwned",
    title: "Delete Owned Books",
    description:
      "Clears all owned edition records and format selections from your library.",
    confirmPhrase: "delete owned",
    buttonLabel: "Delete Owned",
    action: deleteOwnedBooks,
  },
];

interface AccountSettingsProps {
  userEmail: string;
}

export function AccountSettings({ userEmail }: AccountSettingsProps) {
  const router = useRouter();
  const [activeAction, setActiveAction] = useState<DangerAction | null>(null);
  const [confirmInput, setConfirmInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const handleClose = useCallback(() => {
    if (loading) return;
    setActiveAction(null);
    setConfirmInput("");
  }, [loading]);

  const handleConfirm = useCallback(async () => {
    if (!activeAction) return;
    setLoading(true);
    setFlash(null);

    try {
      const result = await activeAction.action(confirmInput);
      if (result.success) {
        setActiveAction(null);
        setConfirmInput("");

        if (activeAction.redirectAfter) {
          router.push(activeAction.redirectAfter);
          return;
        }

        setFlash({ type: "success", message: `${activeAction.title} completed successfully.` });
        router.refresh();
      } else {
        setFlash({ type: "error", message: result.error ?? "Something went wrong" });
      }
    } catch {
      setFlash({ type: "error", message: "Something went wrong" });
    } finally {
      setLoading(false);
    }
  }, [activeAction, confirmInput, router]);

  const phraseMatches = activeAction
    ? confirmInput.toLowerCase().trim() === activeAction.confirmPhrase
    : false;

  return (
    <div className="space-y-6">
      {/* Flash message */}
      {flash && (
        <div
          className={`p-3 rounded-2xl text-sm font-medium text-center ${
            flash.type === "success"
              ? "bg-surface/70 border border-emerald-500/40 text-emerald-400"
              : "bg-surface/70 border border-destructive/40 text-destructive"
          }`}
        >
          {flash.message}
        </div>
      )}

      {/* Account info */}
      <div className="card-glass flex items-center gap-3 p-4">
        <span className="orb-glass h-10 w-10 text-neon-blue">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-10 6L2 7" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="eyebrow">Account</p>
          <p className="truncate text-sm text-foreground">{userEmail}</p>
        </div>
      </div>

      {/* Danger zone */}
      <div className="space-y-3">
        <p className="eyebrow pl-1 !text-destructive">Danger zone</p>

        <div className="card-glass divide-y divide-destructive/20 overflow-hidden" style={{ borderColor: "color-mix(in srgb, var(--destructive, #ef4444) 35%, transparent)" }}>
          {DANGER_ACTIONS.map((action) => (
            <div
              key={action.key}
              className="flex items-center justify-between gap-4 p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {action.title}
                </p>
                <p className="text-xs text-muted mt-0.5 leading-snug">
                  {action.description}
                </p>
              </div>
              <button
                onClick={() => {
                  setFlash(null);
                  setActiveAction(action);
                  setConfirmInput("");
                }}
                className="btn-glass shrink-0 px-3.5 py-1.5 text-xs !text-destructive"
                style={{ ["--ring" as string]: "#ef4444" }}
                data-active="true"
              >
                {action.buttonLabel}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Confirmation bottom sheet */}
      <BottomSheet
        open={!!activeAction}
        onClose={handleClose}
        title={activeAction?.title ?? "Confirm"}
      >
        {activeAction && (
          <div className="p-5 space-y-4">
            {/* Warning */}
            <div className="rounded-2xl border border-destructive/40 bg-surface/70 p-3 text-center">
              <p className="text-sm text-foreground font-medium">
                This action is permanent and cannot be undone.
              </p>
              <p className="text-xs text-muted mt-1 leading-snug">
                {activeAction.description}
              </p>
            </div>

            {/* Confirmation input */}
            <div className="space-y-2">
              <label className="block pl-4 text-xs text-muted">
                Type{" "}
                <span className="font-mono font-semibold text-foreground">
                  {activeAction.confirmPhrase}
                </span>{" "}
                to confirm
              </label>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder={activeAction.confirmPhrase}
                disabled={loading}
                className="field-glass w-full text-base focus:!border-destructive"
                autoFocus
              />
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                disabled={loading}
                className="btn-glass flex-1 px-4 py-2.5 text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!phraseMatches || loading}
                className="flex-1 rounded-full bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Processing…
                  </span>
                ) : (
                  `Confirm ${activeAction.buttonLabel}`
                )}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
