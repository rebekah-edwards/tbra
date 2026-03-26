import { AddBookForm } from "./add-book-form";

export default function AddBookPage() {
  return (
    <div>
      <h1 className="text-foreground text-2xl font-bold tracking-tight">Add a Book</h1>
      <p className="mt-2 text-muted">
        Manually add a book to your shelf.
      </p>
      <AddBookForm />
    </div>
  );
}
