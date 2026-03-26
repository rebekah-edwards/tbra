"use client";

import { useState } from "react";
import SearchClient from "./search-client";
import { DiscoverClient } from "@/components/discover/discover-client";

interface SearchTabsProps {
  isLoggedIn: boolean;
  initialQuery?: string;
  initialTab?: "search" | "discover";
}

export function SearchTabs({ isLoggedIn, initialQuery, initialTab }: SearchTabsProps) {
  const [activeTab, setActiveTab] = useState<"search" | "discover">(
    initialTab ?? (initialQuery ? "search" : "search")
  );

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg bg-surface-alt/50 p-1 mb-6">
        <button
          onClick={() => setActiveTab("search")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-all ${
            activeTab === "search"
              ? "bg-surface text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          <span className="mr-1.5">🔍</span>
          Search
        </button>
        <button
          onClick={() => setActiveTab("discover")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-all ${
            activeTab === "discover"
              ? "bg-surface text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          <span className="mr-1.5">✨</span>
          Discover
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "search" ? (
        <SearchClient isLoggedIn={isLoggedIn} initialQuery={initialQuery} />
      ) : (
        <DiscoverClient />
      )}
    </div>
  );
}
