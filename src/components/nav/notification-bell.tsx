"use client";

import { useState, useEffect, useRef } from "react";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [ringing, setRinging] = useState(false);
  const [dotPop, setDotPop] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const prevUnreadRef = useRef(0);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Detect new notifications and trigger animations
  useEffect(() => {
    if (unreadCount > 0 && prevUnreadRef.current === 0) {
      setRinging(true);
      setDotPop(true);
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount]);

  const fetchNotificationsRef = useRef<() => Promise<void>>(undefined);
  fetchNotificationsRef.current = async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
      }
    } catch {
      // Silently fail
    }
  };

  useEffect(() => {
    fetchNotificationsRef.current?.();
    const interval = setInterval(() => fetchNotificationsRef.current?.(), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const markAllRead = async () => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // Silently fail
    }
  };

  const markRead = async (id: string) => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch {
      // Silently fail
    }
  };

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1.5 text-muted hover:text-foreground transition-colors tap-scale"
        aria-label="Notifications"
      >
        {/* Bell icon */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={ringing ? "bell-ring" : ""}
          onAnimationEnd={() => setRinging(false)}
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {/* Unread dot */}
        {unreadCount > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-accent text-black text-[9px] font-bold flex items-center justify-center ${dotPop ? "dot-pop" : ""}`}
            onAnimationEnd={() => setDotPop(false)}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-surface border border-border shadow-lg z-50 overflow-hidden popover-enter">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <p className="text-xs font-semibold">Notifications</p>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-[10px] text-link hover:text-link/80"
              >
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-xs text-muted">No notifications yet</p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.read) markRead(n.id);
                  }}
                  className={`w-full text-left px-3 py-2.5 border-b border-border/50 hover:bg-surface-alt/50 transition-colors ${
                    !n.read ? "bg-accent/5" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5 flex-shrink-0" />
                    )}
                    <div className={!n.read ? "" : "pl-3.5"}>
                      <p className="text-xs font-medium">{n.title}</p>
                      <p className="text-[11px] text-muted leading-snug mt-0.5">{n.message}</p>
                      <p className="text-[10px] text-muted/60 mt-1">{timeAgo(n.createdAt)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
