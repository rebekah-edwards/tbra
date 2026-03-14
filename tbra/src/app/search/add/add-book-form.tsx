"use client";

import { useRef, useState } from "react";
import { createBookManually } from "@/lib/actions/books";

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm placeholder-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function AddBookForm() {
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverMode, setCoverMode] = useState<"url" | "upload">("url");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      alert("Image must be under 1 MB");
      e.target.value = "";
      return;
    }
    setCoverPreview(URL.createObjectURL(file));
  }

  function handleUrlBlur(e: React.FocusEvent<HTMLInputElement>) {
    const url = e.target.value.trim();
    setCoverPreview(url || null);
  }

  async function handleSubmit(formData: FormData) {
    // Combine hours + minutes into audioLengthMinutes
    const hours = parseInt(formData.get("audioHours") as string) || 0;
    const minutes = parseInt(formData.get("audioMinutes") as string) || 0;
    const totalMinutes = hours * 60 + minutes;
    if (totalMinutes > 0) {
      formData.set("audioLengthMinutes", String(totalMinutes));
    }
    formData.delete("audioHours");
    formData.delete("audioMinutes");

    // Auto-detect ISBN type from single field
    const isbn = (formData.get("isbn") as string)?.replace(/[-\s]/g, "") || "";
    formData.delete("isbn");
    if (isbn.length === 13) {
      formData.set("isbn13", isbn);
    } else if (isbn.length === 10) {
      formData.set("isbn10", isbn);
    }

    // Handle cover image file upload — convert to data URL for server action
    const coverFile = formData.get("coverFile") as File;
    if (coverFile && coverFile.size > 0) {
      // Keep the file in formData for server to handle
    } else {
      formData.delete("coverFile");
    }

    await createBookManually(formData);
  }

  return (
    <form action={handleSubmit} className="mt-6 space-y-4">
      {/* Title (required) */}
      <div>
        <label htmlFor="title" className="block text-sm font-medium">
          Title <span className="text-intensity-4">*</span>
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          className={inputClass}
          placeholder="Book title"
        />
      </div>

      {/* Author */}
      <div>
        <label htmlFor="author" className="block text-sm font-medium">
          Author
        </label>
        <input
          id="author"
          name="author"
          type="text"
          className={inputClass}
          placeholder="Author name"
        />
      </div>

      {/* Description */}
      <div>
        <label htmlFor="description" className="block text-sm font-medium">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          className={inputClass}
          placeholder="Brief description"
        />
      </div>

      {/* Cover Image */}
      <div>
        <label className="block text-sm font-medium mb-1">Cover image</label>
        <div className="flex gap-3 mb-2">
          <button
            type="button"
            onClick={() => setCoverMode("url")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              coverMode === "url"
                ? "bg-primary text-background"
                : "bg-surface-alt text-muted hover:text-foreground"
            }`}
          >
            URL
          </button>
          <button
            type="button"
            onClick={() => setCoverMode("upload")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              coverMode === "upload"
                ? "bg-primary text-background"
                : "bg-surface-alt text-muted hover:text-foreground"
            }`}
          >
            Upload
          </button>
        </div>
        {coverMode === "url" ? (
          <input
            name="coverImageUrl"
            type="url"
            className={inputClass}
            placeholder="https://..."
            onBlur={handleUrlBlur}
          />
        ) : (
          <div>
            <input
              ref={fileInputRef}
              name="coverFile"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary hover:file:bg-primary/20"
            />
            <p className="mt-1 text-xs text-muted">Max 1 MB. JPG, PNG, or WebP.</p>
          </div>
        )}
        {coverPreview && (
          <div className="mt-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverPreview}
              alt="Cover preview"
              className="h-[120px] w-[80px] rounded object-cover border border-border"
              onError={() => setCoverPreview(null)}
            />
          </div>
        )}
      </div>

      {/* Year + Pages row */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="year" className="block text-sm font-medium">
            Publication year
          </label>
          <input
            id="year"
            name="year"
            type="number"
            className={inputClass}
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
            className={inputClass}
            placeholder="350"
          />
        </div>
      </div>

      {/* Audiobook length (hours + minutes) + Fiction toggle */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium">Audiobook length</label>
          <div className="mt-1 flex gap-2">
            <div className="relative flex-1">
              <input
                name="audioHours"
                type="number"
                min="0"
                max="99"
                className="w-full rounded-lg border border-border bg-surface py-2.5 pl-4 pr-8 text-sm placeholder-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="0"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted pointer-events-none">hr</span>
            </div>
            <div className="relative flex-1">
              <input
                name="audioMinutes"
                type="number"
                min="0"
                max="59"
                className="w-full rounded-lg border border-border bg-surface py-2.5 pl-4 pr-10 text-sm placeholder-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="0"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted pointer-events-none">min</span>
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium">Category</label>
          <div className="mt-1 flex rounded-lg border border-border overflow-hidden">
            <label className="flex-1 cursor-pointer">
              <input
                type="radio"
                name="isFiction"
                value="fiction"
                defaultChecked
                className="peer sr-only"
              />
              <div className="peer-checked:bg-primary peer-checked:text-background py-2.5 text-center text-sm font-medium text-muted transition-colors hover:bg-surface-alt">
                Fiction
              </div>
            </label>
            <label className="flex-1 cursor-pointer border-l border-border">
              <input
                type="radio"
                name="isFiction"
                value="nonfiction"
                className="peer sr-only"
              />
              <div className="peer-checked:bg-primary peer-checked:text-background py-2.5 text-center text-sm font-medium text-muted transition-colors hover:bg-surface-alt">
                Nonfiction
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* Narrator */}
      <div>
        <label htmlFor="narrator" className="block text-sm font-medium">
          Narrator
        </label>
        <input
          id="narrator"
          name="narrator"
          type="text"
          className={inputClass}
          placeholder="Narrator name"
        />
      </div>

      {/* ISBN (single field, auto-detect) */}
      <div>
        <label htmlFor="isbn" className="block text-sm font-medium">
          ISBN
        </label>
        <input
          id="isbn"
          name="isbn"
          type="text"
          className={inputClass}
          placeholder="978-0-123456-78-9 or 0-123456-78-9"
        />
        <p className="mt-1 text-xs text-muted">10 or 13 digits. Dashes are fine.</p>
      </div>

      <button
        type="submit"
        className="lime-glow-box rounded-full border border-primary/60 bg-transparent px-6 py-2.5 text-sm font-medium text-primary hover:border-primary hover:bg-primary/10 hover:shadow-[0_0_16px_rgba(163,230,53,0.2)] transition-all"
      >
        Add Book
      </button>
    </form>
  );
}
