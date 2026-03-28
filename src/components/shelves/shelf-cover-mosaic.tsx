import Image from "next/image";

interface ShelfCoverMosaicProps {
  coverUrls: string[];
  color?: string | null;
  size?: "sm" | "md";
  /** Max covers to show (default 4) */
  maxCovers?: number;
}

/**
 * Book cover display for shelf cards.
 * Shows covers in book aspect ratio (2:3), overlapping slightly.
 * Falls back to a colored gradient placeholder if no covers.
 */
export function ShelfCoverMosaic({ coverUrls, color, size = "md", maxCovers = 4 }: ShelfCoverMosaicProps) {
  const bgColor = color || "#d97706";
  const h = size === "sm" ? 64 : 80;
  const w = Math.round(h * 0.667); // 2:3 aspect
  const overlap = size === "sm" ? 12 : 28;

  if (coverUrls.length === 0) {
    return (
      <div
        className="rounded-lg flex items-center justify-center shrink-0"
        style={{
          width: w,
          height: h,
          background: `linear-gradient(135deg, ${bgColor}30, ${bgColor}50)`,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground/30">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
        </svg>
      </div>
    );
  }

  const covers = coverUrls.slice(0, maxCovers);
  const totalWidth = w + (covers.length - 1) * (w - overlap);

  return (
    <div
      className="relative shrink-0"
      style={{ width: totalWidth, height: h }}
    >
      {covers.map((url, i) => (
        <Image
          key={i}
          src={url}
          alt=""
          width={w}
          height={h}
          className="absolute top-0 rounded-sm object-cover shadow-sm"
          style={{
            left: i * (w - overlap),
            width: w,
            height: h,
            zIndex: covers.length - i,
            filter: i > 0 ? "brightness(0.85)" : undefined,
          }}
        />
      ))}
    </div>
  );
}
