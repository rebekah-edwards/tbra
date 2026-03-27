import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Account | The Based Reader App",
  description:
    "Join tbr*a to get detailed content ratings, smart recommendations, and reading tools built for readers who care about what they read.",
  robots: { index: false },
};

export default function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
