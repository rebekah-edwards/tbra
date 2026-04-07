import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Outfit } from "next/font/google";
import { Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { ThemeProvider } from "@/components/theme-provider";
// ThemeToggle moved into hamburger menu
import { getCurrentUser, isAdmin, isSuperAdmin } from "@/lib/auth";
import { SearchBar } from "@/components/nav/search-bar";
import { BottomTabs } from "@/components/nav/bottom-tabs";
import { BackButton } from "@/components/nav/back-button";
import { HamburgerMenu } from "@/components/nav/hamburger-menu";
import { DesktopNav } from "@/components/nav/desktop-nav";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { GlobalReportButton } from "@/components/global-report-button";
import { NotificationBell } from "@/components/nav/notification-bell";
import { TextSizeInitializer } from "@/components/settings/text-size-selector";
import Script from "next/script";
import "./globals.css";

const GA_MEASUREMENT_ID = "G-WMF29PM9E2";

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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://thebasedreader.app"),
  title: { default: "tbr*a", template: "%s" },
  description: "Detailed, structured content information for books.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "tbr*a",
  },
  twitter: {
    card: "summary_large_image",
    site: "@thebasedreader",
  },
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getCurrentUser();

  const userIsAdmin = isAdmin(session);
  const userIsSuperAdmin = isSuperAdmin(session);

  // Fetch avatar for bottom nav profile icon — static imports are faster than dynamic
  let avatarUrl: string | null = null;
  let displayName: string | null = null;
  let isVerified = true;
  if (session) {
    const { db } = await import("@/db");
    const { users } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const row = await db
      .select({ avatarUrl: users.avatarUrl, displayName: users.displayName, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, session.userId))
      .get();
    avatarUrl = row?.avatarUrl ?? null;
    displayName = row?.displayName ?? null;
    isVerified = row?.emailVerified ?? false;
  }

  // NOTE: This DB query blocks layout render. The loading.tsx Suspense boundary
  // streams page content, and the PWA splash stays visible until nav renders,
  // preventing the white screen. A future optimization could move this query
  // into a Suspense-wrapped async server component for true non-blocking nav.

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="ga4-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>
      </head>
      <body
        className={`${plusJakarta.variable} ${outfit.variable} ${spaceGrotesk.variable} antialiased bg-background text-foreground`}
      >
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js')})}`
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([
              {
                "@context": "https://schema.org",
                "@type": "Organization",
                "name": "tbr*a",
                "alternateName": "The Based Reader App",
                "url": "https://thebasedreader.app",
                "description": "Detailed content ratings, smart recommendations, and reading tools for readers who care about what they read.",
                "logo": "https://thebasedreader.app/logo.png",
                "sameAs": [
                  "https://www.instagram.com/thebasedreaderapp/",
                  "https://www.tiktok.com/@basedreaderapp",
                  "https://x.com/basedreaderapp",
                ],
                "contactPoint": {
                  "@type": "ContactPoint",
                  "email": "hello@thebasedreader.app",
                  "contactType": "customer support",
                },
                "founder": {
                  "@type": "Person",
                  "name": "Rebekah Edwards",
                  "jobTitle": "Founder",
                  "sameAs": [
                    "https://www.linkedin.com/in/rebekahcreates/",
                    "https://x.com/rebekah_creates",
                  ],
                },
              },
              {
                "@context": "https://schema.org",
                "@type": "WebSite",
                "name": "tbr*a",
                "alternateName": "The Based Reader App",
                "url": "https://thebasedreader.app",
                "potentialAction": {
                  "@type": "SearchAction",
                  "target": "https://thebasedreader.app/search?q={search_term_string}",
                  "query-input": "required name=search_term_string",
                },
              },
            ]),
          }}
        />
        {/* PWA cold-start splash — renders instantly before React hydrates, then auto-hides.
            Spinner-only (no logo) to avoid system-font vs Space Grotesk mismatch on the asterisk. */}
        <div id="pwa-splash" style={{
          position: "fixed", inset: 0, zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "opacity 0.3s ease-out",
        }}>
          <style dangerouslySetInnerHTML={{ __html: `
            #pwa-splash { background: var(--background, #0a0a0f); }
            [data-theme="light"] #pwa-splash { background: var(--background, #fafbfc); }
            #pwa-splash .splash-spinner { width: 24px; height: 24px; border: 2px solid #a3e635; border-top-color: transparent; border-radius: 50%; animation: splash-spin 0.8s linear infinite; }
            @keyframes splash-spin { to { transform: rotate(360deg); } }
          `}} />
          <div className="splash-spinner" />
        </div>
        <script dangerouslySetInnerHTML={{ __html: `
          // Hide splash once real content is visible (nav bar rendered), not just DOM parsed.
          // This prevents the white flash between splash removal and React hydration.
          // We use opacity + pointerEvents instead of remove() to avoid React removeChild errors.
          var splashStart = Date.now();
          function hideSplash() {
            var elapsed = Date.now() - splashStart;
            var delay = Math.max(0, 600 - elapsed);
            setTimeout(function() {
              var s = document.getElementById('pwa-splash');
              if (s) { s.style.opacity = '0'; s.style.pointerEvents = 'none'; }
            }, delay);
          }
          // Poll for the nav element — it means layout HTML has streamed in
          function waitForContent() {
            if (document.querySelector('nav')) return hideSplash();
            // Check every 100ms, give up after 8s
            var checks = 0;
            var interval = setInterval(function() {
              checks++;
              if (document.querySelector('nav') || checks > 80) {
                clearInterval(interval);
                hideSplash();
              }
            }, 100);
          }
          if (document.readyState === 'complete') waitForContent();
          else window.addEventListener('load', waitForContent);
          // Safety net: always hide after 8 seconds max no matter what
          setTimeout(hideSplash, 8000);
        `}} />

        <ThemeProvider>
          <TextSizeInitializer />
          <nav className="sticky top-0 z-50 overflow-visible border-b border-border bg-surface shadow-sm pt-[env(safe-area-inset-top)]">
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
                {session && <NotificationBell />}
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
          <BackButton />
          <PullToRefresh>
            <main className="relative z-0 mx-auto max-w-3xl lg:max-w-[1194px] px-6 pt-8 pb-24 lg:pb-8">{children}</main>
          </PullToRefresh>
          <footer className="hidden lg:block mx-auto max-w-3xl lg:max-w-[1194px] px-6 pb-6 pt-2">
            <p className="text-[10px] text-muted/40 text-center">
              As an Amazon Associate, tbr*a earns from qualifying purchases.
            </p>
          </footer>
          {(userIsSuperAdmin || session?.accountType === "beta_tester") && <GlobalReportButton />}
          {isVerified && <BottomTabs isLoggedIn={!!session} avatarUrl={avatarUrl} />}
        </ThemeProvider>
      </body>
    </html>
  );
}
