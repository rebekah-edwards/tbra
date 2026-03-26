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

const ADMIN_EMAIL = "rebekah@thebasedreader.app";

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
