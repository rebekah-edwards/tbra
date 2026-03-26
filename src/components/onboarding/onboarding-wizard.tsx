"use client";

import { useState, useTransition, useEffect } from "react";
import { createPortal } from "react-dom";
import { saveOnboardingPreferences } from "@/lib/actions/reading-preferences";
import { FICTION_GENRES, NONFICTION_GENRES } from "@/lib/genre-taxonomy";

// ─── Constants ───

const MOODS = [
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
  { key: "short", label: "Short", description: "< 200 pp", min: null, max: 200 },
  { key: "medium", label: "Medium", description: "200–400 pp", min: 200, max: 400 },
  { key: "long", label: "Long", description: "400+ pp", min: 400, max: null },
  { key: "any", label: "Any", description: "No preference", min: null, max: null },
];

const STORY_FOCUS_OPTIONS = [
  { key: "worldbuilding", label: "Worldbuilding", description: "Rich, immersive settings" },
  { key: "plot", label: "Plot", description: "Twists & momentum" },
  { key: "characters", label: "Characters", description: "Deep, complex people" },
  { key: "mix", label: "A mix", description: "A balance of all three" },
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

// Content categories matching seed data (excluding user_added)
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
  { key: "ca67197a-61d3-4f2a-9441-5c23757b1515", name: "LGBTQIA+ representation" },
];

const TOLERANCE_LABELS = [
  { value: 0, label: "None" },
  { value: 1, label: "Mild" },
  { value: 2, label: "Moderate" },
  { value: 4, label: "Any" },
];

// ─── Genre lists for display ───

const FICTION_LIST = [...FICTION_GENRES].filter(
  (g) => !["Dystopia", "Crime Fiction"].includes(g)
);
const NONFICTION_LIST = [...NONFICTION_GENRES].filter(
  (g) => g !== "Nonfiction"
);

// ─── Main Wizard ───

export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [isPending, startTransition] = useTransition();

  // Step 0: Genres
  const [fictionPref, setFictionPref] = useState<string | null>(null);
  const [genrePrefs, setGenrePrefs] = useState<
    Record<string, "love" | "dislike">
  >({});

  // Step 1: Reading Style
  const [paces, setPaces] = useState<Set<string>>(new Set());
  const [lengthPref, setLengthPref] = useState<string | null>(null);
  const [moods, setMoods] = useState<Set<string>>(new Set());

  // Step 2: Story Preferences
  const [storyFocus, setStoryFocus] = useState<string | null>(null);
  const [tropePrefs, setTropePrefs] = useState<Record<string, "like" | "dislike">>({});

  // Step 3: Content Comfort Zone
  const [contentPrefs, setContentPrefs] = useState<Record<string, number>>(
    () =>
      Object.fromEntries(CONTENT_CATEGORIES.map((c) => [c.key, 4]))
  );
  const [customWarnings, setCustomWarnings] = useState<string[]>([]);
  const [warningInput, setWarningInput] = useState("");

  function toggleGenrePref(genre: string) {
    setGenrePrefs((prev) => {
      const current = prev[genre];
      const next = { ...prev };
      if (!current) {
        next[genre] = "love";
      } else if (current === "love") {
        next[genre] = "dislike";
      } else {
        delete next[genre];
      }
      return next;
    });
  }

  function togglePace(key: string) {
    setPaces((prev) => {
      const next = new Set(prev);
      if (key === "any") {
        // "Any" deselects all others
        return next.has("any") ? new Set() : new Set(["any"]);
      }
      // Selecting a specific option deselects "Any"
      next.delete("any");
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleMood(key: string) {
    setMoods((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleTrope(key: string) {
    setTropePrefs((prev) => {
      const current = prev[key];
      const next = { ...prev };
      if (!current) {
        next[key] = "like";
      } else if (current === "like") {
        next[key] = "dislike";
      } else {
        delete next[key];
      }
      return next;
    });
  }

  function addCustomWarning() {
    const trimmed = warningInput.trim();
    if (trimmed && !customWarnings.includes(trimmed.toLowerCase())) {
      setCustomWarnings((prev) => [...prev, trimmed.toLowerCase()]);
      setWarningInput("");
    }
  }

  function removeCustomWarning(warning: string) {
    setCustomWarnings((prev) => prev.filter((w) => w !== warning));
  }

  function handleSubmit() {
    const lengthOption = lengthPref && lengthPref !== "any"
      ? LENGTHS.find((l) => l.key === lengthPref)
      : null;

    // Resolve pace: "any" or empty set means null, otherwise store the selected paces
    const resolvedPaces = paces.has("any") || paces.size === 0
      ? null
      : [...paces];

    // Resolve tropes: split into liked and disliked arrays
    const likedTropes = Object.entries(tropePrefs)
      .filter(([, v]) => v === "like")
      .map(([k]) => k);
    const dislikedTropes = Object.entries(tropePrefs)
      .filter(([, v]) => v === "dislike")
      .map(([k]) => k);

    startTransition(async () => {
      const result = await saveOnboardingPreferences({
        fictionPreference: fictionPref,
        pageLengthMin: lengthOption?.min ?? null,
        pageLengthMax: lengthOption?.max ?? null,
        pacePreference: resolvedPaces ? JSON.stringify(resolvedPaces) : null,
        moodPreferences: [...moods],
        storyFocus: storyFocus,
        characterTropes: likedTropes,
        dislikedTropes: dislikedTropes,
        customContentWarnings: customWarnings,
        genrePreferences: Object.entries(genrePrefs).map(([genreName, preference]) => ({
          genreName,
          preference,
        })),
        contentPreferences: Object.entries(contentPrefs)
          .filter(([, tol]) => tol < 4)
          .map(([categoryId, maxTolerance]) => ({
            categoryId,
            maxTolerance,
          })),
      });
      if (result.success) {
        // Force hard navigation to ensure the portal unmounts and redirect completes
        window.location.href = "/";
      }
    });
  }

  const totalSteps = 5;
  const progress = ((step + 1) / totalSteps) * 100;
  const isLastStep = step === totalSteps - 1;

  // Mount portal after hydration
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const content = (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs font-medium text-muted uppercase tracking-wide">
          Step {step + 1} of {totalSteps}
        </span>
        <button
          onClick={handleSubmit}
          className="p-2 -m-2 text-foreground/60 hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-surface-alt">
        <div
          className="h-full bg-accent transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 py-6">
        {step === 0 && (
          <StepGenres
            fictionPref={fictionPref}
            setFictionPref={setFictionPref}
            genrePrefs={genrePrefs}
            toggleGenrePref={toggleGenrePref}
          />
        )}
        {step === 1 && (
          <StepStyle
            paces={paces}
            togglePace={togglePace}
            lengthPref={lengthPref}
            setLengthPref={setLengthPref}
            moods={moods}
            toggleMood={toggleMood}
          />
        )}
        {step === 2 && (
          <StepStoryPreferences
            storyFocus={storyFocus}
            setStoryFocus={setStoryFocus}
            tropePrefs={tropePrefs}
            toggleTrope={toggleTrope}
          />
        )}
        {step === 3 && (
          <StepContent
            contentPrefs={contentPrefs}
            setContentPrefs={setContentPrefs}
            customWarnings={customWarnings}
            warningInput={warningInput}
            setWarningInput={setWarningInput}
            addCustomWarning={addCustomWarning}
            removeCustomWarning={removeCustomWarning}
          />
        )}
        {step === 4 && <StepSummary />}
      </div>

      {/* Footer */}
      <div className="px-4 py-4 pb-8 border-t border-surface-alt">
        <div className="flex gap-3 max-w-lg mx-auto">
          {step > 0 ? (
            <button
              onClick={() => setStep(step - 1)}
              className="flex-1 text-sm text-muted hover:text-foreground py-3 transition-colors"
            >
              Back
            </button>
          ) : (
            <div className="flex-1" />
          )}
          {!isLastStep && (
            <button
              onClick={() => setStep(step + 1)}
              className="flex-1 text-sm text-muted hover:text-foreground py-3 transition-colors"
            >
              Skip
            </button>
          )}
          <button
            onClick={() => (isLastStep ? handleSubmit() : setStep(step + 1))}
            disabled={isPending}
            className={`flex-[2] py-3 rounded-xl font-medium transition-all ${
              isPending
                ? "bg-accent/50 text-black/50"
                : "bg-accent text-black hover:brightness-110 active:scale-[0.98]"
            }`}
          >
            {isPending ? "Saving..." : isLastStep ? "Start Reading" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(content, document.body);
}

// ─── Step 0: Genres ───

function StepGenres({
  fictionPref,
  setFictionPref,
  genrePrefs,
  toggleGenrePref,
}: {
  fictionPref: string | null;
  setFictionPref: (v: string | null) => void;
  genrePrefs: Record<string, "love" | "dislike">;
  toggleGenrePref: (genre: string) => void;
}) {
  const fictionOptions = [
    { key: "fiction", label: "Fiction" },
    { key: "nonfiction", label: "Nonfiction" },
    { key: "both", label: "Both" },
  ];

  const showFiction = fictionPref === "fiction" || fictionPref === "both";
  const showNonfiction = fictionPref === "nonfiction" || fictionPref === "both";

  return (
    <div className="space-y-6">
      <div>
        <h2
          className="text-xl font-bold tracking-tight"
         
        >
          What do you like to read?
        </h2>
        <p className="text-sm text-muted mt-1">
          {fictionPref
            ? "Tap a genre to love it, tap again to dislike, and once more to clear."
            : "We\u2019ll use your selections to recommend books you\u2019re most likely to enjoy."}
        </p>
      </div>

      {/* Fiction/Nonfiction/Both toggle */}
      <div className="flex gap-2">
        {fictionOptions.map((opt) => (
          <button
            key={opt.key}
            onClick={() =>
              setFictionPref(fictionPref === opt.key ? null : opt.key)
            }
            className={`flex-1 rounded-xl py-3 text-sm font-semibold transition-all ${
              fictionPref === opt.key
                ? "bg-accent text-black"
                : "bg-surface-alt text-muted hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Genre pills */}
      {fictionPref && (
        <div className="space-y-4">
          {showFiction && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                Fiction
              </h3>
              <div className="flex flex-wrap gap-2">
                {FICTION_LIST.map((genre) => (
                  <GenrePill
                    key={genre}
                    genre={genre}
                    state={genrePrefs[genre] ?? null}
                    onToggle={toggleGenrePref}
                  />
                ))}
              </div>
            </div>
          )}
          {showNonfiction && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                Nonfiction
              </h3>
              <div className="flex flex-wrap gap-2">
                {NONFICTION_LIST.map((genre) => (
                  <GenrePill
                    key={genre}
                    genre={genre}
                    state={genrePrefs[genre] ?? null}
                    onToggle={toggleGenrePref}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
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
  const baseClass = "rounded-full px-3.5 py-1.5 text-xs font-medium transition-all border";
  const stateClass =
    state === "love"
      ? "bg-accent/20 text-accent-dark border-accent/40"
      : state === "dislike"
        ? "bg-destructive/15 text-destructive border-destructive/30"
        : "bg-surface-alt text-muted border-transparent hover:text-foreground";

  return (
    <button onClick={() => onToggle(genre)} className={`${baseClass} ${stateClass}`}>
      {state === "love" && "♥ "}
      {state === "dislike" && "✕ "}
      {genre}
    </button>
  );
}

// ─── Step 1: Reading Style ───

function StepStyle({
  paces,
  togglePace,
  lengthPref,
  setLengthPref,
  moods,
  toggleMood,
}: {
  paces: Set<string>;
  togglePace: (key: string) => void;
  lengthPref: string | null;
  setLengthPref: (v: string | null) => void;
  moods: Set<string>;
  toggleMood: (key: string) => void;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h2
          className="text-xl font-bold tracking-tight"
         
        >
          Your reading style
        </h2>
        <p className="text-sm text-muted mt-1">
          These are soft preferences — we&rsquo;ll weight recommendations toward
          what you like, but you&rsquo;ll still see books outside these picks.
        </p>
      </div>

      {/* Pace */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Preferred pace</h3>
        <p className="text-xs text-muted mb-2">Select one or more.</p>
        <div className="flex gap-2">
          {PACES.map((p) => (
            <button
              key={p.key}
              onClick={() => togglePace(p.key)}
              className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition-all ${
                paces.has(p.key)
                  ? "bg-neon-blue/20 text-neon-blue border border-neon-blue/30"
                  : "bg-surface-alt text-muted border border-transparent hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Length */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Preferred length</h3>
        <div className="flex gap-2">
          {LENGTHS.map((l) => (
            <button
              key={l.key}
              onClick={() =>
                setLengthPref(lengthPref === l.key ? null : l.key)
              }
              className={`flex-1 rounded-xl py-2.5 text-center transition-all ${
                lengthPref === l.key
                  ? "bg-neon-blue/20 text-neon-blue border border-neon-blue/30"
                  : "bg-surface-alt text-muted border border-transparent hover:text-foreground"
              }`}
            >
              <span className="text-sm font-medium block">{l.label}</span>
              <span className="text-[10px] opacity-70">{l.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Moods */}
      <div>
        <h3 className="text-sm font-semibold mb-2">What moods do you gravitate toward?</h3>
        <div className="flex flex-wrap gap-2">
          {MOODS.map((m) => (
            <button
              key={m.key}
              onClick={() => toggleMood(m.key)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all border ${
                moods.has(m.key)
                  ? "bg-neon-purple/20 text-neon-purple border-neon-purple/30"
                  : "bg-surface-alt text-muted border-transparent hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: Story Preferences (NEW) ───

function StepStoryPreferences({
  storyFocus,
  setStoryFocus,
  tropePrefs,
  toggleTrope,
}: {
  storyFocus: string | null;
  setStoryFocus: (v: string | null) => void;
  tropePrefs: Record<string, "like" | "dislike">;
  toggleTrope: (key: string) => void;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h2
          className="text-xl font-bold tracking-tight"
         
        >
          What draws you into a story?
        </h2>
        <p className="text-sm text-muted mt-1">
          Tell us what you love most — we&rsquo;ll find books that lean into it.
        </p>
      </div>

      {/* Story Focus */}
      <div>
        <h3 className="text-sm font-semibold mb-2">I care most about</h3>
        <div className="grid grid-cols-2 gap-2">
          {STORY_FOCUS_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setStoryFocus(storyFocus === opt.key ? null : opt.key)}
              className={`rounded-xl py-2.5 px-3 text-center transition-all ${
                storyFocus === opt.key
                  ? "bg-neon-blue/20 text-neon-blue border border-neon-blue/30"
                  : "bg-surface-alt text-muted border border-transparent hover:text-foreground"
              }`}
            >
              <span className="text-sm font-medium block">{opt.label}</span>
              <span className="text-[10px] opacity-70">{opt.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Character Tropes */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Character types</h3>
        <p className="text-xs text-muted mb-3">Tap to like, tap again to dislike, once more to clear.</p>
        <div className="flex flex-wrap gap-2">
          {CHARACTER_TROPES.map((t) => {
            const state = tropePrefs[t.key] ?? null;
            return (
              <button
                key={t.key}
                onClick={() => toggleTrope(t.key)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all border ${
                  state === "like"
                    ? "bg-accent/20 text-accent-dark border-accent/40"
                    : state === "dislike"
                      ? "bg-destructive/15 text-destructive border-destructive/30"
                      : "bg-surface-alt text-muted border-transparent hover:text-foreground"
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
  );
}

// ─── Step 3: Content Comfort Zone ───

function StepContent({
  contentPrefs,
  setContentPrefs,
  customWarnings,
  warningInput,
  setWarningInput,
  addCustomWarning,
  removeCustomWarning,
}: {
  contentPrefs: Record<string, number>;
  setContentPrefs: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  customWarnings: string[];
  warningInput: string;
  setWarningInput: (v: string) => void;
  addCustomWarning: () => void;
  removeCustomWarning: (warning: string) => void;
}) {
  function setTolerance(key: string, value: number) {
    setContentPrefs((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="space-y-6">
      <div>
        <h2
          className="text-xl font-bold tracking-tight"
         
        >
          Content comfort zone
        </h2>
        <p className="text-sm text-muted mt-1">
          Set your comfort level for different types of content. Default is
          &ldquo;Any&rdquo; — only adjust what matters to you.
        </p>
      </div>

      <div className="space-y-2">
        {CONTENT_CATEGORIES.map((cat) => (
          <div
            key={cat.key}
            className="flex items-center justify-between rounded-xl bg-surface-alt px-4 py-3"
          >
            <span className="text-sm font-medium text-foreground">
              {cat.name}
            </span>
            <div className="flex gap-1">
              {TOLERANCE_LABELS.map((tl) => (
                <button
                  key={tl.value}
                  onClick={() => setTolerance(cat.key, tl.value)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
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

      {/* Custom content warnings */}
      <div>
        <h3 className="text-sm font-semibold mb-1">Anything you specifically wish to avoid?</h3>
        <p className="text-xs text-muted mb-3">
          Add specific topics not covered above (e.g. infidelity, animal death, clowns).
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={warningInput}
            onChange={(e) => setWarningInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomWarning();
              }
            }}
            placeholder="Type a topic and press Enter"
            className="flex-1 rounded-xl bg-surface-alt px-4 py-2.5 text-sm text-foreground placeholder:text-muted border border-transparent focus:border-accent/40 focus:outline-none transition-colors"
          />
          <button
            onClick={addCustomWarning}
            className="rounded-xl bg-surface-alt px-4 py-2.5 text-sm font-medium text-muted hover:text-foreground transition-colors"
          >
            Add
          </button>
        </div>
        {customWarnings.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {customWarnings.map((w) => (
              <span
                key={w}
                className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 border border-destructive/20 px-3 py-1 text-xs font-medium text-destructive"
              >
                {w}
                <button
                  onClick={() => removeCustomWarning(w)}
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
  );
}

// ─── Step 4: Summary ───

function StepSummary() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-8 space-y-4">
      <div className="text-5xl">📚</div>
      <h2
        className="text-2xl font-bold tracking-tight"
       
      >
        You&rsquo;re all set!
      </h2>
      <p className="text-sm text-muted max-w-xs">
        Your taste profile is ready. We&rsquo;ll use it to give you better
        recommendations. You can update these preferences anytime from Settings.
      </p>
    </div>
  );
}
