import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In | The Based Reader App",
  description:
    "Sign in to your tbr*a account to track your reading, manage your bookshelf, and discover your next favorite book.",
  robots: { index: false },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
