"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { NoCover } from "@/components/no-cover";
import { InfoBubble } from "@/components/home/info-bubble";
import { DISCOVER_MOODS } from "@/lib/mood-genre-map";

interface DiscoverResult {
  id: string;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
  score: number;
  reason?: string;
}

const LENGTH_OPTIONS = [
  { key: "short", label: "Quick read", desc: "Under 250 pages" },
  { key: "medium", label: "Standard", desc: "250-400 pages" },
  { key: "long", label: "Epic", desc: "400+ pages" },
] as const;

const FICTION_OPTIONS = [
  { key: "fiction", label: "Fiction" },
  { key: "nonfiction", label: "Non-fiction" },
  { key: "both", label: "Both" },
] as const;

const AUDIENCE_OPTIONS = [
  { key: "adult", label: "Adult" },
  { key: "ya", label: "Young Adult" },
  { key: "teen", label: "Teen" },
  { key: "mg", label: "Middle Grade" },
  { key: "any", label: "Any" },
] as const;

// Mood-specific tints: [idle bg, idle border, selected bg gradient, selected border]
const MOOD_TINTS: Record<string, { idle: string; selected: string }> = {
  cozy:           { idle: "bg-amber-500/8 border-amber-500/20",        selected: "bg-gradient-to-br from-amber-500/25 to-amber-900/15 border-amber-500/50" },
  dark_gritty:    { idle: "bg-slate-500/10 border-slate-500/20",       selected: "bg-gradient-to-br from-slate-500/25 to-slate-900/15 border-slate-400/50" },
  thrilling:      { idle: "bg-yellow-500/8 border-yellow-500/20",      selected: "bg-gradient-to-br from-yellow-500/25 to-yellow-900/15 border-yellow-500/50" },
  romantic:       { idle: "bg-pink-500/8 border-pink-500/20",          selected: "bg-gradient-to-br from-pink-500/25 to-pink-900/15 border-pink-500/50" },
  funny:          { idle: "bg-orange-500/8 border-orange-500/20",      selected: "bg-gradient-to-br from-orange-500/25 to-orange-900/15 border-orange-500/50" },
  emotional:      { idle: "bg-rose-500/8 border-rose-500/20",          selected: "bg-gradient-to-br from-rose-500/25 to-rose-900/15 border-rose-500/50" },
  adventurous:    { idle: "bg-emerald-500/8 border-emerald-500/20",    selected: "bg-gradient-to-br from-emerald-500/25 to-emerald-900/15 border-emerald-500/50" },
  mind_bending:   { idle: "bg-violet-500/8 border-violet-500/20",      selected: "bg-gradient-to-br from-violet-500/25 to-violet-900/15 border-violet-500/50" },
  spooky:         { idle: "bg-purple-500/8 border-purple-500/20",      selected: "bg-gradient-to-br from-purple-500/25 to-purple-900/15 border-purple-500/50" },
  inspiring:      { idle: "bg-lime-500/8 border-lime-500/20",          selected: "bg-gradient-to-br from-lime-500/25 to-lime-900/15 border-lime-500/50" },
  informative:    { idle: "bg-cyan-500/8 border-cyan-500/20",          selected: "bg-gradient-to-br from-cyan-500/25 to-cyan-900/15 border-cyan-500/50" },
  fantastical:    { idle: "bg-indigo-500/8 border-indigo-500/20",      selected: "bg-gradient-to-br from-indigo-500/25 to-indigo-900/15 border-indigo-500/50" },
  historical:     { idle: "bg-amber-700/8 border-amber-700/20",        selected: "bg-gradient-to-br from-amber-700/25 to-amber-950/15 border-amber-700/50" },
  sciencey:       { idle: "bg-teal-500/8 border-teal-500/20",          selected: "bg-gradient-to-br from-teal-500/25 to-teal-900/15 border-teal-500/50" },
};

export function DiscoverClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Initialize state from URL params (for back-button restoration)
  const [selectedMoods, setSelectedMoods] = useState<string[]>(() => {
    const p = searchParams.get("moods");
    return p ? p.split(",").filter(Boolean) : [];
  });
  const [lengthPref, setLengthPref] = useState<string | null>(() => searchParams.get("length"));
  const [fictionPref, setFictionPref] = useState<string | null>(() => searchParams.get("fiction"));
  const [audiencePref, setAudiencePref] = useState<string | null>(() => searchParams.get("audience"));
  const [libraryFilter, setLibraryFilter] = useState<string | null>(() => searchParams.get("library"));
  const [seriesStarters, setSeriesStarters] = useState(() => searchParams.get("starters") === "1");
  const [ignorePreferences, setIgnorePreferences] = useState(() => searchParams.get("ignore") === "1");
  const [results, setResults] = useState<DiscoverResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const initialLoadDone = useRef(false);

  // Sync filter state → URL params (replaces current history entry so back still works)
  const syncUrl = useCallback((moods: string[], length: string | null, fiction: string | null, audience: string | null, library: string | null, starters: boolean, ignore: boolean, hasResults: boolean) => {
    const params = new URLSearchParams();
    if (moods.length > 0) params.set("moods", moods.join(","));
    if (length) params.set("length", length);
    if (fiction) params.set("fiction", fiction);
    if (audience) params.set("audience", audience);
    if (library) params.set("library", library);
    if (starters) params.set("starters", "1");
    if (ignore) params.set("ignore", "1");
    if (hasResults) params.set("searched", "1");
    const qs = params.toString();
    const newUrl = qs ? `/discover?${qs}` : "/discover";
    window.history.replaceState(null, "", newUrl);
  }, []);

  // Auto-restore results if URL has "searched" param (user navigated back)
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;
    if (searchParams.get("searched") === "1" && selectedMoods.length > 0) {
      handleDiscover(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleMood(key: string) {
    setSelectedMoods((prev) =>
      prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]
    );
  }

  async function handleDiscover(skipScroll = false) {
    if (selectedMoods.length === 0) return;
    setLoading(true);
    setSearched(false);
    try {
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moods: selectedMoods,
          length: lengthPref,
          fictionFilter: fictionPref,
          audience: audiencePref,
          libraryFilter: libraryFilter,
          seriesStartersOnly: seriesStarters,
          ignorePreferences,
        }),
      });
      const data: DiscoverResult[] = await res.json();
      setResults(data);
      setSearched(true);

      // Update URL with current filters + searched flag
      syncUrl(selectedMoods, lengthPref, fictionPref, audiencePref, libraryFilter, seriesStarters, ignorePreferences, true);

      if (!skipScroll) {
        setTimeout(() => {
          const el = resultsRef.current;
          if (el) {
            const y = el.getBoundingClientRect().top + window.scrollY - 80;
            window.scrollTo({ top: y, behavior: "smooth" });
          }
        }, 100);
      }
    } catch {
      setResults([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lg:max-w-[60%] lg:mx-auto">
      {/* Page heading + info button */}
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-foreground text-2xl font-bold tracking-tight">
            Find Your Next Read
          </h1>
          <InfoBubble>
            <p className="font-medium text-foreground mb-1">How Discover works</p>
            <p>Select one or more moods to describe what you&apos;re looking for. We&apos;ll match books based on genre overlap, content tone, and your reading preferences. Length filters nudge results toward your preferred page count.</p>
            <p className="mt-1.5">Results are personalized &mdash; books that exceed your content comfort zone or belong to genres you&apos;ve marked as &ldquo;avoid&rdquo; are filtered out. Use the &ldquo;Ignore my preferences&rdquo; toggle to override this.</p>
          </InfoBubble>
        </div>
        <p className="mt-2 text-muted text-sm">
          Select moods, set your filters, and we&apos;ll find books to match.
        </p>
      </div>

      {/* ─── Mood Selection — Card Grid with ambient glow ─── */}
      <div className="mb-5 relative">
        {/* Ambient glow behind mood grid */}
        <div className="absolute inset-0 -inset-x-6 pointer-events-none" style={{
          background: "radial-gradient(ellipse 70% 40% at 50% 50%, var(--color-neon-purple) 0%, transparent 100%)",
          opacity: 0.04,
        }} />

        <label className="relative font-heading text-sm font-semibold text-muted block text-center mb-3">
          What are you in the mood for?
        </label>
        <div className="relative grid grid-cols-3 gap-2">
          {DISCOVER_MOODS.map((mood) => {
            const tint = MOOD_TINTS[mood.key] ?? { idle: "bg-surface-alt border-border", selected: "bg-surface-alt border-accent" };
            const isSelected = selectedMoods.includes(mood.key);
            return (
              <button
                key={mood.key}
                onClick={() => toggleMood(mood.key)}
                className={`rounded-xl p-3 text-center transition-all duration-200 border ${
                  isSelected
                    ? `${tint.selected} shadow-lg scale-[1.03]`
                    : `${tint.idle} hover:scale-[1.02]`
                }`}
              >
                <span className="text-xl block mb-1">{mood.emoji}</span>
                <span className={`text-[11px] font-medium block ${
                  isSelected ? "text-foreground" : "text-muted"
                }`}>
                  {mood.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Gradient divider ─── */}
      <div className="my-6 h-px bg-gradient-to-r from-transparent via-neon-purple/30 to-transparent" />

      {/* ─── Fiction/Non-fiction ─── */}
      <div className="mb-5">
        <label className="font-heading text-sm font-semibold text-muted block text-center mb-3">
          Fiction or non-fiction?
        </label>
        <div className="flex gap-2 justify-center">
          {FICTION_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setFictionPref((prev) => (prev === opt.key ? null : opt.key))}
              className={`rounded-lg px-4 py-2 text-sm font-medium border-2 transition-all ${
                fictionPref === opt.key
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border bg-surface-alt/50 text-muted hover:border-accent/30"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Gradient divider ─── */}
      <div className="my-6 h-px bg-gradient-to-r from-transparent via-neon-blue/20 to-transparent" />

      {/* ─── How long? ─── */}
      <div className="mb-5">
        <label className="font-heading text-sm font-semibold text-muted block text-center mb-3">
          How long?
        </label>
        <div className="flex gap-2 justify-center">
          {LENGTH_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setLengthPref((prev) => (prev === opt.key ? null : opt.key))}
              className={`rounded-lg px-3 py-2 text-center border-2 transition-all ${
                lengthPref === opt.key
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border bg-surface-alt/50 text-muted hover:border-accent/30"
              }`}
            >
              <span className="text-sm font-medium block">{opt.label}</span>
              <span className="text-[10px] text-muted">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ─── Gradient divider ─── */}
      <div className="my-6 h-px bg-gradient-to-r from-transparent via-accent/15 to-transparent" />

      {/* ─── Audience ─── */}
      <div className="mb-5">
        <label className="font-heading text-sm font-semibold text-muted block text-center mb-3">
          Audience
        </label>
        <div className="flex flex-wrap gap-2 justify-center">
          {AUDIENCE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setAudiencePref((prev) => (prev === opt.key ? null : opt.key))}
              className={`rounded-lg px-3 py-2 text-sm font-medium border-2 transition-all ${
                audiencePref === opt.key
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border bg-surface-alt/50 text-muted hover:border-accent/30"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Gradient divider ─── */}
      <div className="my-6 h-px bg-gradient-to-r from-transparent via-neon-purple/20 to-transparent" />

      {/* ─── Search in ─── */}
      <div className="mb-5">
        <label className="font-heading text-sm font-semibold text-muted block text-center mb-3">
          Search in
        </label>
        <div className="flex gap-2 justify-center">
          {([
            { key: null, label: "All Books" },
            { key: "tbr", label: "My TBR" },
            { key: "owned", label: "Books I Own" },
          ] as const).map((opt) => (
            <button
              key={opt.key ?? "all"}
              onClick={() => setLibraryFilter((prev) => (prev === opt.key ? null : opt.key))}
              className={`rounded-lg px-4 py-2 text-sm font-medium border-2 transition-all ${
                libraryFilter === opt.key
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border bg-surface-alt/50 text-muted hover:border-accent/30"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Toggles ─── */}
      <div className="mb-6 flex flex-wrap gap-2 justify-center">
        <TogglePill
          active={seriesStarters}
          onClick={() => setSeriesStarters((prev) => !prev)}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              <text x="12" y="14" textAnchor="middle" fontSize="10" fill="currentColor" stroke="none" fontWeight="bold">1</text>
            </svg>
          }
          label="Series starters only"
          color="accent"
        />
        <TogglePill
          active={ignorePreferences}
          onClick={() => setIgnorePreferences((prev) => !prev)}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
          }
          label="Ignore my preferences"
          color="neon-purple"
        />
      </div>

      {/* ─── Discover Button with pulse glow when moods selected ─── */}
      <div className="relative">
        {selectedMoods.length > 0 && !loading && (
          <div className="absolute inset-0 rounded-2xl animate-pulse bg-accent/20 blur-xl" />
        )}
        <button
          onClick={handleDiscover}
          disabled={selectedMoods.length === 0 || loading}
          className="relative w-full rounded-2xl bg-accent py-3.5 text-sm font-semibold text-black shadow-[0_0_20px_rgba(163,230,53,0.25)] hover:shadow-[0_0_28px_rgba(163,230,53,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Finding books..." : `Find Books${selectedMoods.length > 0 ? ` (${selectedMoods.length} mood${selectedMoods.length > 1 ? "s" : ""})` : ""}`}
        </button>
      </div>

      {/* ─── Results ─── */}
      <div ref={resultsRef}>
        {searched && results.length === 0 && !loading && (
          <div className="mt-8 text-center py-8">
            <span className="text-4xl block mb-3">💎</span>
            <p className="text-sm font-medium mb-1">No gems found</p>
            <p className="text-xs text-muted">Try different moods or loosen your filters.</p>
          </div>
        )}

        {results.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <p className="font-heading text-sm font-semibold text-muted">
                <span className="gem-sparkle">{results.length} gem{results.length !== 1 ? "s" : ""} found ✨</span>
              </p>
              <button
                onClick={handleDiscover}
                disabled={loading}
                className="text-xs font-medium text-accent hover:text-accent/80 transition-colors disabled:opacity-50"
              >
                ↻ Shuffle
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 lg:gap-4">
              {results.map((book) => (
                <Link
                  key={book.id}
                  href={`/book/${book.id}`}
                  className="group rounded-2xl border border-border bg-surface p-2.5 lg:p-2 hover:border-accent/30 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-accent/10"
                >
                  <div className="aspect-[2/3] relative rounded-lg overflow-hidden mb-2 shadow-md group-hover:shadow-lg transition-shadow">
                    {book.coverImageUrl ? (
                      <Image
                        src={book.coverImageUrl}
                        alt={`Cover of ${book.title}`}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 130px"
                      />
                    ) : (
                      <NoCover title={book.title} className="w-full h-full" />
                    )}
                  </div>
                  <h3 className="text-xs font-semibold leading-tight line-clamp-2 group-hover:text-accent transition-colors">
                    {book.title}
                  </h3>
                  {book.authors.length > 0 && (
                    <p className="text-[10px] text-muted mt-0.5 truncate">
                      {book.authors.join(", ")}
                    </p>
                  )}
                  {book.reason && (
                    <span className="gem-reason-tag flex items-start gap-1 text-[10px] mt-1.5 rounded-md bg-gradient-to-r from-accent/15 to-neon-blue/15 text-accent border border-accent/20 px-2 py-1 leading-snug">
                      <span className="flex-shrink-0">💎</span>
                      <span className="line-clamp-2">{book.reason}</span>
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function TogglePill({ active, onClick, icon, label, color }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  color: "accent" | "neon-purple";
}) {
  const activeClasses = color === "accent"
    ? "border-accent bg-accent/15 text-accent"
    : "border-neon-purple bg-neon-purple/15 text-neon-purple";

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium border-2 transition-all ${
        active ? activeClasses : "border-border bg-surface-alt/50 text-muted hover:border-accent/30"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
