import type { Metadata } from "next";
import { WelcomeCarousel } from "@/components/onboarding/welcome-carousel";

export const metadata: Metadata = {
  title: "Welcome to tbr*a | The Based Reader App",
  description: "Know what's in a book before you read it.",
  robots: { index: false },
};

export default function WelcomePage() {
  return <WelcomeCarousel />;
}
