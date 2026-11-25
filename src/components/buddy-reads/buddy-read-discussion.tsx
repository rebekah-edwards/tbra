"use client";

import { useState, useTransition, useOptimistic, useRef, useEffect } from "react";
import Image from "next/image";
import { timeAgo } from "@/lib/date-utils";
import { postBuddyReadMessage } from "@/lib/actions/buddy-reads";

interface Message {
  id: string;
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  message: string;
  /** 'message' | 'progress' | 'status' */
  kind?: string;
  createdAt: string;
}

interface BuddyReadDiscussionProps {
  buddyReadId: string;
  messages: Message[];
  currentUserId: string;
  /** Finished or cancelled buddy reads keep their history but take no new posts. */
  readOnly?: boolean;
}

/**
 * Reading updates are stored as "Reading update (p. 120, 45%): note". Older
 * rows (before the `kind` column) carried a "📖 " prefix and kind 'message'.
 */
function parseProgress(msg: Message): { progress: string | null; note: string } | null {
  const text = msg.message.replace(/^📖\s*/, "");
  const isProgress = msg.kind === "progress" || /^📖\s*Reading update/.test(msg.message);
  if (!isProgress) return null;
  const m = text.match(/^Reading update(?:\s*\(([^)]*)\))?:?\s*([\s\S]*)$/);
  if (!m) return { progress: null, note: text };
  return { progress: m[1] ?? null, note: m[2] ?? "" };
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function BuddyReadDiscussion({
  buddyReadId,
  messages,
  currentUserId,
  readOnly = false,
}: BuddyReadDiscussionProps) {
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [optimisticMessages, addOptimisticMessage] = useOptimistic(
    messages,
    (state: Message[], newMessage: Message) => [...state, newMessage],
  );

  // Scroll to the newest message when one is added — not on first render,
  // which used to yank the whole page down to the discussion on open.
  const seenCount = useRef(optimisticMessages.length);
  useEffect(() => {
    if (optimisticMessages.length > seenCount.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    seenCount.current = optimisticMessages.length;
  }, [optimisticMessages.length]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;

    setInput("");

    startTransition(async () => {
      addOptimisticMessage({
        id: `optimistic-${Date.now()}`,
        userId: currentUserId,
        displayName: "You",
        username: "",
        avatarUrl: null,
        message: text,
        kind: "message",
        createdAt: new Date().toISOString(),
      });

      await postBuddyReadMessage(buddyReadId, text);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-full flex-col rounded-[18px] border border-foreground/10 bg-surface/60 p-3 backdrop-blur-md">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pb-3">
        {optimisticMessages.length === 0 && (
          <p className="font-body text-sm text-muted text-center py-8">
            No messages yet. Say hi and start the conversation.
          </p>
        )}

        {optimisticMessages.map((msg) => {
          const isOwn = msg.userId === currentUserId;

          // Automatic event: a centred one-liner, not a chat bubble.
          if (msg.kind === "status") {
            return (
              <div key={msg.id} className="flex justify-center">
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-foreground/10 bg-surface/70 px-3 py-1 text-[11px] text-muted backdrop-blur-md">
                  <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-neon-blue" aria-hidden="true" />
                  <span className="truncate">
                    <span className="font-semibold text-foreground">{msg.message}</span>
                    {" · "}
                    {timeAgo(msg.createdAt)}
                  </span>
                </span>
              </div>
            );
          }

          const progress = parseProgress(msg);

          return (
            <div
              key={msg.id}
              className={`flex gap-2 ${isOwn ? "flex-row-reverse" : ""}`}
            >
              {/* Avatar */}
              {!isOwn &&
                (msg.avatarUrl ? (
                  <Image
                    src={msg.avatarUrl}
                    alt={msg.displayName}
                    width={28}
                    height={28}
                    className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full border border-foreground/12 bg-surface/80 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[9px] font-bold text-foreground">
                      {getInitials(msg.displayName)}
                    </span>
                  </div>
                ))}

              {/* Message bubble */}
              <div
                className={`max-w-[75%] rounded-[18px] border px-3 py-2 text-foreground ${
                  isOwn
                    ? "rounded-br-md border-accent/40 bg-accent/10"
                    : "rounded-bl-md border-foreground/10 bg-surface/90"
                }`}
              >
                {!isOwn && (
                  <p className="font-body text-[11px] font-semibold text-muted mb-0.5">
                    {msg.displayName}
                  </p>
                )}
                {progress ? (
                  <>
                    <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-foreground">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neon-blue" aria-hidden="true">
                        <path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" />
                        <path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" />
                      </svg>
                      Reading update
                      {progress.progress && (
                        <span className="rounded-full border border-foreground/12 bg-surface/70 px-1.5 py-px text-[10px] font-medium text-muted">
                          {progress.progress}
                        </span>
                      )}
                    </p>
                    {progress.note && (
                      <p className="mt-1 font-body text-sm leading-relaxed break-words whitespace-pre-line">{progress.note}</p>
                    )}
                  </>
                ) : (
                  <p className="font-body text-sm leading-relaxed break-words whitespace-pre-line">
                    {msg.message}
                  </p>
                )}
                <p
                  className={`font-body text-[10px] mt-1 ${
                    isOwn ? "text-foreground/50 text-right" : "text-muted/60"
                  }`}
                >
                  {timeAgo(msg.createdAt)}
                </p>
              </div>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {readOnly ? (
        <p className="border-t border-foreground/10 pt-3 text-center text-xs text-muted">
          This buddy read has ended, so the discussion is closed.
        </p>
      ) : (
      <div className="sticky bottom-0 flex items-center gap-2 border-t border-foreground/10 pt-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="field-glass !h-11 min-w-0 flex-1 text-sm"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={isPending || !input.trim()}
          className="btn-lime h-11 w-11 shrink-0 cursor-pointer disabled:!opacity-40"
          aria-label="Send message"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
            />
          </svg>
        </button>
      </div>
      )}
    </div>
  );
}
