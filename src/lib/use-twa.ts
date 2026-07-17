"use client";

import { useEffect, useState } from "react";

const KEY = "tbra-twa";

/**
 * Detects the Google Play (TWA) build of the app. Android sets an
 * `android-app://<package>` referrer on the FIRST navigation into a Trusted
 * Web Activity, so we persist the signal — later in-app navigations have
 * normal referrers.
 *
 * Used to satisfy Google Play's payments policy: digital-goods purchases
 * inside a Play-distributed app must use Play Billing, so the TWA hides the
 * Stripe purchase surfaces entirely (browser + iOS keep them). Returns false
 * on the server and during the first client render.
 */
export function useIsTwa(): boolean {
  const [isTwa, setIsTwa] = useState(false);
  useEffect(() => {
    try {
      if (document.referrer.startsWith("android-app://")) {
        localStorage.setItem(KEY, "1");
      }
      setIsTwa(localStorage.getItem(KEY) === "1");
    } catch {
      /* storage unavailable → treat as regular web */
    }
  }, []);
  return isTwa;
}
