import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

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
import { LocationSettings } from "@/components/settings/location-settings";
import { getHiddenBooks } from "@/lib/actions/hidden-books";
import { ExportSection } from "@/components/settings/export-section";
import { isPremium } from "@/lib/auth";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [prefs, notifPrefs, hiddenBooks] = await Promise.all([
    getUserReadingPreferences(user.userId),
    getNotificationPreferences(user.userId),
    getHiddenBooks(user.userId),
  ]);

  return (
    <div className="space-y-6 lg:w-[60%] lg:mx-auto">
      <div>
        <h1 className="text-foreground text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted mt-1">
          Manage your account and data
        </p>
      </div>

      <ReadingPreferencesEditor initialPrefs={prefs} />

      {/* Display */}
      <div>
        <h2 className="section-heading text-lg mb-3">Display</h2>
        <div className="space-y-3">
          <div>
            <p className="text-sm text-foreground mb-1.5">Text Size</p>
            <p className="text-xs text-muted mb-2">Adjust the base font size across the app</p>
            <TextSizeSelector />
          </div>
        </div>
      </div>

      {/* Location */}
      <div>
        <h2 className="section-heading text-lg mb-3">Location</h2>
        <LocationSettings userId={user.userId} />
      </div>

      <NotificationPreferences initialPrefs={notifPrefs} />

      <ExportSection isPremium={isPremium(user)} />

      <div>
        <h2 className="section-heading text-lg mb-3">Hidden Books</h2>
        <p className="text-xs text-muted mb-3">
          Books hidden from all recommendations. Unhide to see them again.
        </p>
        <HiddenBooksManager initialBooks={hiddenBooks} />
      </div>

      <ChangePassword />

      <AccountSettings userEmail={user.email} />
    </div>
  );
}
