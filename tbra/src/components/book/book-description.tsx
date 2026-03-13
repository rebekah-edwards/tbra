"use client";

import { useState } from "react";

interface BookDescriptionProps {
  description: string | null;
}

export function BookDescription({ description }: BookDescriptionProps) {
  const [expanded, setExpanded] = useState(false);

  if (!description) return null;

  const isLong = description.length > 300;
  const displayText =
    isLong && !expanded ? description.slice(0, 300) + "..." : description;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Description</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted whitespace-pre-line">
        {displayText}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-sm text-primary hover:text-primary-dark"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </section>
  );
}
