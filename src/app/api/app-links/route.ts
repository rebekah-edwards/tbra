import { NextResponse } from "next/server";
import { getStoreAvailability } from "@/lib/app-links";

/**
 * Which store listings are live, for the logged-out "Get the app" banner.
 * Static + revalidated every 6 hours, so asking costs the stores nothing per
 * visitor and pages don't wait on Apple or Google.
 */
export const revalidate = 21600;

export async function GET() {
  return NextResponse.json(await getStoreAvailability());
}
