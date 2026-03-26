import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasCompletedOnboarding } from "@/lib/queries/reading-preferences";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const completed = await hasCompletedOnboarding(user.userId);
  if (completed) redirect("/");

  return (
    <div className="min-h-[calc(100dvh-4rem)] flex flex-col">
      <OnboardingWizard />
    </div>
  );
}
