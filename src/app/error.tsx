"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app error boundary]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold text-foreground">
        Something went wrong
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted">
        We hit an unexpected error. You can try again, or head home.
      </p>
      {error.digest && (
        <p className="mt-3 text-xs text-muted/70">
          Reference: {error.digest}
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <button
          onClick={() => reset()}
          className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-black hover:opacity-90"
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-full border border-border bg-surface px-5 py-2 text-sm font-medium text-foreground hover:bg-surface-alt"
        >
          Go home
        </a>
      </div>
    </div>
  );
}
