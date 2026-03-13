import Link from "next/link";
import { createBookManually } from "@/lib/actions/books";

export default function AddBookPage() {
  return (
    <div>
      <div className="mb-6">
        <Link
          href="/search"
          className="text-sm text-primary hover:text-primary-dark"
        >
          &larr; Back to search
        </Link>
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Add a Book</h1>
      <p className="mt-2 text-muted">
        Manually add a book that isn&apos;t in Open Library.
      </p>

      <form action={createBookManually} className="mt-6 space-y-4">
        <div>
          <label htmlFor="title" className="block text-sm font-medium">
            Title <span className="text-intensity-4">*</span>
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            className="mt-1 w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm placeholder-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Book title"
          />
        </div>

        <div>
          <label htmlFor="author" className="block text-sm font-medium">
            Author
          </label>
          <input
            id="author"
            name="author"
            type="text"
            className="mt-1 w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm placeholder-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Author name"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={3}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm placeholder-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Brief description"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="year" className="block text-sm font-medium">
              Publication year
            </label>
            <input
              id="year"
              name="year"
              type="number"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm placeholder-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="2024"
            />
          </div>
          <div>
            <label htmlFor="pages" className="block text-sm font-medium">
              Pages
            </label>
            <input
              id="pages"
              name="pages"
              type="number"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm placeholder-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="350"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="isbn13" className="block text-sm font-medium">
              ISBN-13
            </label>
            <input
              id="isbn13"
              name="isbn13"
              type="text"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm placeholder-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="978-..."
            />
          </div>
          <div>
            <label htmlFor="isbn10" className="block text-sm font-medium">
              ISBN-10
            </label>
            <input
              id="isbn10"
              name="isbn10"
              type="text"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm placeholder-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="0-..."
            />
          </div>
        </div>

        <button
          type="submit"
          className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-white hover:bg-primary-dark transition-colors"
        >
          Add Book
        </button>
      </form>
    </div>
  );
}
