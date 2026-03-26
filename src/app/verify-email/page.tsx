import { redirect } from "next/navigation";
import { getCurrentUser, createSession, setSessionCookie } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { VerifyEmailClient } from "./verify-email-client";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();

  // Not logged in — go to login
  if (!user) redirect("/login");

  // Check if already verified in DB
  const dbUser = await db
    .select({ emailVerified: users.emailVerified, email: users.email })
    .from(users)
    .where(eq(users.id, user.userId))
    .get();

  if (dbUser?.emailVerified) {
    // Refresh session cookie with verified=true so middleware allows access.
    // This fixes the case where verification happened in a different browser
    // but this browser still has the old verified=false session token.
    const token = await createSession(user.userId, user.email, true);
    await setSessionCookie(token);
    redirect("/onboarding");
  }

  const params = await searchParams;
  const errorCode = params.error;

  let errorMessage: string | null = null;
  if (errorCode === "missing-token") errorMessage = "Verification link is invalid.";
  else if (errorCode === "invalid-token") errorMessage = "Verification link is invalid or has already been used.";
  else if (errorCode === "expired-token") errorMessage = "Verification link has expired. Request a new one below.";

  const maskedEmail = maskEmail(dbUser?.email ?? user.email);

  return <VerifyEmailClient email={maskedEmail} errorMessage={errorMessage} />;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.length <= 2 ? local : local[0] + "•".repeat(Math.min(local.length - 2, 6)) + local[local.length - 1];
  return `${visible}@${domain}`;
}
