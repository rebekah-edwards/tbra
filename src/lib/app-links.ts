/**
 * Where "Get the app" sends people, per device.
 *
 * Neither store listing is public yet (2026-11-25): App Store 1.0 is waiting
 * for review and the Play app is in closed testing. Rather than a flag someone
 * has to remember to flip, `getStoreAvailability()` asks each store whether
 * the listing answers, cached for a few hours — the banner starts pointing
 * straight at the store on its own once a listing goes live. Until then every
 * button goes to /download, which offers the iPhone beta and the installable
 * web app.
 */

export const APP_STORE_URL = "https://apps.apple.com/app/id6791708808";
export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=app.thebasedreader.tbra";
/** Public TestFlight link (Friends group, capped at 100 testers). */
export const TESTFLIGHT_URL = "https://testflight.apple.com/join/yby6EkZu";

export interface StoreAvailability {
  ios: boolean;
  android: boolean;
}

async function listingIsLive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(3000),
      // A listing doesn't come and go; re-check a few times a day.
      next: { revalidate: 6 * 60 * 60 },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getStoreAvailability(): Promise<StoreAvailability> {
  const [ios, android] = await Promise.all([
    listingIsLive(APP_STORE_URL),
    listingIsLive(PLAY_STORE_URL),
  ]);
  return { ios, android };
}

export type DevicePlatform = "ios" | "android" | "other";

export function detectPlatform(userAgent: string): DevicePlatform {
  const ua = userAgent.toLowerCase();
  // iPadOS reports a Mac user agent; the touch check happens client-side.
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "other";
}

/** The one link a "Get the app" button should use on this device. */
export function downloadHref(platform: DevicePlatform, stores: StoreAvailability): string {
  if (platform === "ios" && stores.ios) return APP_STORE_URL;
  if (platform === "android" && stores.android) return PLAY_STORE_URL;
  return "/download";
}
