import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Young_Serif } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const youngSerif = Young_Serif({
  variable: "--font-young-serif",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "tbr(a) — The Based Reader App",
  description: "Detailed, structured content information for books.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${youngSerif.variable} antialiased bg-background text-foreground`}
      >
        <nav className="border-b border-border bg-surface">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
            <Link href="/" className="font-heading text-xl tracking-tight text-primary-dark">
              tbr(a)
            </Link>
            <Link
              href="/search"
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              Search
            </Link>
          </div>
        </nav>
        <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
