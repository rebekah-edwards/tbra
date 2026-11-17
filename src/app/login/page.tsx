"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { login } from "@/lib/actions/auth";
import { PasswordInput } from "@/components/ui/password-input";
import { GoogleButton, googleAuthErrorMessage } from "@/components/auth/google-button";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, {});
  const searchParams = useSearchParams();
  const resetSuccess = searchParams.get("reset") === "success";
  const googleError = googleAuthErrorMessage(searchParams.get("error"));

  return (
    <>
    {/* Full-screen loading overlay during login + redirect */}
    {pending && (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center flex-col gap-3 bg-background">
        <span className="logo-gradient font-logo text-2xl tracking-tight">tbr*a</span>
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted">Signing you in...</p>
      </div>
    )}
    <div className="flex flex-col items-center py-16">
      <h1
        className="text-foreground text-3xl font-bold tracking-tight"

      >
        Welcome back
      </h1>
      <p className="mt-2 text-sm text-muted">
        Sign in to your account.
      </p>

      <form action={action} className="card-hairline mt-8 w-full max-w-[26rem] space-y-4 p-5 sm:p-7">
        {googleError && (
          <div className="rounded-2xl border border-intensity-4/30 bg-intensity-4/10 px-4 py-3 text-sm text-intensity-4">
            {googleError}
          </div>
        )}

        <GoogleButton />
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {resetSuccess && (
          <div className="rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-foreground">
            Password reset successfully. Sign in with your new password.
          </div>
        )}

        {state.error && (
          <div className="rounded-2xl border border-intensity-4/30 bg-intensity-4/10 px-4 py-3 text-sm text-intensity-4">
            {state.error}
          </div>
        )}

        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="field-glass w-full"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1">
            Password
          </label>
          <PasswordInput
            id="password"
            name="password"
            required
            autoComplete="current-password"
            placeholder="Your password"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="btn-lime w-full px-4 py-3 text-sm"
        >
          {pending ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              Signing in...
            </span>
          ) : "Sign in"}
        </button>

        <div className="text-center space-y-2">
          <p className="text-xs text-muted">
            <Link href="/forgot-password" className="text-neon-blue hover:text-neon-blue/80">
              Forgot password?
            </Link>
          </p>
          <p className="text-sm text-muted">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-neon-blue hover:text-neon-blue/80">
              Sign up
            </Link>
          </p>
        </div>
      </form>
    </div>
    </>
  );
}
