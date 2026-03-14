import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import { Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { getCurrentUser } from "@/lib/auth";
import { MobileMenu } from "@/components/nav/mobile-menu";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "tbr(a) — The Based Reader App",
  description: "Detailed, structured content information for books.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getCurrentUser();

  let userRecord: { displayName: string | null; avatarUrl: string | null } | null = null;
  if (session) {
    const row = await db
      .select({ displayName: users.displayName, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, session.userId))
      .get();
    userRecord = row ?? null;
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${dmSans.variable} ${spaceGrotesk.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          <nav className="sticky top-0 z-50 overflow-visible border-b border-border bg-surface shadow-sm">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
              <Link href="/" className="neon-heading text-xl tracking-tight flex-shrink-0" style={{ fontFamily: "var(--font-heading), system-ui, sans-serif" }}>
                tbr(a)
              </Link>

              {/* Desktop search bar — hidden on mobile */}
              <Link
                href="/search"
                className="hidden sm:flex max-w-sm flex-1 items-center gap-2 rounded-full border border-border bg-surface-alt/60 px-4 py-1.5 text-sm text-muted transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 opacity-60">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Search books...
              </Link>

              <div className="flex items-center gap-2">
                {/* Mobile search icon — visible only on mobile */}
                <Link
                  href="/search"
                  className="flex sm:hidden items-center justify-center rounded-full p-2 text-muted hover:text-foreground transition-colors"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </Link>

                {/* Desktop-only theme toggle */}
                <div className="hidden sm:block">
                  <ThemeToggle />
                </div>

                {session ? (
                  <MobileMenu
                    email={session.email}
                    avatarUrl={userRecord?.avatarUrl}
                    displayName={userRecord?.displayName}
                  />
                ) : (
                  <Link
                    href="/login"
                    className="text-sm text-muted hover:text-foreground transition-colors"
                  >
                    Sign in
                  </Link>
                )}
              </div>
            </div>
          </nav>
          <main className="relative z-0 mx-auto max-w-3xl px-6 py-8">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
