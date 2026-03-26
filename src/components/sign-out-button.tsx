"use client";

import { logout } from "@/lib/actions/auth";

export function SignOutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        className="text-sm text-muted hover:text-destructive transition-colors"
      >
        Sign out
      </button>
    </form>
  );
}
