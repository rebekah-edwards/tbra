export default async function BookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Book Page</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Book ID: <code className="rounded bg-zinc-200 px-1.5 py-0.5 text-sm dark:bg-zinc-800">{id}</code>
      </p>
      <p className="mt-8 text-sm text-zinc-400">
        Content profile will be rendered here in Phase 2.
      </p>
    </div>
  );
}
