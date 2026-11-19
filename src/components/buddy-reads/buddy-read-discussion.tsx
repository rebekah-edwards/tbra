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
  createdAt: string;
}

interface BuddyReadDiscussionProps {
  buddyReadId: string;
  messages: Message[];
  currentUserId: string;
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
}: BuddyReadDiscussionProps) {
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [optimisticMessages, addOptimisticMessage] = useOptimistic(
    messages,
    (state: Message[], newMessage: Message) => [...state, newMessage],
  );

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
                <p className="font-body text-sm leading-relaxed break-words">
                  {msg.message}
                </p>
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
    </div>
  );
}
