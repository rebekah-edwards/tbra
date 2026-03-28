import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_ADDRESS = process.env.EMAIL_FROM ?? "tbra <onboarding@resend.dev>";

/**
 * Send an email verification link to a new user.
 */
export async function sendVerificationEmail(
  to: string,
  token: string
): Promise<{ success: boolean; error?: string }> {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const verifyUrl = `${appUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: "Verify your email — tbr*a",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 700; color: #111; margin-bottom: 8px;">
            Welcome to tbr*a
          </h1>
          <p style="font-size: 16px; color: #444; line-height: 1.5; margin-bottom: 24px;">
            Tap the button below to verify your email and unlock the full app.
          </p>
          <a
            href="${verifyUrl}"
            style="display: inline-block; background: #7c3aed; color: #fff; font-weight: 600; font-size: 16px; padding: 12px 32px; border-radius: 8px; text-decoration: none;"
          >
            Verify my email
          </a>
          <p style="font-size: 13px; color: #888; margin-top: 32px; line-height: 1.4;">
            If you didn't create an account, you can safely ignore this email.
            This link expires in 24 hours.
          </p>
          <p style="font-size: 13px; color: #888; line-height: 1.4;">
            Or paste this URL into your browser:<br/>
            <span style="color: #7c3aed; word-break: break-all;">${verifyUrl}</span>
          </p>
        </div>
      `,
    });

    if (error) {
      console.error("[email] Failed to send verification:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("[email] Send error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send email",
    };
  }
}

/**
 * Send a password reset link to a user.
 */
export async function sendPasswordResetEmail(
  to: string,
  token: string
): Promise<{ success: boolean; error?: string }> {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: "Reset your password — tbr*a",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 700; color: #111; margin-bottom: 8px;">
            Reset your password
          </h1>
          <p style="font-size: 16px; color: #444; line-height: 1.5; margin-bottom: 24px;">
            Tap the button below to set a new password for your tbr*a account.
          </p>
          <a
            href="${resetUrl}"
            style="display: inline-block; background: #7c3aed; color: #fff; font-weight: 600; font-size: 16px; padding: 12px 32px; border-radius: 8px; text-decoration: none;"
          >
            Reset password
          </a>
          <p style="font-size: 13px; color: #888; margin-top: 32px; line-height: 1.4;">
            If you didn't request a password reset, you can safely ignore this email.
            This link expires in 1 hour.
          </p>
          <p style="font-size: 13px; color: #888; line-height: 1.4;">
            Or paste this URL into your browser:<br/>
            <span style="color: #7c3aed; word-break: break-all;">${resetUrl}</span>
          </p>
        </div>
      `,
    });

    if (error) {
      console.error("[email] Failed to send password reset:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("[email] Send error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send email",
    };
  }
}

const ADMIN_EMAIL = "rebekah@thebasedreader.app";
const NOTIFICATION_EMAIL = "hello@thebasedreader.app";

/**
 * Send a notification when a new user signs up.
 */
/**
 * Send a daily digest of new signups (replaces per-signup notifications).
 */
export async function sendSignupDigestEmail(
  signups: Array<{ email: string; displayName: string | null; createdAt: string; verified: boolean }>
): Promise<{ success: boolean; error?: string }> {
  if (signups.length === 0) return { success: true };

  const rows = signups
    .map((s) => {
      const name = s.displayName ? ` (${s.displayName})` : "";
      const badge = s.verified ? "✅" : "⏳";
      return `<tr><td style="padding:4px 8px;">${badge}</td><td style="padding:4px 8px;">${s.email}${name}</td><td style="padding:4px 8px;color:#888;">${s.createdAt}</td></tr>`;
    })
    .join("");

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: NOTIFICATION_EMAIL,
      subject: `[tbr*a] ${signups.length} new signup${signups.length !== 1 ? "s" : ""} today`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 20px; font-weight: 700; color: #111; margin-bottom: 16px;">
            ${signups.length} new signup${signups.length !== 1 ? "s" : ""} today
          </h1>
          <table style="font-size: 14px; color: #444; border-collapse: collapse; width: 100%;">
            <tr style="border-bottom: 1px solid #eee;"><th style="padding:4px 8px;text-align:left;">Status</th><th style="padding:4px 8px;text-align:left;">Email</th><th style="padding:4px 8px;text-align:left;">Signed up</th></tr>
            ${rows}
          </table>
          <p style="font-size: 12px; color: #888; margin-top: 24px;">✅ = verified, ⏳ = pending verification</p>
        </div>
      `,
    });

    if (error) {
      console.error("[email] Failed to send signup digest:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("[email] Send error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send email",
    };
  }
}

/**
 * Notify admin when book enrichment fails.
 */
export async function sendEnrichmentFailureEmail(
  bookTitle: string,
  bookId: string,
  errorMessage: string,
  status: string
): Promise<void> {
  const appUrl = process.env.APP_URL ?? "https://www.thebasedreader.app";
  const bookUrl = `${appUrl}/book/${bookId}`;

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: ADMIN_EMAIL,
      subject: `[tbr*a] Enrichment ${status}: ${bookTitle}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 20px; font-weight: 700; color: #111; margin-bottom: 8px;">
            Enrichment ${status === "api_exhausted" ? "API Exhausted" : "Failed"}
          </h1>
          <p style="font-size: 16px; color: #444; line-height: 1.5; margin-bottom: 16px;">
            <strong>${bookTitle}</strong>
          </p>
          <p style="font-size: 14px; color: #666; line-height: 1.5; margin-bottom: 16px;">
            ${errorMessage}
          </p>
          <a
            href="${bookUrl}"
            style="display: inline-block; background: #7c3aed; color: #fff; font-weight: 600; font-size: 14px; padding: 10px 24px; border-radius: 8px; text-decoration: none;"
          >
            View Book
          </a>
          <p style="font-size: 12px; color: #aaa; margin-top: 24px;">
            Book ID: ${bookId}
          </p>
        </div>
      `,
    });
  } catch (err) {
    // Don't let email failure prevent enrichment logging
    console.error("[email] Failed to send enrichment failure notification:", err);
  }
}
