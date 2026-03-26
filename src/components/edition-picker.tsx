"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { buildCoverUrl, classifyEditionFormat, type OLEdition } from "@/lib/openlibrary";
import { importEdition, setOwnedEdition, removeOwnedEdition } from "@/lib/actions/editions";
import type { EditionSelection } from "@/app/book/[id]/book-page-client";

interface EditionPickerProps {
  workKey: string;
  bookId: string;
  format: string;
  existingSelections: EditionSelection[];
  onSelectionsChange?: (selections: EditionSelection[]) => void;
}

export function EditionPicker({
  workKey,
  bookId,
  format,
  existingSelections,
  onSelectionsChange,
}: EditionPickerProps) {
  const [allEditions, setAllEditions] = useState<OLEdition[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Map: "editionOLKey:format" → editionId (from DB)
  const [selections, setSelections] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const s of existingSelections) {
      map.set(`${s.openLibraryKey}:${s.format}`, s.editionId);
    }
    return map;
  });
  // Track coverId per editionOLKey for cover switching
  const [coverIds, setCoverIds] = useState<Map<string, number | null>>(() => {
    const map = new Map<string, number | null>();
    for (const s of existingSelections) {
      map.set(s.openLibraryKey, s.coverId);
    }
    return map;
  });
  const [pending, setPending] = useState<Set<string>>(new Set());

  const fetchEditions = useCallback(async (offset = 0) => {
    try {
      const res = await fetch(
        `/api/openlibrary/editions?workKey=${encodeURIComponent(workKey)}&limit=50&offset=${offset}`
      );
      if (!res.ok) throw new Error("Failed to fetch editions");
      const data = await res.json();
      return data as { entries: OLEdition[]; size: number };
    } catch {
      throw new Error("Failed to fetch editions");
    }
  }, [workKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchEditions(0)
      .then((data) => {
        if (!cancelled) {
          setAllEditions(data.entries);
          setTotalSize(data.size);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [fetchEditions]);

  // Filter editions to those matching the requested format (or unclassified) and English language
  const filteredEditions = useMemo(() => {
    return allEditions.filter((edition) => {
      const classified = classifyEditionFormat(edition.physical_format);
      if (classified !== format && classified !== null) return false;
      // Keep English editions and editions with no language specified
      const langs = edition.languages;
      if (!langs || langs.length === 0) return true;
      return langs.some((l) => l.key === "/languages/eng");
    });
  }, [allEditions, format]);

  async function handleLoadMore() {
    setLoadingMore(true);
    try {
      const data = await fetchEditions(allEditions.length);
      setAllEditions((prev) => [...prev, ...data.entries]);
    } catch {
      // silently fail load-more
    }
    setLoadingMore(false);
  }

  // Emit selections to parent via useEffect (avoids setState-during-render)
  const selectionsRef = useCallback(() => {
    if (!onSelectionsChange) return;
    const result: EditionSelection[] = [];
    for (const [selKey, editionId] of selections) {
      const colonIdx = selKey.lastIndexOf(":");
      const olKey = selKey.slice(0, colonIdx);
      const fmt = selKey.slice(colonIdx + 1);
      result.push({
        editionId,
        format: fmt,
        openLibraryKey: olKey,
        coverId: coverIds.get(olKey) ?? null,
      });
    }
    onSelectionsChange(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selections, coverIds, onSelectionsChange]);

  // Track whether this is the initial mount to skip the first emit
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => { setHasMounted(true); }, []);
  useEffect(() => {
    if (hasMounted) selectionsRef();
  }, [hasMounted, selectionsRef]);

  async function handleToggle(edition: OLEdition) {
    const selKey = `${edition.key}:${format}`;
    if (pending.has(selKey)) return;

    setPending((prev) => new Set(prev).add(selKey));

    try {
      if (selections.has(selKey)) {
        const editionId = selections.get(selKey)!;
        await removeOwnedEdition(bookId, editionId, format);
        setSelections((prev) => {
          const next = new Map(prev);
          next.delete(selKey);
          return next;
        });
      } else {
        const editionId = await importEdition(bookId, edition);
        await setOwnedEdition(bookId, editionId, format);
        const coverId = edition.covers?.[0] ?? null;
        setCoverIds((prev) => new Map(prev).set(edition.key, coverId));
        setSelections((prev) => new Map(prev).set(selKey, editionId));
      }
    } catch {
      // ignore
    }

    setPending((prev) => {
      const next = new Set(prev);
      next.delete(selKey);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted text-sm">
        Loading editions...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-400 text-sm">
        {error}
      </div>
    );
  }

  if (filteredEditions.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted text-sm">
        No editions found for this format
      </div>
    );
  }

  return (
    <div className="divide-y divide-border overflow-hidden">
      {filteredEditions.map((edition) => {
        const coverUrl = edition.covers?.[0]
          ? buildCoverUrl(edition.covers[0], "S")
          : null;
        const publisher = edition.publishers?.[0];
        const year = edition.publish_date;
        const isbn = edition.isbn_13?.[0] ?? edition.isbn_10?.[0];
        const selKey = `${edition.key}:${format}`;
        const isSelected = selections.has(selKey);
        const isPending = pending.has(selKey);

        return (
          <label
            key={edition.key}
            className={`flex items-center gap-2 px-3 py-3 cursor-pointer hover:bg-surface-alt/50 transition-colors ${isPending ? "opacity-50" : ""}`}
          >
            {/* Cover thumbnail */}
            <div className="w-10 h-[60px] rounded bg-surface-alt overflow-hidden shrink-0 flex items-center justify-center">
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {edition.title || "Untitled"}
              </p>
              <p className="text-xs text-muted mt-0.5 truncate">
                {[publisher, year, edition.number_of_pages ? `${edition.number_of_pages}p` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {isbn && (
                <p className="text-xs text-muted/60 mt-0.5 font-mono truncate">
                  {isbn}
                </p>
              )}
            </div>

            {/* Own checkbox */}
            <div className="flex flex-col items-center gap-0.5 shrink-0">
              <input
                type="checkbox"
                checked={isSelected}
                disabled={isPending}
                onChange={() => handleToggle(edition)}
                className="accent-neon-purple h-4 w-4"
              />
              <span className={`text-[10px] font-semibold leading-none ${isSelected ? "text-neon-purple" : "text-muted"}`}>
                own
              </span>
            </div>
          </label>
        );
      })}

      {/* Load more */}
      {allEditions.length < totalSize && (
        <div className="px-5 py-4">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="w-full py-2.5 text-sm font-medium text-neon-purple hover:text-neon-purple/80 transition-colors disabled:opacity-50"
          >
            {loadingMore ? "Loading..." : `Load more (${allEditions.length} of ${totalSize})`}
          </button>
        </div>
      )}
    </div>
  );
}
