"use server";

import { Resend } from "resend";
import { getCurrentUser } from "@/lib/auth";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_ADDRESS = process.env.EMAIL_FROM ?? "tbra <onboarding@resend.dev>";

// CONTACT FORM RECIPIENT — change this email when ready
const CONTACT_EMAIL = "no-reply@thebasedreader.app";

// Simple in-memory rate limit: one submission per hour per IP/user
const recentSubmissions = new Map<string, number>();

// Clean up old entries every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, ts] of recentSubmissions) {
    if (ts < cutoff) recentSubmissions.delete(key);
  }
}, 10 * 60 * 1000);

export async function submitContactForm(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const name = (formData.get("name") as string)?.trim();
  const email = (formData.get("email") as string)?.trim();
  const subject = (formData.get("subject") as string)?.trim();
  const message = (formData.get("message") as string)?.trim();

  if (!name || !email || !subject || !message) {
    return { success: false, error: "All fields are required" };
  }

  if (message.length > 5000) {
    return { success: false, error: "Message is too long (max 5000 characters)" };
  }

  // Rate limit by user ID or email
  const session = await getCurrentUser();
  const rateLimitKey = session?.userId ?? email;

  const lastSubmission = recentSubmissions.get(rateLimitKey);
  if (lastSubmission && Date.now() - lastSubmission < 60 * 60 * 1000) {
    return {
      success: false,
      error: "You can only submit one message per hour. Please try again later.",
    };
  }

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: CONTACT_EMAIL,
      replyTo: email,
      subject: `[Contact] ${subject}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="font-size: 20px; font-weight: 700; color: #111; margin-bottom: 16px;">
            New Contact Form Submission
          </h2>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
            <tr>
              <td style="padding: 8px 12px; font-weight: 600; color: #444; vertical-align: top; width: 100px;">Name</td>
              <td style="padding: 8px 12px; color: #111;">${escapeHtml(name)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; font-weight: 600; color: #444; vertical-align: top;">Email</td>
              <td style="padding: 8px 12px; color: #111;"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td>
            </tr>
            ${session ? `<tr>
              <td style="padding: 8px 12px; font-weight: 600; color: #444; vertical-align: top;">User ID</td>
              <td style="padding: 8px 12px; color: #111; font-family: monospace; font-size: 13px;">${escapeHtml(session.userId)}</td>
            </tr>` : ""}
            <tr>
              <td style="padding: 8px 12px; font-weight: 600; color: #444; vertical-align: top;">Subject</td>
              <td style="padding: 8px 12px; color: #111;">${escapeHtml(subject)}</td>
            </tr>
          </table>
          <div style="background: #f4f4f6; border-radius: 8px; padding: 16px; color: #222; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(message)}</div>
        </div>
      `,
    });

    if (error) {
      console.error("[contact] Failed to send:", error);
      return { success: false, error: "Failed to send message. Please try again." };
    }

    recentSubmissions.set(rateLimitKey, Date.now());
    return { success: true };
  } catch (err) {
    console.error("[contact] Send error:", err);
    return {
      success: false,
      error: "Something went wrong. Please try again later.",
    };
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
