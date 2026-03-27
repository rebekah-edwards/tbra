import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset Password | The Based Reader App",
  description: "Reset your tbr*a account password.",
  robots: { index: false },
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
