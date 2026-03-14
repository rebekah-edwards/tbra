"use client";

import { useCallback, useRef, useEffect, useId, forwardRef } from "react";
import { DIMENSION_SECTIONS, DIMENSION_TAGS, type ReviewDimension } from "@/lib/review-constants";

const STAR_PATH =
  "M12 1.5c.4 0 .8.2 1 .6l2.5 5.2 5.7.8c.4.06.7.3.9.7.1.3.0.7-.2 1l-4.1 4 1 5.7c.06.4-.1.8-.4 1-.3.2-.7.3-1.1.1L12 18.1l-5.1 2.7c-.4.2-.8.1-1.1-.1-.3-.2-.5-.6-.4-1l1-5.7-4.1-4c-.3-.3-.4-.7-.2-1 .1-.3.5-.6.9-.7l5.7-.8L11 2.1c.2-.4.6-.6 1-.6z";

function DimensionStar({ fill }: { fill: number }) {
  const clipId = useId();
  return (
    <svg width={36} height={36} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={24 * fill} height="24" />
        </clipPath>
      </defs>
      <path d={STAR_PATH} fill="none" stroke="currentColor" strokeWidth="1" className="text-muted/40" />
      {fill > 0 && (
        <path d={STAR_PATH} fill="currentColor" clipPath={`url(#${clipId})`} className="text-yellow-400" />
      )}
    </svg>
  );
}

interface StepDimensionsProps {
  dimensionRatings: Record<string, number | null>;
  dimensionTags: Record<string, string[]>;
  onDimensionRatingChange: (dimension: string, rating: number | null) => void;
  onDimensionTagToggle: (dimension: string, tag: string) => void;
}

export function StepDimensions({
  dimensionRatings,
  dimensionTags,
  onDimensionRatingChange,
  onDimensionTagToggle,
}: StepDimensionsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const activeRef = useRef<string>("characters");

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const handleScroll = () => {
      let closest = "characters";
      let closestDist = Infinity;
      const scrollTop = scrollEl.scrollTop + 100;

      for (const section of DIMENSION_SECTIONS) {
        const el = sectionRefs.current[section.key];
        if (!el) continue;
        const dist = Math.abs(el.offsetTop - scrollTop);
        if (dist < closestDist) {
          closestDist = dist;
          closest = section.key;
        }
      }

      if (closest !== activeRef.current) {
        activeRef.current = closest;
        const navEl = navRef.current;
        if (navEl) {
          navEl.querySelectorAll("[data-nav]").forEach((el) => {
            const isActive = el.getAttribute("data-nav") === closest;
            el.classList.toggle("text-foreground", isActive);
            el.classList.toggle("border-primary", isActive);
            el.classList.toggle("text-muted", !isActive);
            el.classList.toggle("border-transparent", !isActive);
          });
          const activeNav = navEl.querySelector(`[data-nav="${closest}"]`);
          activeNav?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        }
      }
    };

    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (key: string) => {
    const el = sectionRefs.current[key];
    if (el && scrollRef.current) {
      const navHeight = navRef.current?.offsetHeight ?? 0;
      scrollRef.current.scrollTo({
        top: el.offsetTop - navHeight - 8,
        behavior: "smooth",
      });
    }
  };

  return (
    <div className="flex flex-col gap-0 h-full overflow-hidden">
      <h2 className="font-heading text-2xl font-bold text-center pb-3 px-4">
        How would you describe this book?
      </h2>

      <div
        ref={navRef}
        className="flex overflow-x-auto gap-1 border-b border-surface-alt px-2 sticky top-0 bg-background z-10 no-scrollbar"
      >
        {DIMENSION_SECTIONS.map((section, i) => (
          <button
            key={section.key}
            type="button"
            data-nav={section.key}
            onClick={() => scrollToSection(section.key)}
            className={`whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              i === 0
                ? "border-primary text-foreground"
                : "border-transparent text-muted"
            }`}
          >
            {section.label}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4">
        {DIMENSION_SECTIONS.map((section) => (
          <DimensionSection
            key={section.key}
            ref={(el) => { sectionRefs.current[section.key] = el; }}
            dimension={section.key}
            label={section.label}
            rating={dimensionRatings[section.key] ?? null}
            selectedTags={dimensionTags[section.key] ?? []}
            onRatingChange={(r) => onDimensionRatingChange(section.key, r)}
            onTagToggle={(t) => onDimensionTagToggle(section.key, t)}
          />
        ))}
        <div className="h-8" />
      </div>
    </div>
  );
}

const DimensionSection = forwardRef<
  HTMLDivElement,
  {
    dimension: ReviewDimension;
    label: string;
    rating: number | null;
    selectedTags: string[];
    onRatingChange: (rating: number | null) => void;
    onTagToggle: (tag: string) => void;
  }
>(function DimensionSection(
  { dimension, label, rating, selectedTags, onRatingChange, onTagToggle },
  ref
) {
  const tags = DIMENSION_TAGS[dimension];
  const isContentDetails = dimension === "content_details";
  const starsRef = useRef<HTMLDivElement>(null);

  const handleStarClick = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!starsRef.current) return;
      const rect = starsRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const starWidth = rect.width / 5;
      const starIndex = Math.floor(x / starWidth);
      const fraction = (x - starIndex * starWidth) / starWidth;
      const quarter = Math.ceil(fraction * 4) / 4;
      const val = Math.min(5, Math.max(0.25, starIndex + quarter));
      onRatingChange(rating === val ? null : val);
    },
    [rating, onRatingChange]
  );

  return (
    <div ref={ref} data-section={dimension} className="py-6 border-b border-surface-alt/50 last:border-0">
      {isContentDetails ? (
        <h3 className="text-sm font-semibold text-foreground text-center mb-4">
          Check all content details present in this book
        </h3>
      ) : (
        <h3 className="text-sm font-semibold text-muted uppercase tracking-wider text-center mb-4">
          {label}
        </h3>
      )}

      {!isContentDetails && (
        <div className="flex justify-center mb-4">
          <div
            ref={starsRef}
            className="flex gap-0.5 cursor-pointer touch-none"
            onPointerUp={handleStarClick}
          >
            {[0, 1, 2, 3, 4].map((i) => {
              const starFill = Math.min(1, Math.max(0, (rating ?? 0) - i));
              return <DimensionStar key={i} fill={starFill} />;
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {tags.map((tag) => {
          const isSelected = selectedTags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => onTagToggle(tag)}
              className={`rounded-xl px-3 py-3 text-sm text-center transition-all ${
                isSelected
                  ? "bg-primary/15 border-2 border-primary text-foreground font-medium"
                  : "bg-surface-alt border-2 border-transparent text-foreground/70 hover:bg-surface-alt/80"
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>
    </div>
  );
});
