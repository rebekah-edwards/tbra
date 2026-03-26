import type { Metadata } from "next";
export const revalidate = 3600;
import { getCurrentUser } from "@/lib/auth";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact Us | The Based Reader App",
  description: "Get in touch with the tbr*a team. We'd love to hear your feedback, questions, or suggestions.",
  openGraph: {
    title: "Contact Us | The Based Reader App",
    description: "Get in touch with the tbr*a team. We'd love to hear your feedback, questions, or suggestions.",
  },
};

export default async function ContactPage() {
  const session = await getCurrentUser();

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-foreground text-2xl font-bold tracking-tight"
         
        >
          Contact Us
        </h1>
        <p className="text-sm text-muted mt-1">
          Questions, feedback, or bug reports — we read everything
        </p>
      </div>

      <ContactForm userEmail={session?.email ?? null} />
    </div>
  );
}
