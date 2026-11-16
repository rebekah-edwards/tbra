import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { DescriptionsQueue } from "@/components/admin/descriptions-queue";
import {
  DESCRIPTION_QUEUE_PAGE_SIZE as PAGE_SIZE,
  loadDescriptionQueue,
  loadDescriptionQueueCounts,
  type DescriptionQueueTab,
} from "@/lib/queries/description-queue";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Descriptions | tbr*a",
  robots: { index: false },
};

export default async function AdminDescriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) redirect("/");

  const { tab: tabParam, page: pageParam } = await searchParams;
  const tab: DescriptionQueueTab = tabParam === "all" ? "all" : "active";
  const requestedPage = Math.floor(Number(pageParam ?? 1));
  const page =
    Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.min(requestedPage, 100_000) : 1;
  const offset = (page - 1) * PAGE_SIZE;

  const [booksList, counts] = await Promise.all([
    loadDescriptionQueue(tab, offset),
    loadDescriptionQueueCounts(),
  ]);

  // The queue shrinks as descriptions are saved, so a bookmarked or stale
  // page number can run off the end. Land on the last page that has rows.
  if (booksList.length === 0 && page > 1) {
    const lastPage = Math.max(1, Math.ceil(counts[tab] / PAGE_SIZE));
    const target = Math.min(lastPage, page - 1);
    redirect(`/admin/descriptions?tab=${tab}${target > 1 ? `&page=${target}` : ""}`);
  }

  return (
    <div className="space-y-6 lg:w-[60%] lg:mx-auto pb-24 lg:pb-8">
      <div>
        <h1 className="text-foreground text-2xl font-bold tracking-tight">
          Descriptions
        </h1>
        <p className="text-sm text-muted mt-1">
          Public books with no usable description, most-read first. Paste the
          publisher&apos;s description and save — the book leaves the queue and
          its page updates.
        </p>
      </div>

      <DescriptionsQueue
        books={booksList}
        counts={counts}
        activeTab={tab}
        page={page}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
