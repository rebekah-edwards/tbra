"use client";

import { useActionState } from "react";
import { changePassword } from "@/lib/actions/auth";
import { PasswordInput } from "@/components/ui/password-input";

export function ChangePassword() {
  const [state, action, pending] = useActionState(changePassword, {});

  return (
    <div className="card-glass p-5">
      <h2 className="font-heading text-lg font-bold text-foreground mb-3">Change Password</h2>

      <form action={action} className="space-y-3">
        {state.error && (
          <div className="rounded-2xl border border-intensity-4/40 bg-surface/70 px-4 py-3 text-sm text-intensity-4">
            {state.error}
          </div>
        )}

        {state.success && (
          <div className="rounded-2xl border border-emerald-500/40 bg-surface/70 px-4 py-3 text-sm text-emerald-400">
            Password updated successfully.
          </div>
        )}

        <div>
          <label
            htmlFor="currentPassword"
            className="eyebrow mb-1.5 block pl-4"
          >
            Current password
          </label>
          <PasswordInput
            id="currentPassword"
            name="currentPassword"
            required
            autoComplete="current-password"
            placeholder="Your current password"
          />
        </div>

        <div>
          <label
            htmlFor="newPassword"
            className="eyebrow mb-1.5 block pl-4"
          >
            New password
          </label>
          <PasswordInput
            id="newPassword"
            name="newPassword"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="At least 8 characters"
          />
        </div>

        <div>
          <label
            htmlFor="confirmNewPassword"
            className="eyebrow mb-1.5 block pl-4"
          >
            Confirm new password
          </label>
          <PasswordInput
            id="confirmNewPassword"
            name="confirmNewPassword"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Confirm your new password"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          data-active="true"
          className="btn-glass px-5 py-2.5 text-sm disabled:opacity-50"
        >
          {pending ? "Updating..." : "Update password"}
        </button>
      </form>
    </div>
  );
}
