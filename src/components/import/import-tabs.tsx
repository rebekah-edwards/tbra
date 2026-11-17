"use client";

import { useState } from "react";
import { StoryGraphImport } from "./storygraph-import";
import { GoodreadsImport } from "./goodreads-import";
import { LibbyImport } from "./libby-import";

const sources = [
  { key: "goodreads", label: "Goodreads" },
  { key: "storygraph", label: "StoryGraph" },
  { key: "libby", label: "Libby" },
] as const;

type SourceKey = (typeof sources)[number]["key"];

export function ImportTabs() {
  const [active, setActive] = useState<SourceKey>("goodreads");

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-full border border-foreground/10 bg-surface/70 p-1 backdrop-blur-md">
        {sources.map((s) => (
          <button
            key={s.key}
            onClick={() => setActive(s.key)}
            className={`flex-1 rounded-full px-3 py-2 text-sm transition-colors ${
              active === s.key
                ? "bg-accent text-black font-bold"
                : "font-medium text-muted hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {active === "storygraph" && <StoryGraphImport />}

      {active === "goodreads" && <GoodreadsImport />}

      {active === "libby" && <LibbyImport />}
    </div>
  );
}
