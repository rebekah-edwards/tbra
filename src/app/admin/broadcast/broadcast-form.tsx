"use client";

import { useState, useTransition } from "react";
import { sendBroadcastNotification } from "@/lib/actions/broadcast";

export function BroadcastForm() {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ success: boolean; count?: number; error?: string } | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !message.trim()) return;

    startTransition(async () => {
      const res = await sendBroadcastNotification(title.trim(), message.trim());
      setResult(res);
      if (res.success) {
        setTitle("");
        setMessage("");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-muted mb-1.5">
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., New Feature Available"
          maxLength={100}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
      </div>
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-muted mb-1.5">
          Message
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g., You can now follow your favorite authors and get notified when they publish new books!"
          rows={3}
          maxLength={500}
          className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
        <p className="mt-1 text-[10px] text-muted/50 text-right">{message.length}/500</p>
      </div>

      <button
        type="submit"
        disabled={isPending || !title.trim() || !message.trim()}
        className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-black transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isPending ? "Sending..." : "Send to All Users"}
      </button>

      {result && (
        <div className={`rounded-lg p-3 text-sm ${result.success ? "bg-accent/10 text-accent" : "bg-red-500/10 text-red-400"}`}>
          {result.success
            ? `Sent to ${result.count} users.`
            : result.error || "Failed to send."}
        </div>
      )}
    </form>
  );
}
