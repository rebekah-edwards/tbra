/**
 * Sitewide "no cover" placeholder for books without cover images.
 * Blue-to-purple gradient with geometric pattern overlay + book title.
 *
 * Usage:
 *   <NoCover title="Book Title" className="w-[60px] h-[90px]" />
 *   <NoCover title="Book Title" className="aspect-[2/3] w-full" />
 *
 * The parent must set dimensions — this component fills its container.
 * Pass `size` to control text sizing: "sm" for tiny thumbnails, "md" default, "lg" for detail pages.
 */

interface NoCoverProps {
  title: string;
  className?: string;
  /** Controls font size: sm (tiny thumbnails), md (default), lg (detail pages) */
  size?: "sm" | "md" | "lg";
}

export function NoCover({ title, className = "", size = "md" }: NoCoverProps) {
  const titleClass = {
    sm: "text-[7px] leading-tight line-clamp-2 px-1",
    md: "text-[9px] leading-tight line-clamp-3 px-2",
    lg: "text-sm leading-tight line-clamp-4 px-3",
  }[size];

  const labelClass = {
    sm: "text-[5px]",
    md: "text-[7px]",
    lg: "text-[9px]",
  }[size];

  return (
    <div
      className={`relative overflow-hidden rounded-lg no-cover-gradient ${className}`}
    >
      {/* Geometric pattern overlay via CSS */}
      <div className="absolute inset-0 no-cover-pattern" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full text-center gap-1">
        <p className={`font-semibold text-white/90 ${titleClass}`}>
          {title}
        </p>
        <span className={`uppercase tracking-widest text-white/40 font-medium ${labelClass}`}>
          No Cover
        </span>
      </div>
    </div>
  );
}
