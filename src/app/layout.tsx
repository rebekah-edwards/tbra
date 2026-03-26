import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Outfit } from "next/font/google";
import { Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { ThemeProvider } from "@/components/theme-provider";
// ThemeToggle moved into hamburger menu
import { getCurrentUser, isAdmin, isSuperAdmin } from "@/lib/auth";
import { SearchBar } from "@/components/nav/search-bar";
import { BottomTabs } from "@/components/nav/bottom-tabs";
import { HamburgerMenu } from "@/components/nav/hamburger-menu";
import { DesktopNav } from "@/components/nav/desktop-nav";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { GlobalReportButton } from "@/components/global-report-button";
import { TextSizeInitializer } from "@/components/settings/text-size-selector";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const outfit = Outfit({
  variable: "--font-heading",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-logo",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "tbr*a", template: "%s" },
  description: "Detailed, structured content information for books.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getCurrentUser();

  const userIsAdmin = isAdmin(session);
  const userIsSuperAdmin = isSuperAdmin(session);

  // Fetch avatar for bottom nav profile icon
  let avatarUrl: string | null = null;
  let displayName: string | null = null;
  if (session) {
    const { db } = await import("@/db");
    const { users } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const row = await db
      .select({ avatarUrl: users.avatarUrl, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, session.userId))
      .get();
    avatarUrl = row?.avatarUrl ?? null;
    displayName = row?.displayName ?? null;
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${plusJakarta.variable} ${outfit.variable} ${spaceGrotesk.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          <TextSizeInitializer />
          <nav className="sticky top-0 z-50 overflow-visible border-b border-border bg-surface shadow-sm">
            <div className="mx-auto flex max-w-3xl lg:max-w-[1194px] items-center justify-between gap-4 px-6 py-3">
              <Link href="/" className="logo-gradient font-logo text-xl tracking-tight flex-shrink-0">
                tbr*a
              </Link>

              <DesktopNav isLoggedIn={!!session} avatarUrl={avatarUrl} displayName={displayName} />

              <div className="flex items-center gap-2">
                {!session && (
                  <Link
                    href="/signup"
                    className="lg:hidden rounded-full bg-accent px-3 py-1 text-xs font-semibold text-black hover:brightness-110 transition-all"
                  >
                    Sign Up
                  </Link>
                )}
                <SearchBar isLoggedIn={!!session} />
                <HamburgerMenu isLoggedIn={!!session} isAdmin={userIsAdmin} isSuperAdmin={userIsSuperAdmin} avatarUrl={avatarUrl} displayName={displayName} />
                {!session && (
                  <div className="hidden lg:flex items-center gap-3">
                    <Link
                      href="/login"
                      className="text-sm text-muted hover:text-foreground transition-colors"
                    >
                      Sign in
                    </Link>
                    <Link
                      href="/signup"
                      className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-black hover:brightness-110 transition-all"
                    >
                      Sign Up
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </nav>
          <PullToRefresh>
            <main className="relative z-0 mx-auto max-w-3xl lg:max-w-[1194px] px-6 pt-8 pb-24 lg:pb-8">{children}</main>
          </PullToRefresh>
          {userIsSuperAdmin && <GlobalReportButton />}
          <BottomTabs isLoggedIn={!!session} avatarUrl={avatarUrl} />
        </ThemeProvider>
      </body>
    </html>
  );
}
