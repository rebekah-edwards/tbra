"use client";

import { useEffect } from "react";

/**
 * Reports the browser's IANA timezone once per session so reading streaks
 * bucket days in the reader's own calendar rather than UTC. Rendered only for
 * signed-in users.
 *
 * The sessionStorage guard keeps this to one request per tab session; the
 * endpoint is also a no-op when the value already matches.
 */
export function TimezoneReporter() {
  useEffect(() => {
    const KEY = "tbra:tz-reported";
    let timezone: string | undefined;
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!timezone) return;
    // Already reported THIS zone in this tab — nothing to do. Keyed by value
    // so travelling across zones still updates.
    if (sessionStorage.getItem(KEY) === timezone) return;

    fetch("/api/v1/profile/timezone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone }),
    })
      .then((res) => {
        if (res.ok) sessionStorage.setItem(KEY, timezone);
      })
      .catch(() => {
        // Streaks fall back to a default zone; never surface this.
      });
  }, []);

  return null;
}
