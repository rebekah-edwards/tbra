"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function BackLink() {
  const router = useRouter();
  const [hasHistory, setHasHistory] = useState(false);

  useEffect(() => {
    // Only show if user navigated here from within the app (not a direct visit or first page)
    // history.length > 2 avoids showing on direct visits (browser starts with length 1-2)
    setHasHistory(window.history.length > 2);
  }, []);

  if (!hasHistory) return null;

  return (
    <button
      onClick={() => router.back()}
      className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors mb-4"
      aria-label="Go back"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      Back
    </button>
  );
}
