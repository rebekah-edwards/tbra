"use client";

import { useState, useTransition } from "react";
import { resendVerificationEmail } from "@/lib/actions/auth";

interface Props {
  email: string;
  errorMessage: string | null;
}

export function VerifyEmailClient({ email, errorMessage }: Props) {
  const [isPending, startTransition] = useTransition();
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(errorMessage);

  function handleResend() {
    setError(null);
    setResent(false);
    startTransition(async () => {
      const result = await resendVerificationEmail();
      if (result.error) {
        setError(result.error);
      } else {
        setResent(true);
      }
    });
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        {/* Email icon */}
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-primary"
          >
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M22 7l-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7" />
          </svg>
        </div>

        <h1
          className="text-foreground text-2xl font-bold tracking-tight"
         
        >
          Check your email
        </h1>

        <p className="mt-3 text-sm text-muted leading-relaxed">
          We sent a verification link to{" "}
          <span className="font-medium text-foreground">{email}</span>.
          <br />
          Click the link to verify your email and get started.
        </p>

        {error && (
          <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2.5">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {resent && (
          <div className="mt-4 rounded-lg bg-green-500/10 border border-green-500/20 px-4 py-2.5">
            <p className="text-sm text-green-400">
              Verification email sent! Check your inbox (and spam folder).
            </p>
          </div>
        )}

        <div className="mt-8 space-y-3">
          <button
            onClick={handleResend}
            disabled={isPending}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-background hover:brightness-110 transition-all disabled:opacity-50"
          >
            {isPending ? "Sending..." : "Resend verification email"}
          </button>

          <p className="text-xs text-muted/60">
            Didn't get it? Check your spam folder or try resending.
          </p>
        </div>
      </div>
    </div>
  );
}
