"use client";

import { useState } from "react";

export function ShareProfileLink({ username }: { username: string }) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const url = `${window.location.origin}/u/${username}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `@${username} on tbr*a`,
          url,
        });
      } catch {
        // User cancelled share
      }
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      className="text-sm text-primary hover:text-primary-dark"
    >
      {copied ? "Link copied!" : "Share Profile"}
    </button>
  );
}
