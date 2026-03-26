"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function BackLink() {
  const router = useRouter();
  const [hasHistory, setHasHistory] = useState(false);

  useEffect(() => {
    // Show back link only if user navigated here from another page
    setHasHistory(window.history.length > 1);
  }, []);

  if (!hasHistory) return null;

  return (
    <div className="mb-4">
      <button
        onClick={() => router.back()}
        className="text-sm text-primary hover:text-primary-dark transition-colors"
      >
        &larr; Back
      </button>
    </div>
  );
}
