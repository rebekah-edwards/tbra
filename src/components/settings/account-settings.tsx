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
          className={`p-3 rounded-lg text-sm font-medium ${
            flash.type === "success"
              ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
              : "bg-destructive/10 border border-destructive/30 text-destructive"
          }`}
        >
          {flash.message}
        </div>
      )}

      {/* Account info */}
      <div className="border border-border bg-surface p-4 space-y-1">
        <h2 className="section-heading text-lg">
          Account
        </h2>
        <p className="text-sm text-foreground">{userEmail}</p>
      </div>

      {/* Danger zone */}
      <div className="space-y-3">
        <h2 className="section-heading text-destructive text-lg">
          Danger Zone
        </h2>

        <div className="border border-destructive/30 rounded-xl divide-y divide-destructive/20 overflow-hidden">
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
                className="shrink-0 text-xs font-medium px-3 py-1.5 border border-destructive text-destructive rounded-md hover:bg-destructive hover:text-white transition-colors"
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
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
              <p className="text-sm text-foreground font-medium">
                This action is permanent and cannot be undone.
              </p>
              <p className="text-xs text-muted mt-1 leading-snug">
                {activeAction.description}
              </p>
            </div>

            {/* Confirmation input */}
            <div className="space-y-2">
              <label className="text-xs text-muted">
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
                className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-destructive"
                autoFocus
              />
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                disabled={loading}
                className="flex-1 text-sm font-medium px-4 py-2.5 border border-border rounded-lg text-foreground hover:bg-surface-alt transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!phraseMatches || loading}
                className="flex-1 text-sm font-medium px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
