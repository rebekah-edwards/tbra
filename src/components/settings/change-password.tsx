"use client";

import { useActionState } from "react";
import { changePassword } from "@/lib/actions/auth";

export function ChangePassword() {
  const [state, action, pending] = useActionState(changePassword, {});

  return (
    <div>
      <h2 className="section-heading text-lg mb-3">Change Password</h2>

      <form action={action} className="space-y-3 max-w-sm">
        {state.error && (
          <div className="rounded-lg border border-intensity-4/30 bg-intensity-4/10 px-4 py-3 text-sm text-intensity-4">
            {state.error}
          </div>
        )}

        {state.success && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
            Password updated successfully.
          </div>
        )}

        <div>
          <label
            htmlFor="currentPassword"
            className="block text-sm font-medium mb-1"
          >
            Current password
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-foreground placeholder:text-muted focus:border-neon-blue focus:outline-none focus:ring-1 focus:ring-neon-blue"
            placeholder="Your current password"
          />
        </div>

        <div>
          <label
            htmlFor="newPassword"
            className="block text-sm font-medium mb-1"
          >
            New password
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-foreground placeholder:text-muted focus:border-neon-blue focus:outline-none focus:ring-1 focus:ring-neon-blue"
            placeholder="At least 8 characters"
          />
        </div>

        <div>
          <label
            htmlFor="confirmNewPassword"
            className="block text-sm font-medium mb-1"
          >
            Confirm new password
          </label>
          <input
            id="confirmNewPassword"
            name="confirmNewPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-foreground placeholder:text-muted focus:border-neon-blue focus:outline-none focus:ring-1 focus:ring-neon-blue"
            placeholder="Confirm your new password"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {pending ? "Updating..." : "Update password"}
        </button>
      </form>
    </div>
  );
}
