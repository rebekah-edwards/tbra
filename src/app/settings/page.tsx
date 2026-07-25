import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { taxonomyCategories } from "@/db/schema";
import { byContentCategoryOrder } from "@/lib/content-category-order";
import { eq } from "drizzle-orm";

export const metadata: Metadata = {
  robots: { index: false },
};
import { getUserReadingPreferences } from "@/lib/queries/reading-preferences";
import { getNotificationPreferences } from "@/lib/actions/notification-preferences";
import { ReadingPreferencesEditor } from "@/components/settings/reading-preferences-editor";
import { NotificationPreferences } from "@/components/settings/notification-preferences";
import { HiddenBooksManager } from "@/components/settings/hidden-books-manager";
import { AccountSettings } from "@/components/settings/account-settings";
import { ChangePassword } from "@/components/settings/change-password";
import { TextSizeSelector } from "@/components/settings/text-size-selector";
import { ThemeSelector } from "@/components/settings/theme-selector";
import { LocationSettings } from "@/components/settings/location-settings";
import { getHiddenBooks } from "@/lib/actions/hidden-books";
import { ExportSection } from "@/components/settings/export-section";
import { SettingsTour } from "@/components/coach-marks/tours";
import { isPremium } from "@/lib/auth";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [prefs, notifPrefs, hiddenBooks, activeCategoriesRaw] = await Promise.all([
    getUserReadingPreferences(user.userId),
    getNotificationPreferences(user.userId),
    getHiddenBooks(user.userId),
    db
      .select({ id: taxonomyCategories.id, key: taxonomyCategories.key, name: taxonomyCategories.name })
      .from(taxonomyCategories)
      .where(eq(taxonomyCategories.active, true))
      .all(),
  ]);
  // Exclude "Other" from the comfort zone list — it's a catch-all bucket,
  // not a meaningful thing to filter on. Users who want to avoid specific
  // things use the "Custom topics to avoid" input below, which scans reviews
  // + note blobs across ALL categories (including Other) automatically.
  const activeCategories = activeCategoriesRaw
    .filter((c) => c.key !== "other")
    // Matches the book page's What's Inside order (sexual content first)
    .sort(byContentCategoryOrder);

  return (
    <div className="space-y-6 lg:w-[60%] lg:mx-auto">
      <div>
        <h1 className="text-foreground text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted mt-1">
          Manage your account and data
        </p>
      </div>

      <ReadingPreferencesEditor initialPrefs={prefs} activeCategories={activeCategories} />

      {/* Display */}
      <div>
        <h2 className="section-heading text-lg mb-3">Display</h2>
        <div className="space-y-5">
          <div>
            <p className="text-sm text-foreground mb-1.5">Theme</p>
            <p className="text-xs text-muted mb-2">Choose your preferred color scheme</p>
            <ThemeSelector />
          </div>
          <div>
            <p className="text-sm text-foreground mb-1.5">Text Size</p>
            <p className="text-xs text-muted mb-2">Adjust the base font size across the app</p>
            <TextSizeSelector />
          </div>
        </div>
      </div>

      {/* Location */}
      <div data-coach-anchor="tour-privacy">
        <h2 className="section-heading text-lg mb-3">Location</h2>
        <LocationSettings userId={user.userId} />
      </div>

      <SettingsTour />

      <NotificationPreferences initialPrefs={notifPrefs} />

      <ExportSection isPremium={isPremium(user)} />

      {/* Hidden Books — collapsed by default so the list doesn't force the
          user to scroll past it. Uses native <details> for zero-JS toggle. */}
      <details className="group">
        <summary className="flex items-center justify-between cursor-pointer list-none">
          <h2 className="section-heading text-lg">Hidden Books {hiddenBooks.length > 0 && (<span className="text-xs font-normal text-muted ml-2">({hiddenBooks.length})</span>)}</h2>
          <svg className="w-4 h-4 text-muted transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </summary>
        <p className="text-xs text-muted mt-3 mb-3">
          Books hidden from all recommendations. Unhide to see them again.
        </p>
        <HiddenBooksManager initialBooks={hiddenBooks} />
      </details>

      <ChangePassword />

      <AccountSettings userEmail={user.email} />
    </div>
  );
}
