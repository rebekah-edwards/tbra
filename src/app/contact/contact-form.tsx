"use client";

import { useState, useTransition } from "react";
import { submitContactForm } from "@/lib/actions/contact";

interface Props {
  userEmail: string | null;
}

export function ContactForm({ userEmail }: Props) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  function handleSubmit(formData: FormData) {
    setStatus("idle");
    startTransition(async () => {
      const result = await submitContactForm(formData);
      if (result.success) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMessage(result.error ?? "Something went wrong");
      }
    });
  }

  const label = "eyebrow mb-1.5 block pl-4";

  if (status === "success") {
    return (
      <div className="card-hairline mx-auto flex max-w-lg flex-col items-center p-8 text-center">
        <span className="orb-glass mb-3 h-16 w-16">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </span>
        <h2 className="font-heading text-lg font-semibold text-foreground mb-1">Message sent</h2>
        <p className="text-sm text-muted">
          Thanks for reaching out. We&apos;ll get back to you as soon as we can.
        </p>
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="mx-auto max-w-lg">
      <div className="card-glass space-y-4 p-5">
        <div>
          <label htmlFor="contact-name" className={label}>Name</label>
          <input id="contact-name" name="name" type="text" required maxLength={100} className="field-glass w-full text-base" placeholder="Your name" />
        </div>

        <div>
          <label htmlFor="contact-email" className={label}>Email</label>
          <input id="contact-email" name="email" type="email" required maxLength={200} defaultValue={userEmail ?? ""} className="field-glass w-full text-base" placeholder="you@example.com" />
        </div>

        <div>
          <label htmlFor="contact-subject" className={label}>Subject</label>
          <input id="contact-subject" name="subject" type="text" required maxLength={200} className="field-glass w-full text-base" placeholder="What's this about?" />
        </div>

        <div>
          <label htmlFor="contact-message" className={label}>Message</label>
          <textarea
            id="contact-message"
            name="message"
            required
            maxLength={5000}
            rows={6}
            className="field-glass h-auto w-full resize-none !rounded-[20px] py-3 text-base"
            placeholder="Tell us what's on your mind..."
          />
        </div>

        {status === "error" && <p className="text-center text-sm text-destructive">{errorMessage}</p>}

        <button type="submit" disabled={isPending} className="btn-lime w-full py-3 text-sm">
          {isPending ? "Sending..." : "Send Message"}
        </button>
      </div>
    </form>
  );
}
