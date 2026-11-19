"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CustomGoalProgress, CustomGoalKind } from "@/lib/queries/custom-goals";
import { setCustomGoal, removeCustomGoal, setAudioLength } from "@/lib/actions/custom-goals";
import { NoCover } from "@/components/no-cover";
import { MissingMetaWarning, type AdminMissing } from "@/components/stats/missing-meta-warning";

// Premium custom goals on Stats (2026-11-19): pages read, hours listened,
// days read, books in a genre — one glass card each, hue carried by the icon
// and the progress fill. Free readers see one upgrade card.

const KIND_META: Record<CustomGoalKind, { label: string; unit: string; hue: string; rgb: string; icon: React.ReactNode }> = {
  pages: {
    label: "Pages read",
    unit: "pages",
    hue: "text-neon-blue",
    rgb: "56,189,248",
    icon: <><path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z" /><path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z" /></>,
  },
  hours: {
    label: "Hours listened",
    unit: "hours",
    hue: "text-neon-purple",
    rgb: "192,132,252",
    icon: <><path d="M3 14v-2a9 9 0 0 1 18 0v2" /><path d="M21 15a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2z" /><path d="M3 15a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2z" /></>,
  },
  days: {
    label: "Days read",
    unit: "days",
    hue: "text-accent",
    rgb: "163,230,53",
    icon: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
  },
  genre: {
    label: "Books in a genre",
    unit: "books",
    hue: "text-[#f472b6]",
    rgb: "244,114,182",
    icon: <><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></>,
  },
};

function KindIcon({ kind, size = 16 }: { kind: CustomGoalKind; size?: number }) {
  const m = KIND_META[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={m.hue} aria-hidden="true">
      {m.icon}
    </svg>
  );
}

function fmt(n: number, kind: CustomGoalKind): string {
  if (kind === "hours") return n % 1 === 0 ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return n.toLocaleString("en-US");
}

export function CustomGoalsSection({
  year,
  premium,
  goals,
  genres,
  editable,
  adminMissing = null,
}: {
  year: number | "all";
  premium: boolean;
  goals: CustomGoalProgress[];
  genres: string[];
  /** Only the current year's goals can be added to. */
  editable: boolean;
  /** Admins only: books this year missing pages / audio length. */
  adminMissing?: AdminMissing | null;
}) {
  const [adding, setAdding] = useState(false);
  // Today's place in the year (0…1), the same tick the books-goal track has.
  // Read after mount: the server's "today" (UTC) and the reader's can differ.
  const [yearElapsed, setYearElapsed] = useState<number | null>(null);
  useEffect(() => {
    const now = new Date();
    if (year !== now.getFullYear()) return setYearElapsed(null);
    const start = new Date(year, 0, 1).getTime();
    const end = new Date(year + 1, 0, 1).getTime();
    setYearElapsed(Math.min(1, Math.max(0, (now.getTime() - start) / (end - start))));
  }, [year]);

  if (!premium) {
    return (
      <section className="rounded-[18px] border border-dashed border-foreground/15 bg-surface/40 p-5 text-center">
        <p className="eyebrow mb-2">Custom goals</p>
        <div className="mb-3 flex items-center justify-center gap-2">
          {(["pages", "hours", "days", "genre"] as CustomGoalKind[]).map((k) => (
            <span key={k} className="flex h-9 w-9 items-center justify-center rounded-full border border-foreground/12 bg-surface/70">
              <KindIcon kind={k} />
            </span>
          ))}
        </div>
        <p className="text-sm text-muted">
          Set goals for pages read, hours listened, days read or a favorite genre.
        </p>
        <Link href="/upgrade" className="btn-glass mt-3 px-4 py-2 text-sm">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="text-neon-purple" aria-hidden="true">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          Upgrade to Based Reader
        </Link>
      </section>
    );
  }

  if (goals.length === 0 && !editable) return null;

  const takenKinds = new Set(goals.filter((g) => g.kind !== "genre").map((g) => g.kind));

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="section-heading text-xs">Custom Goals</h2>
        {editable && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="btn-glass cursor-pointer gap-1.5 px-3.5 py-1.5 text-xs">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className="text-accent" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add goal
          </button>
        )}
      </div>

      {adding && (
        <AddGoalForm
          genres={genres}
          takenKinds={takenKinds}
          takenGenres={new Set(goals.filter((g) => g.kind === "genre").map((g) => (g.genreName ?? "").toLowerCase()))}
          onDone={() => setAdding(false)}
        />
      )}

      {goals.length === 0 && !adding ? (
        <div className="rounded-[18px] border border-dashed border-foreground/15 bg-surface/40 p-5 text-center">
          <p className="text-sm text-muted">Go beyond books: track pages, listening hours, reading days or a genre.</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} editable={editable} yearElapsed={yearElapsed}
              adminFixHref={adminMissing ? `/admin/book-metadata?year=${adminMissing.year}&focus=audio` : undefined}
              warning={
                adminMissing && g.kind === "pages" && adminMissing.pages > 0 ? <MissingMetaWarning missing={adminMissing} kind="pages" />
                : adminMissing && g.kind === "hours" && adminMissing.audio > 0 ? <MissingMetaWarning missing={adminMissing} kind="audio" />
                : null
              } />
          ))}
        </div>
      )}
    </section>
  );
}

function GoalCard({
  goal,
  editable,
  yearElapsed,
  warning,
  adminFixHref,
}: {
  goal: CustomGoalProgress;
  editable: boolean;
  yearElapsed: number | null;
  warning?: React.ReactNode;
  /** Admins fix missing lengths in the CATALOG (everyone benefits), not just
   *  for their own goal. */
  adminFixHref?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [fixing, setFixing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(goal.target));
  const [editError, setEditError] = useState("");
  const m = KIND_META[goal.kind];
  const label = goal.kind === "genre" ? goal.genreName ?? "Genre" : m.label;
  const missing = goal.missingAudio ?? [];

  return (
    <div className={`rounded-[18px] border border-foreground/10 bg-surface/60 p-4 backdrop-blur-md transition-opacity ${pending ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-foreground/12 bg-surface/70">
          <KindIcon kind={goal.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="eyebrow truncate">{goal.kind === "genre" ? `${label} books` : label}</p>
            {warning}
          </div>
          <p className="mt-0.5 flex items-baseline gap-1.5">
            <span className="font-heading text-[26px] font-extrabold leading-none tabular-nums">{fmt(goal.current, goal.kind)}</span>
            <span className="text-sm text-muted">of {fmt(goal.target, goal.kind)} {m.unit}</span>
          </p>
        </div>
        {editable && !editing && (
          <button
            type="button"
            aria-label={`Edit ${label} goal`}
            onClick={() => { setDraft(String(goal.target)); setEditError(""); setEditing(true); }}
            className="btn-glass h-8 w-8 flex-shrink-0 cursor-pointer text-muted hover:text-foreground"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>
        )}
        {editable && (
          <button
            type="button"
            aria-label={`Remove ${label} goal`}
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Remove your ${label.toLowerCase()} goal?`)) return;
              start(async () => {
                await removeCustomGoal(goal.id);
                router.refresh();
              });
            }}
            className="btn-glass h-8 w-8 flex-shrink-0 cursor-pointer text-muted hover:text-foreground"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {editing && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setEditError("");
            start(async () => {
              const r = await setCustomGoal({ kind: goal.kind, target: parseInt(draft, 10), genreName: goal.genreName });
              if (!r.success) {
                setEditError(r.error ?? "Could not save goal.");
                return;
              }
              setEditing(false);
              router.refresh();
            });
          }}
        >
          <input
            inputMode="numeric"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 6))}
            aria-label={`New ${label} target`}
            className="field-glass !h-9 w-28 text-center text-sm font-semibold"
          />
          <span className="text-xs text-muted">{m.unit}</span>
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={() => setEditing(false)} className="btn-glass cursor-pointer px-3 py-1 text-xs">Cancel</button>
            <button type="submit" disabled={pending || !draft} className="btn-lime cursor-pointer px-4 py-1 text-xs">Save</button>
          </span>
          {editError && <p className="w-full text-xs text-destructive">{editError}</p>}
        </form>
      )}

      {/* Progress against a tick for today's place in the year (same as the
          books goal): fill past the tick is ahead of pace. */}
      <div className="relative mt-3 h-3.5">
        <div className="absolute inset-x-0 top-1/2 h-[7px] -translate-y-1/2 overflow-hidden rounded-full bg-foreground/10">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.max(goal.percentComplete > 0 ? 3 : 0, goal.percentComplete)}%`,
              background: `linear-gradient(90deg, rgba(${m.rgb},0.75), rgb(${m.rgb}))`,
            }}
          />
        </div>
        {yearElapsed !== null && (
          <span
            aria-hidden
            className="absolute top-0 h-full w-[2px] rounded-full bg-foreground"
            style={{ left: `calc(${Math.min(yearElapsed * 100, 100)}% - 1px)` }}
          />
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] font-medium text-muted">
        <span>{goal.percentComplete}% of goal</span>
        {yearElapsed !== null && goal.percentComplete < 100 && (
          <span>
            {goal.percentComplete >= Math.round(yearElapsed * 100) ? "On pace" : "Behind pace"}
          </span>
        )}
        {goal.percentComplete >= 100 && (
          <span className="inline-flex items-center gap-1 text-foreground">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            Goal reached
          </span>
        )}
      </div>

      {goal.kind === "hours" && missing.length > 0 && (
        <div className="mt-3 border-t border-foreground/10 pt-3">
          {adminFixHref ? (
            <Link href={adminFixHref} className="flex w-full items-center justify-between gap-2 text-left text-xs">
              <span className="inline-flex items-center gap-1.5 text-foreground">
                <span className="h-[6px] w-[6px] rounded-full bg-neon-purple" aria-hidden="true" />
                {missing.length} {missing.length === 1 ? "listen is" : "listens are"} missing a length
              </span>
              <span className="font-medium text-neon-blue">Fix in catalog</span>
            </Link>
          ) : !fixing ? (
            <button type="button" onClick={() => setFixing(true)} className="flex w-full cursor-pointer items-center justify-between gap-2 text-left text-xs">
              <span className="inline-flex items-center gap-1.5 text-foreground">
                <span className="h-[6px] w-[6px] rounded-full bg-neon-purple" aria-hidden="true" />
                {missing.length} {missing.length === 1 ? "listen is" : "listens are"} missing a length
              </span>
              <span className="font-medium text-neon-blue">Add lengths</span>
            </button>
          ) : (
            <MissingLengths items={missing} onDone={() => setFixing(false)} />
          )}
        </div>
      )}
    </div>
  );
}

function MissingLengths({ items, onDone }: { items: NonNullable<CustomGoalProgress["missingAudio"]>; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [values, setValues] = useState<Record<string, { h: string; m: string }>>({});
  const [error, setError] = useState("");

  function save() {
    setError("");
    const entries = Object.entries(values)
      .map(([bookId, v]) => ({ bookId, minutes: (parseInt(v.h || "0", 10) || 0) * 60 + (parseInt(v.m || "0", 10) || 0) }))
      .filter((e) => e.minutes > 0);
    if (entries.length === 0) {
      onDone();
      return;
    }
    start(async () => {
      for (const e of entries) {
        const r = await setAudioLength(e.bookId, e.minutes);
        if (!r.success) {
          setError(r.error ?? "Could not save a length.");
          return;
        }
      }
      router.refresh();
      onDone();
    });
  }

  return (
    <div className="space-y-2.5">
      <p className="text-[11px] text-muted">Enter each audiobook&rsquo;s length (from your audiobook app). You only need to do this once per book.</p>
      {items.map((b) => (
        <div key={b.bookId} className="flex items-center gap-2.5">
          {b.coverImageUrl ? (
            <Image src={b.coverImageUrl} alt="" width={28} height={42} className="h-[42px] w-7 flex-shrink-0 rounded-[4px] object-cover ring-1 ring-white/10" />
          ) : (
            <NoCover title={b.title} className="h-[42px] w-7 flex-shrink-0" size="sm" />
          )}
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{b.title}</span>
          <input
            inputMode="numeric"
            aria-label={`${b.title} hours`}
            placeholder="h"
            value={values[b.bookId]?.h ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [b.bookId]: { h: e.target.value.replace(/\D/g, "").slice(0, 3), m: v[b.bookId]?.m ?? "" } }))}
            className="field-glass !h-9 w-12 !px-2 text-center text-xs"
          />
          <input
            inputMode="numeric"
            aria-label={`${b.title} minutes`}
            placeholder="m"
            value={values[b.bookId]?.m ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [b.bookId]: { h: v[b.bookId]?.h ?? "", m: e.target.value.replace(/\D/g, "").slice(0, 2) } }))}
            className="field-glass !h-9 w-12 !px-2 text-center text-xs"
          />
        </div>
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onDone} className="btn-glass cursor-pointer px-3.5 py-1.5 text-xs">Cancel</button>
        <button type="button" onClick={save} disabled={pending} className="btn-lime cursor-pointer px-4 py-1.5 text-xs">
          {pending ? "Saving…" : "Save lengths"}
        </button>
      </div>
    </div>
  );
}

function AddGoalForm({
  genres,
  takenKinds,
  takenGenres,
  onDone,
}: {
  genres: string[];
  takenKinds: Set<string>;
  takenGenres: Set<string>;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const kinds = (["pages", "hours", "days", "genre"] as CustomGoalKind[]).filter((k) => !takenKinds.has(k));
  const [kind, setKind] = useState<CustomGoalKind>(kinds[0] ?? "genre");
  const freeGenres = genres.filter((g) => !takenGenres.has(g.toLowerCase()));
  const [genre, setGenre] = useState(freeGenres[0] ?? "");
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");

  const placeholder = { pages: "e.g. 15000", hours: "e.g. 100", days: "e.g. 250", genre: "e.g. 12" }[kind];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const r = await setCustomGoal({ kind, target: parseInt(target, 10), genreName: kind === "genre" ? genre : null });
      if (!r.success) {
        setError(r.error ?? "Could not save goal.");
        return;
      }
      router.refresh();
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="card-hairline mb-3 space-y-3 !rounded-[18px] p-4">
      <p className="eyebrow">New goal for {new Date().getFullYear()}</p>
      <div className="seg-glass flex-wrap">
        {kinds.map((k) => (
          <button key={k} type="button" data-active={kind === k} onClick={() => setKind(k)} className="!min-w-[45%] sm:!min-w-0">
            {KIND_META[k].label}
          </button>
        ))}
      </div>
      {kind === "genre" && (
        freeGenres.length > 0 ? (
          <select value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Genre" className="field-glass w-full text-sm">
            {freeGenres.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        ) : (
          <p className="text-xs text-muted">Add some books to your library first — genre goals use the genres you read.</p>
        )
      )}
      <div className="flex items-center gap-2">
        <input
          inputMode="numeric"
          value={target}
          onChange={(e) => setTarget(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder={placeholder}
          aria-label="Target"
          className="field-glass min-w-0 flex-1 text-sm"
        />
        <span className="whitespace-nowrap text-sm text-muted">{KIND_META[kind].unit} this year</span>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="btn-glass cursor-pointer px-4 py-2 text-sm">Cancel</button>
        <button type="submit" disabled={pending || !target || (kind === "genre" && !genre)} className="btn-lime cursor-pointer px-5 py-2 text-sm">
          {pending ? "Saving…" : "Save goal"}
        </button>
      </div>
    </form>
  );
}
