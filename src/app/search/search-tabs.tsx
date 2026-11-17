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
      <div className="seg-glass mb-6">
        <button onClick={() => setActiveTab("search")} data-active={activeTab === "search"}>
          <span className="inline-flex items-center justify-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.500" />
            </svg>
            Search
          </span>
        </button>
        <button onClick={() => setActiveTab("discover")} data-active={activeTab === "discover"}>
          <span className="inline-flex items-center justify-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l1.9 5.1L19 10l-5.100 1.900L12 17l-1.900-5.100L5 10l5.100-1.900z" /><path d="M19 15l.8 2.2L22 18l-2.200.800L19 21l-.800-2.200L16 18l2.200-.800z" />
            </svg>
            Discover
          </span>
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
