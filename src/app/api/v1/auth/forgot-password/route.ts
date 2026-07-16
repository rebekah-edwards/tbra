import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, passwordResetTokens } from "@/db/schema";
import { sendPasswordResetEmail } from "@/lib/email";

/**
 * POST /api/v1/auth/forgot-password — { email }. Same flow as the web
 * requestPasswordReset (1h token + email); always returns ok so email
 * existence never leaks. The reset link itself lands on the web page.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) return NextResponse.json({ error: "Email is required." }, { status: 400 });

  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .get();

  if (user) {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await db.insert(passwordResetTokens).values({
      id: crypto.randomUUID(),
      userId: user.id,
      token,
      expiresAt,
    });
    const emailResult = await sendPasswordResetEmail(email.toLowerCase(), token);
    if (!emailResult.success) {
      console.error(`[v1/forgot-password] email failed for ${email}:`, emailResult.error);
    }
  }

  return NextResponse.json({ ok: true });
}
