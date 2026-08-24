/**
 * One-off: ask users whose production accounts vanished whether the deletion
 * was deliberate. Beta app, no audit trail existed at the time (the
 * deleted_accounts table only starts recording from 2026-08-24), so asking is
 * the only way to know.
 *
 * Dry-run by default; --apply actually sends. Sends at most one email per
 * address per run and prints the exact body first.
 */

import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
// EMAIL_FROM must match production branding, not whatever the local file says.
dotenv.config({ path: path.resolve(process.cwd(), ".env.vercel.local"), override: true });

import { Resend } from "resend";

const FROM = process.env.EMAIL_FROM ?? "tbr*a <no-reply@thebasedreader.app>";
const REPLY_TO = "hello@thebasedreader.app";
const APPLY = process.argv.includes("--apply");

interface Target {
  to: string;
  firstName: string;
  libraryLine: string;
}

const TARGETS: Target[] = [
  {
    to: "joannajerowsky@gmail.com",
    firstName: "Joanna",
    libraryLine: "207 books, along with your ratings, reviews and reading history",
  },
  {
    to: "agostina.pomi@gmail.com",
    firstName: "Agostina",
    libraryLine: "1,336 books, along with your ratings, reviews and reading history",
  },
];

function text(t: Target): string {
  return `Hi ${t.firstName},

I'm Rebekah — I build tbr*a. Your account is no longer on our servers, and I
want to be sure that was your decision and not something we broke.

tbr*a is still in beta, so rather than guess, I'd rather just ask.

If you deleted your account on purpose, you don't need to do anything at all.
I'm holding a backup copy of your library from beforehand — ${t.libraryLine} —
and I'll delete that permanently as well, so nothing of yours is left behind.

If you didn't delete it, just reply to this email and I'll restore all of it.

Either way, sorry for the interruption, and thank you for trying the app.

Rebekah
tbr*a — thebasedreader.app`;
}

function html(t: Target): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; font-size: 16px; color: #444; line-height: 1.6;">
      <p style="margin: 0 0 16px;">Hi ${t.firstName},</p>
      <p style="margin: 0 0 16px;">
        I'm Rebekah — I build tbr*a. Your account is no longer on our servers, and I want to
        be sure that was your decision and not something we broke.
      </p>
      <p style="margin: 0 0 16px;">
        tbr*a is still in beta, so rather than guess, I'd rather just ask.
      </p>
      <p style="margin: 0 0 16px;">
        <strong style="color: #111;">If you deleted your account on purpose</strong>, you don't
        need to do anything at all. I'm holding a backup copy of your library from beforehand
        — ${t.libraryLine} — and I'll delete that permanently as well, so nothing of yours is
        left behind.
      </p>
      <p style="margin: 0 0 16px;">
        <strong style="color: #111;">If you didn't delete it</strong>, just reply to this email
        and I'll restore all of it.
      </p>
      <p style="margin: 0 0 24px;">
        Either way, sorry for the interruption, and thank you for trying the app.
      </p>
      <p style="margin: 0; color: #111;">Rebekah</p>
      <p style="margin: 4px 0 0; font-size: 13px; color: #888;">
        tbr*a — <a href="https://thebasedreader.app" style="color: #2563eb; text-decoration: none;">thebasedreader.app</a>
      </p>
    </div>`;
}

async function main() {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY missing");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const subject = "Did you mean to delete your tbr*a account?";

  for (const t of TARGETS) {
    console.log(`\n${"=".repeat(70)}\nTO: ${t.to}\nFROM: ${FROM}\nREPLY-TO: ${REPLY_TO}\nSUBJECT: ${subject}\n${"-".repeat(70)}\n${text(t)}\n`);
    if (!APPLY) { console.log("[dry run — not sent]"); continue; }
    const { data, error } = await resend.emails.send({
      from: FROM, to: t.to, replyTo: REPLY_TO, subject, html: html(t), text: text(t),
    });
    if (error) console.error(`  SEND FAILED for ${t.to}:`, error);
    else console.log(`  SENT — id ${data?.id}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
