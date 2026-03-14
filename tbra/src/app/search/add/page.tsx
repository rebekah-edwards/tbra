import Link from "next/link";
import { AddBookForm } from "./add-book-form";

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
        Manually add a book to your shelf.
      </p>
      <AddBookForm />
    </div>
  );
}
