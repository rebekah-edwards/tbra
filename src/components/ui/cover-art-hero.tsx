import Image from "next/image";
import type { ReactNode } from "react";

/**
 * Page hero built from book covers (design refresh 2026-11): the card sits on
 * its own blurred cover art with the wordmark hairline, a small fan of tipped
 * covers, an eyebrow label, the heading-face title, glass stat chips with a
 * colour dot, and the page's actions. Used by the author and series pages so
 * they match Reading Now / Pick From Your Shelf / buddy reads.
 */

export interface HeroStat {
  label: string;
  value: string | number;
  hue: "lime" | "blue" | "purple";
}

const DOT: Record<HeroStat["hue"], string> = {
  lime: "bg-accent",
  blue: "bg-neon-blue",
  purple: "bg-[#c084fc]",
};

export const HERO_BACK_BUTTON_CLASS =
  "flex h-9 w-9 items-center justify-center rounded-full border border-foreground/15 bg-surface/60 text-foreground/90 backdrop-blur-md transition-colors hover:text-foreground";

export function CoverArtHero({
  eyebrow,
  title,
  subtitle,
  covers,
  stats,
  actions,
  children,
  leading,
}: {
  /** Pinned top-left inside the card (the back button). */
  leading?: ReactNode;
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  /** Cover URLs, best first. The first is the blurred backdrop. */
  covers: string[];
  stats?: HeroStat[];
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const fan = covers.slice(0, 3);
  const backdrop = covers[0];

  return (
    <section className="card-hairline relative overflow-hidden p-5 lg:p-6">
      {backdrop ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <Image
            src={backdrop}
            alt=""
            fill
            sizes="600px"
            className="scale-125 object-cover opacity-35 blur-2xl"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-surface/40 via-surface/70 to-surface" />
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[120%] -translate-x-1/2 opacity-60 blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(163,230,53,0.16), rgba(56,189,248,0.10) 55%, rgba(192,132,252,0.08) 80%, transparent)",
          }}
        />
      )}

      {leading && <div className="absolute left-3 top-3 z-10">{leading}</div>}

      <div className="relative flex flex-col items-center text-center sm:flex-row sm:items-center sm:gap-6 sm:text-left">
        {fan.length > 0 && (
          <div className="relative h-[124px] w-[132px] flex-shrink-0" aria-hidden="true">
            {fan.map((src, i) => {
              // Back covers tip outward; the best cover (i = 0) sits in front, upright.
              const rotate = i === 0 ? 0 : i === 1 ? -9 : 9;
              const shift = i === 0 ? 0 : i === 1 ? -30 : 30;
              return (
                <div
                  key={src + i}
                  className="absolute left-1/2 top-1 overflow-hidden rounded-md shadow-xl ring-1 ring-white/10"
                  style={{
                    width: 78,
                    height: 117,
                    zIndex: 10 - i,
                    transform: `translateX(calc(-50% + ${shift}px)) rotate(${rotate}deg) scale(${i === 0 ? 1 : 0.9})`,
                  }}
                >
                  <Image src={src} alt="" fill sizes="80px" className="object-cover" />
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 min-w-0 max-w-full sm:mt-0 sm:flex-1">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-1 font-heading text-[24px] font-bold leading-tight tracking-tight text-foreground line-clamp-3">
            {title}
          </h1>
          {subtitle && <div className="mt-1 text-xs text-muted">{subtitle}</div>}

          {stats && stats.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">
              {stats.map((s) => (
                <span
                  key={s.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-foreground/12 bg-surface/60 px-2.5 py-1 text-xs backdrop-blur-md"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${DOT[s.hue]}`} />
                  <strong className="font-semibold text-foreground">{s.value}</strong>
                  <span className="text-muted">{s.label}</span>
                </span>
              ))}
            </div>
          )}

          {actions && (
            <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              {actions}
            </div>
          )}
        </div>
      </div>

      {children && <div className="relative mt-4">{children}</div>}
    </section>
  );
}
