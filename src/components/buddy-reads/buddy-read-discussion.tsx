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
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pb-3">
        {optimisticMessages.length === 0 && (
          <p className="font-body text-sm text-tertiary text-center py-8">
            No messages yet. Start the conversation!
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
                  <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[9px] font-semibold text-accent">
                      {getInitials(msg.displayName)}
                    </span>
                  </div>
                ))}

              {/* Message bubble */}
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                  isOwn
                    ? "bg-accent/15 text-primary"
                    : "bg-surface-hover text-primary"
                }`}
              >
                {!isOwn && (
                  <p className="font-body text-[11px] font-semibold text-secondary mb-0.5">
                    {msg.displayName}
                  </p>
                )}
                <p className="font-body text-sm leading-relaxed break-words">
                  {msg.message}
                </p>
                <p
                  className={`font-body text-[10px] mt-1 ${
                    isOwn ? "text-accent/60 text-right" : "text-tertiary"
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
      <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-background pt-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="flex-1 rounded-full border border-border bg-surface px-4 py-2 text-sm font-body text-primary placeholder:text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={isPending || !input.trim()}
          className="shrink-0 rounded-full bg-accent p-2 text-black transition-opacity disabled:opacity-40"
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
