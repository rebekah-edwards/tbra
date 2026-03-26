import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ImportTabs } from "@/components/import/import-tabs";

export const metadata: Metadata = {
  robots: { index: false },
};

export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-foreground text-2xl font-bold tracking-tight"
         
        >
          Import Library
        </h1>
        <p className="text-sm text-muted mt-1">
          Bring your reading history from another app
        </p>
      </div>

      <ImportTabs />
    </div>
  );
}
