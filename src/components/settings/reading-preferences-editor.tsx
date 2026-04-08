"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateReadingStyle,
  updateGenrePreference,
  updateContentPreference,
} from "@/lib/actions/reading-preferences";
import { FICTION_GENRES, NONFICTION_GENRES } from "@/lib/genre-taxonomy";
import type { ReadingPreferencesData } from "@/lib/queries/reading-preferences";
import Link from "next/link";
import {
  CANONICAL_WARNINGS,
  canonicalizeWarning,
  getWarningLabel,
} from "@/lib/content-warnings/vocabulary";

// ─── Constants (shared with onboarding) ───

const MOODS = [
  // Core reading moods (aligned with review moods + discover moods for algo matching)
  { key: "cozy", label: "Cozy" },
  { key: "dark", label: "Dark" },
  { key: "funny", label: "Funny" },
  { key: "emotional", label: "Emotional" },
  { key: "thrilling", label: "Thrilling" },
  { key: "romantic", label: "Romantic" },
  { key: "inspiring", label: "Inspiring" },
  { key: "adventurous", label: "Adventurous" },
  { key: "thought-provoking", label: "Thought-provoking" },
  { key: "contemplative", label: "Contemplative" },
  { key: "mind-blown", label: "Mind-blowing" },
  { key: "nostalgic", label: "Nostalgic" },
  { key: "spooky", label: "Spooky" },
  { key: "informative", label: "Informative" },
  { key: "happy", label: "Feel-good" },
  { key: "angry", label: "Rage-inducing" },
  { key: "fantastical", label: "Fantastical" },
  { key: "historical", label: "Historical" },
  { key: "sciencey", label: "Science-y" },
];

const PACES = [
  { key: "slow", label: "Slow" },
  { key: "medium", label: "Steady" },
  { key: "fast", label: "Fast" },
  { key: "any", label: "Any" },
];

const LENGTHS = [
  { key: "short", label: "Short (<200pp)", min: null, max: 200 },
  { key: "medium", label: "Medium (200-400pp)", min: 200, max: 400 },
  { key: "long", label: "Long (400+pp)", min: 400, max: null },
  { key: "any", label: "Any", min: null, max: null },
];

const STORY_FOCUS_OPTIONS = [
  { key: "worldbuilding", label: "Worldbuilding" },
  { key: "plot", label: "Plot" },
  { key: "characters", label: "Characters" },
  { key: "mix", label: "A mix" },
];

const CHARACTER_TROPES = [
  { key: "morally-grey", label: "Morally grey" },
  { key: "found-family", label: "Found family" },
  { key: "enemies-to-lovers", label: "Enemies to lovers" },
  { key: "unreliable-narrator", label: "Unreliable narrator" },
  { key: "strong-female-lead", label: "Strong female lead" },
  { key: "anti-hero", label: "Anti-hero" },
  { key: "chosen-one", label: "Chosen one" },
  { key: "slow-burn", label: "Slow burn romance" },
  { key: "reluctant-hero", label: "Reluctant hero" },
  { key: "complex-villain", label: "Complex villain" },
  { key: "dual-pov", label: "Dual / multiple POV" },
  { key: "mentor-figure", label: "Mentor figure" },
  { key: "redemption-arc", label: "Redemption arc" },
  { key: "fish-out-of-water", label: "Fish out of water" },
];

const CONTENT_CATEGORIES = [
  { key: "42ad1bfb-09dc-4ffd-aafe-bf6cef50ab6f", name: "Violence & gore" },
  { key: "4ba66d94-2d8b-4558-858c-5643c5ae9864", name: "Sexual content" },
  { key: "3c766289-4965-4222-a555-50325c8be015", name: "Profanity / language" },
  { key: "65867b4b-8b92-4a1a-8c1c-b454d8b06fd8", name: "Substance use" },
  { key: "6e027cc3-9ad2-431f-9fc0-89c997c33b3e", name: "Self-harm / suicide" },
  { key: "4b8dc655-d645-4fec-b177-3a4fd4568134", name: "Sexual assault / coercion" },
  { key: "be479980-2b8a-4693-9ac9-ca22b7a46183", name: "Abuse & suffering" },
  { key: "dd567829-ccf2-43a4-b2e2-9bc1946313a8", name: "Religious content" },
  { key: "895cee59-f605-49b5-9e8a-905cfe36c455", name: "Witchcraft / occult" },
  { key: "81076008-d213-45b0-bf7e-2509d75191b2", name: "Political & ideological" },
  { key: "ca67197a-61d3-4f2a-9441-5c23757b1515", name: "LGBTQ+ representation" },
];

const TOLERANCE_LABELS = [
  { value: 0, label: "None" },
  { value: 1, label: "Mild" },
  { value: 2, label: "Moderate" },
  { value: 4, label: "Any" },
];

const FICTION_LIST = [...FICTION_GENRES].filter(
  (g) => !["Dystopia", "Crime Fiction"].includes(g)
);
const NONFICTION_LIST = [...NONFICTION_GENRES].filter(
  (g) => g !== "Nonfiction"
);

// ─── Helpers ───

function getLengthKey(min: number | null, max: number | null): string | null {
  // (null, null) means "Any" — the user explicitly chose no length preference
  if (min === null && max === null) return "any";
  for (const l of LENGTHS) {
    if (l.min === min && l.max === max) return l.key;
  }
  return null;
}

// ─── Component ───

export function ReadingPreferencesEditor({
  initialPrefs,
}: {
  initialPrefs: ReadingPreferencesData | null;
}) {
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // No prefs yet — show setup prompt
  if (!initialPrefs) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="section-heading text-lg mb-1">Reading Preferences</h2>
        <p className="text-sm text-muted mb-3">
          Set up your taste profile to get better recommendations.
        </p>
        <Link
          href="/onboarding"
          className="inline-block rounded-xl bg-accent text-black px-4 py-2 text-sm font-semibold hover:brightness-110 transition-all"
        >
          Set Up Preferences
        </Link>
      </div>
    );
  }

  function toggleSection(key: string) {
    setOpenSection((prev) => (prev === key ? null : key));
  }

  // ─── Genre state ───
  const [genrePrefs, setGenrePrefs] = useState<Record<string, "love" | "dislike">>(() =>
    Object.fromEntries(
      initialPrefs.genrePreferences.map((g) => [g.genreName, g.preference as "love" | "dislike"])
    )
  );

  function handleGenreToggle(genre: string) {
    const current = genrePrefs[genre];
    let newPref: "love" | "dislike" | null;
    if (!current) newPref = "love";
    else if (current === "love") newPref = "dislike";
    else newPref = null;

    setGenrePrefs((prev) => {
      const next = { ...prev };
      if (newPref) next[genre] = newPref;
      else delete next[genre];
      return next;
    });

    startTransition(async () => {
      await updateGenrePreference(genre, newPref);
    });
  }

  // ─── Content state ───
  const [contentPrefs, setContentPrefs] = useState<Record<string, number>>(() => {
    const defaults: Record<string, number> = {};
    for (const cat of CONTENT_CATEGORIES) defaults[cat.key] = 4;
    for (const cp of initialPrefs.contentPreferences) {
      defaults[cp.categoryId] = cp.maxTolerance;
    }
    return defaults;
  });

  function handleContentChange(categoryId: string, value: number) {
    setContentPrefs((prev) => ({ ...prev, [categoryId]: value }));
    startTransition(async () => {
      await updateContentPreference(categoryId, value);
    });
  }

  // ─── Style state ───
  const [fictionPref, setFictionPref] = useState(initialPrefs.fictionPreference);
  // Parse pace: could be JSON array string, single value, or null
  const [paceSet, setPaceSet] = useState<Set<string>>(() => {
    const raw = initialPrefs.pacePreference;
    if (!raw) return new Set(["any"]);
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed);
    } catch {
      // Legacy single value
    }
    return new Set([raw]);
  });
  const [lengthPref, setLengthPref] = useState(
    getLengthKey(initialPrefs.pageLengthMin, initialPrefs.pageLengthMax)
  );
  const [moodSet, setMoodSet] = useState(new Set(initialPrefs.moodPreferences));

  // ─── Story preferences state ───
  const [storyFocus, setStoryFocusState] = useState(initialPrefs.storyFocus);
  const [tropePrefs, setTropePrefs] = useState<Record<string, "like" | "dislike">>(() => {
    const prefs: Record<string, "like" | "dislike"> = {};
    for (const t of initialPrefs.characterTropes) prefs[t] = "like";
    for (const t of initialPrefs.dislikedTropes) prefs[t] = "dislike";
    return prefs;
  });
  const [customWarnings, setCustomWarnings] = useState<string[]>(initialPrefs.customContentWarnings);
  const [warningInput, setWarningInput] = useState("");

  // Filter suggestions against the current input — simple substring match over
  // canonical labels + aliases, capped at 6 results. Hidden when input is empty.
  const warningSuggestions = (() => {
    const q = warningInput.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    const matches: { id: string; label: string }[] = [];
    for (const w of CANONICAL_WARNINGS) {
      if (customWarnings.includes(w.id)) continue;
      const hit =
        w.label.toLowerCase().includes(q) ||
        w.id.includes(q) ||
        w.aliases.some((a) => a.includes(q));
      if (hit) matches.push({ id: w.id, label: w.label });
      if (matches.length >= 6) break;
    }
    return matches;
  })();

  function handleStyleUpdate(updates: Parameters<typeof updateReadingStyle>[0]) {
    startTransition(async () => {
      await updateReadingStyle(updates);
    });
  }

  function addWarning(rawOrCanonical: string) {
    const canonical = canonicalizeWarning(rawOrCanonical) ?? rawOrCanonical.trim().toLowerCase();
    if (!canonical || customWarnings.includes(canonical)) return;
    const updated = [...customWarnings, canonical];
    setCustomWarnings(updated);
    setWarningInput("");
    handleStyleUpdate({ customContentWarnings: updated });
  }

  function handleAddWarning() {
    const trimmed = warningInput.trim();
    if (trimmed) addWarning(trimmed);
  }

  function handleRemoveWarning(warning: string) {
    const updated = customWarnings.filter((w) => w !== warning);
    setCustomWarnings(updated);
    handleStyleUpdate({ customContentWarnings: updated });
  }

  // ─── Summary line ───
  const lovedCount = Object.values(genrePrefs).filter((v) => v === "love").length;
  const dislikedCount = Object.values(genrePrefs).filter((v) => v === "dislike").length;
  const restrictedCount = Object.values(contentPrefs).filter((v) => v < 4).length;

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center justify-between">
          <h2 className="section-heading text-lg">Reading Preferences</h2>
          <span className="text-[11px] text-muted bg-surface-hover px-2 py-0.5 rounded-full">Auto-saved</span>
        </div>
        <p className="text-xs text-muted mt-0.5">
          {lovedCount > 0 && `${lovedCount} loved genre${lovedCount !== 1 ? "s" : ""}`}
          {lovedCount > 0 && dislikedCount > 0 && " · "}
          {dislikedCount > 0 && `${dislikedCount} disliked`}
          {(lovedCount > 0 || dislikedCount > 0) && restrictedCount > 0 && " · "}
          {restrictedCount > 0 && `${restrictedCount} content filter${restrictedCount !== 1 ? "s" : ""}`}
          {lovedCount === 0 && dislikedCount === 0 && restrictedCount === 0 && "No preferences set yet"}
        </p>
      </div>

      {/* Genres */}
      <AccordionSection
        title="Genre Preferences"
        open={openSection === "genres"}
        onToggle={() => toggleSection("genres")}
      >
        <div className="space-y-4">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Fiction</h4>
            <div className="flex flex-wrap gap-1.5">
              {FICTION_LIST.map((genre) => (
                <GenrePill
                  key={genre}
                  genre={genre}
                  state={genrePrefs[genre] ?? null}
                  onToggle={handleGenreToggle}
                />
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Nonfiction</h4>
            <div className="flex flex-wrap gap-1.5">
              {NONFICTION_LIST.map((genre) => (
                <GenrePill
                  key={genre}
                  genre={genre}
                  state={genrePrefs[genre] ?? null}
                  onToggle={handleGenreToggle}
                />
              ))}
            </div>
          </div>
        </div>
      </AccordionSection>

      {/* Reading Style */}
      <AccordionSection
        title="Reading Style"
        open={openSection === "style"}
        onToggle={() => toggleSection("style")}
      >
        <div className="space-y-5">
          {/* Fiction preference */}
          <div>
            <h4 className="text-xs font-semibold mb-2">I read mostly</h4>
            <div className="flex gap-2">
              {["fiction", "nonfiction", "both"].map((opt) => (
                <button
                  key={opt}
                  onClick={() => {
                    const newVal = fictionPref === opt ? null : opt;
                    setFictionPref(newVal);
                    handleStyleUpdate({ fictionPreference: newVal });
                  }}
                  className={`flex-1 rounded-lg py-2 text-xs font-medium capitalize transition-all ${
                    fictionPref === opt
                      ? "bg-accent text-black"
                      : "bg-surface-alt text-muted hover:text-foreground"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Pace */}
          <div>
            <h4 className="text-xs font-semibold mb-2">Preferred pace</h4>
            <p className="text-[10px] text-muted mb-1.5">Select one or more.</p>
            <div className="flex gap-2">
              {PACES.map((p) => (
                <button
                  key={p.key}
                  onClick={() => {
                    const next = new Set(paceSet);
                    if (p.key === "any") {
                      // "Any" deselects all others
                      if (next.has("any")) return; // already "any", no-op
                      setPaceSet(new Set(["any"]));
                      handleStyleUpdate({ pacePreference: null });
                      return;
                    }
                    // Selecting a specific option deselects "Any"
                    next.delete("any");
                    if (next.has(p.key)) {
                      next.delete(p.key);
                    } else {
                      next.add(p.key);
                    }
                    // If nothing selected, revert to "any"
                    if (next.size === 0) {
                      setPaceSet(new Set(["any"]));
                      handleStyleUpdate({ pacePreference: null });
                      return;
                    }
                    setPaceSet(next);
                    handleStyleUpdate({ pacePreference: JSON.stringify([...next]) });
                  }}
                  className={`flex-1 rounded-lg py-2 text-xs font-medium transition-all ${
                    paceSet.has(p.key)
                      ? "bg-neon-blue/20 border border-neon-blue/30"
                      : "bg-surface-alt text-muted border border-transparent"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Length */}
          <div>
            <h4 className="text-xs font-semibold mb-2">Preferred length</h4>
            <div className="flex gap-2">
              {LENGTHS.map((l) => (
                <button
                  key={l.key}
                  onClick={() => {
                    const newVal = lengthPref === l.key ? null : l.key;
                    setLengthPref(newVal);
                    const opt = newVal && newVal !== "any" ? LENGTHS.find((ll) => ll.key === newVal) : null;
                    handleStyleUpdate({
                      pageLengthMin: opt?.min ?? null,
                      pageLengthMax: opt?.max ?? null,
                    });
                  }}
                  className={`flex-1 rounded-lg py-2 text-xs font-medium transition-all ${
                    lengthPref === l.key
                      ? "bg-neon-blue/20 border border-neon-blue/30"
                      : "bg-surface-alt text-muted border border-transparent"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* Moods */}
          <div>
            <h4 className="text-xs font-semibold mb-2">Preferred moods</h4>
            <div className="flex flex-wrap gap-1.5">
              {MOODS.map((m) => {
                const active = moodSet.has(m.key);
                return (
                  <button
                    key={m.key}
                    onClick={() => {
                      const newSet = new Set(moodSet);
                      if (active) newSet.delete(m.key);
                      else newSet.add(m.key);
                      setMoodSet(newSet);
                      handleStyleUpdate({ moodPreferences: [...newSet] });
                    }}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-all border ${
                      active
                        ? "bg-neon-purple/20 text-neon-purple border-neon-purple/30"
                        : "bg-surface-alt text-muted border-transparent"
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </AccordionSection>

      {/* Story Preferences */}
      <AccordionSection
        title="Story Preferences"
        open={openSection === "story"}
        onToggle={() => toggleSection("story")}
      >
        <div className="space-y-5">
          <div>
            <h4 className="text-xs font-semibold mb-2">I care most about</h4>
            <div className="flex flex-wrap gap-2">
              {STORY_FOCUS_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => {
                    const newVal = storyFocus === opt.key ? null : opt.key;
                    setStoryFocusState(newVal);
                    handleStyleUpdate({ storyFocus: newVal });
                  }}
                  className={`rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                    storyFocus === opt.key
                      ? "bg-neon-blue/20 border border-neon-blue/30"
                      : "bg-surface-alt text-muted border border-transparent hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold mb-2">Character types</h4>
            <p className="text-[10px] text-muted mb-1.5">Tap to like, tap again to dislike, once more to clear.</p>
            <div className="flex flex-wrap gap-1.5">
              {CHARACTER_TROPES.map((t) => {
                const state = tropePrefs[t.key] ?? null;
                return (
                  <button
                    key={t.key}
                    onClick={() => {
                      const next = { ...tropePrefs };
                      let newState: "like" | "dislike" | null;
                      if (!state) {
                        newState = "like";
                        next[t.key] = "like";
                      } else if (state === "like") {
                        newState = "dislike";
                        next[t.key] = "dislike";
                      } else {
                        newState = null;
                        delete next[t.key];
                      }
                      setTropePrefs(next);
                      const liked = Object.entries(next).filter(([, v]) => v === "like").map(([k]) => k);
                      const disliked = Object.entries(next).filter(([, v]) => v === "dislike").map(([k]) => k);
                      handleStyleUpdate({ characterTropes: liked, dislikedTropes: disliked });
                    }}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-all border ${
                      state === "like"
                        ? "bg-accent/20 text-accent-dark border-accent/40"
                        : state === "dislike"
                          ? "bg-destructive/15 text-destructive border-destructive/30"
                          : "bg-surface-alt text-muted border-transparent"
                    }`}
                  >
                    {state === "like" && "\u2665 "}
                    {state === "dislike" && "\u2715 "}
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </AccordionSection>

      {/* Content Comfort Zone */}
      <AccordionSection
        title="Content Comfort Zone"
        open={openSection === "content"}
        onToggle={() => toggleSection("content")}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            {CONTENT_CATEGORIES.map((cat) => (
              <div
                key={cat.key}
                className="flex items-center justify-between rounded-lg bg-surface-alt px-3 py-2.5"
              >
                <span className="text-xs font-medium">{cat.name}</span>
                <div className="flex gap-1">
                  {TOLERANCE_LABELS.map((tl) => (
                    <button
                      key={tl.value}
                      onClick={() => handleContentChange(cat.key, tl.value)}
                      className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-all ${
                        contentPrefs[cat.key] === tl.value
                          ? tl.value === 0
                            ? "bg-destructive/20 text-destructive"
                            : tl.value === 1
                              ? "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400"
                              : tl.value === 2
                                ? "bg-orange-500/20 text-orange-600 dark:text-orange-400"
                                : "bg-accent/20 text-accent-dark"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      {tl.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Custom warnings */}
          <div>
            <h4 className="text-xs font-semibold mb-1">Custom topics to avoid</h4>
            <p className="text-[11px] text-muted mb-2 leading-relaxed">
              Type to see suggestions. Matched topics get compared against reviews
              so books that many readers flagged for the same topic get downranked
              in your recommendations.
            </p>
            <div className="relative">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={warningInput}
                  onChange={(e) => setWarningInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      // Enter picks the first suggestion if one exists, otherwise
                      // adds the raw free text (still canonicalized on save).
                      if (warningSuggestions.length > 0) {
                        addWarning(warningSuggestions[0].id);
                      } else {
                        handleAddWarning();
                      }
                    }
                  }}
                  placeholder="e.g. infidelity, animal death"
                  className="flex-1 rounded-lg bg-surface-alt px-3 py-2 text-xs text-foreground placeholder:text-muted border border-transparent focus:border-accent/40 focus:outline-none transition-colors"
                />
                <button
                  onClick={handleAddWarning}
                  className="rounded-lg bg-surface-alt px-3 py-2 text-xs font-medium text-muted hover:text-foreground transition-colors"
                >
                  Add
                </button>
              </div>
              {warningSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-lg border border-border bg-surface shadow-lg overflow-hidden">
                  {warningSuggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        addWarning(s.id);
                      }}
                      className="block w-full text-left px-3 py-2 text-xs text-foreground hover:bg-surface-alt transition-colors border-b border-border/40 last:border-b-0"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {customWarnings.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {customWarnings.map((w) => (
                  <span
                    key={w}
                    className="inline-flex items-center gap-1 rounded-full bg-destructive/10 border border-destructive/20 px-2.5 py-0.5 text-[10px] font-medium text-destructive"
                  >
                    {getWarningLabel(w)}
                    <button
                      onClick={() => handleRemoveWarning(w)}
                      className="hover:text-destructive/70 transition-colors"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </AccordionSection>
    </div>
  );
}

// ─── Shared sub-components ───

function AccordionSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-5 py-3.5 text-sm font-medium text-foreground hover:bg-surface-alt/50 transition-colors"
      >
        {title}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`transition-transform text-muted ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  );
}

function GenrePill({
  genre,
  state,
  onToggle,
}: {
  genre: string;
  state: "love" | "dislike" | null;
  onToggle: (genre: string) => void;
}) {
  const stateClass =
    state === "love"
      ? "bg-accent/20 text-accent-dark border-accent/40"
      : state === "dislike"
        ? "bg-destructive/15 text-destructive border-destructive/30"
        : "bg-surface-alt text-muted border-transparent hover:text-foreground";

  return (
    <button
      onClick={() => onToggle(genre)}
      className={`rounded-full px-3 py-1 text-[11px] font-medium transition-all border ${stateClass}`}
    >
      {state === "love" && "♥ "}
      {state === "dislike" && "✕ "}
      {genre}
    </button>
  );
}
