import { ImageResponse } from "next/og";
import { getApiUser } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { stripHtml, truncate, formatRating } from "@/lib/text-utils";

/**
 * GET /api/share/review?book=<id|slug>
 *
 * The signed-in reader's OWN review of a book as a 1080×1920 story image to
 * share (Instagram / TikTok stories, messages) — shown right after they post
 * a review, web and iOS (Rebekah, 2026-11-25: "like Fable"). Owner-only: it
 * renders the caller's review, never anyone else's. Spoilers stay hidden
 * ([spoiler]), anonymous reviews show no name.
 */
export const runtime = "nodejs";

const W = 1080;
const H = 1920;
const BG = "#0b0b12";
const LIME = "#a3e635";
const BLUE = "#38bdf8";
const PURPLE = "#c084fc";
const STAR = "#facc15";

// Brand fonts, fetched once per server instance (Google Fonts serves static
// TTFs to an old user agent — satori can't read variable fonts or woff2).
const fontCache = new Map<string, Promise<ArrayBuffer | null>>();
function googleFont(family: string, weight: number): Promise<ArrayBuffer | null> {
  const key = `${family}:${weight}`;
  if (!fontCache.has(key)) {
    fontCache.set(
      key,
      (async () => {
        try {
          const css = await (
            await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}`, {
              headers: { "User-Agent": "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1" },
              signal: AbortSignal.timeout(5000),
            })
          ).text();
          const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
          if (!url) return null;
          return await (await fetch(url, { signal: AbortSignal.timeout(5000) })).arrayBuffer();
        } catch {
          fontCache.delete(key);
          return null;
        }
      })(),
    );
  }
  return fontCache.get(key)!;
}

/** Cover as a data URI (satori only embeds PNG/JPEG reliably); null = draw a placeholder. */
async function coverDataUri(url: string | null, origin: string): Promise<string | null> {
  if (!url) return null;
  try {
    const abs = url.startsWith("http") ? url : `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
    const res = await fetch(abs, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/image\/(png|jpe?g)/i.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${type.split(";")[0]};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function Star({ fill, size }: { fill: number; size: number }) {
  const path = "M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.6 6 20.9l1.3-6.7-5-4.7 6.8-.8z";
  return (
    <div style={{ position: "relative", width: size, height: size, display: "flex" }}>
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ position: "absolute", top: 0, left: 0 }}>
        <path d={path} fill="rgba(255,255,255,0.18)" />
      </svg>
      {fill > 0 && (
        <div style={{ position: "absolute", top: 0, left: 0, width: size * fill, height: size, overflow: "hidden", display: "flex" }}>
          <svg width={size} height={size} viewBox="0 0 24 24">
            <path d={path} fill={STAR} />
          </svg>
        </div>
      )}
    </div>
  );
}

export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const bookParam = url.searchParams.get("book");
  if (!bookParam) return new Response("book required", { status: 400 });

  const row = (await db.all(sql`
    SELECT b.title, b.cover_image_url AS cover,
           (SELECT GROUP_CONCAT(a.name, ', ') FROM book_authors ba JOIN authors a ON a.id = ba.author_id
             WHERE ba.book_id = b.id AND ba.role = 'author') AS authors,
           r.overall_rating AS rating, r.review_text AS text, r.is_anonymous AS anon,
           r.did_not_finish AS dnf, r.dnf_percent_complete AS dnf_pct,
           u.username, u.display_name AS display_name
    FROM books b
    JOIN user_book_reviews r ON r.book_id = b.id AND r.user_id = ${user.userId}
    JOIN users u ON u.id = r.user_id
    WHERE b.id = ${bookParam} OR b.slug = ${bookParam}
    LIMIT 1
  `)) as {
    title: string; cover: string | null; authors: string | null; rating: number | null; text: string | null;
    anon: number; dnf: number; dnf_pct: number | null; username: string | null; display_name: string | null;
  }[];
  const r = row[0];
  if (!r) return new Response("No review to share", { status: 404 });

  const [logo, outfit, jakarta, jakartaBold, cover] = await Promise.all([
    googleFont("Space Grotesk", 700),
    googleFont("Outfit", 700),
    googleFont("Plus Jakarta Sans", 500),
    googleFont("Plus Jakarta Sans", 700),
    coverDataUri(r.cover, url.origin),
  ]);
  const fonts = [
    logo && { name: "Logo", data: logo, weight: 700 as const, style: "normal" as const },
    outfit && { name: "Outfit", data: outfit, weight: 700 as const, style: "normal" as const },
    jakarta && { name: "Jakarta", data: jakarta, weight: 500 as const, style: "normal" as const },
    jakartaBold && { name: "Jakarta", data: jakartaBold, weight: 700 as const, style: "normal" as const },
  ].filter(Boolean) as { name: string; data: ArrayBuffer; weight: 500 | 700; style: "normal" }[];

  const excerpt = r.text ? truncate(stripHtml(r.text), 210) : "";
  const title = truncate(r.title, 70);
  const by = r.authors ? truncate(r.authors, 60) : null;
  const who = r.anon ? "A tbr*a reader" : r.username ? `@${r.username}` : r.display_name || "A tbr*a reader";
  const rating = r.rating && r.rating > 0 ? r.rating : null;

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", alignItems: "center", backgroundColor: BG, position: "relative", fontFamily: "Jakarta" }}>
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" width={W} height={H} style={{ position: "absolute", top: 0, left: 0, width: W, height: H, objectFit: "cover", opacity: 0.28 }} />
        )}
        <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex", backgroundImage: `linear-gradient(180deg, rgba(11,11,18,0.55) 0%, rgba(11,11,18,0.88) 45%, ${BG} 75%)` }} />

        {/* Brand row */}
        <div style={{ display: "flex", width: W, justifyContent: "space-between", alignItems: "center", padding: "84px 88px 0" }}>
          <div style={{ display: "flex", fontFamily: "Logo", fontSize: 64, fontWeight: 700 }}>
            <span style={{ color: LIME }}>tbr</span>
            <span style={{ color: BLUE }}>*</span>
            <span style={{ color: PURPLE }}>a</span>
          </div>
          <div style={{ display: "flex", color: "rgba(255,255,255,0.7)", fontSize: 26, fontWeight: 700, letterSpacing: 4 }}>
            {r.dnf ? "DID NOT FINISH" : "MY REVIEW"}
          </div>
        </div>

        {/* Cover */}
        <div style={{ display: "flex", marginTop: 60 }}>
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" width={400} height={600} style={{ width: 400, height: 600, objectFit: "cover", borderRadius: 22, boxShadow: "0 30px 80px rgba(0,0,0,0.6)" }} />
          ) : (
            <div style={{ width: 400, height: 600, borderRadius: 22, display: "flex", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center", color: "white", fontFamily: "Outfit", fontSize: 52, backgroundImage: `linear-gradient(135deg, ${PURPLE}, ${BLUE})` }}>
              {title}
            </div>
          )}
        </div>

        {/* Title / author */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 56, padding: "0 90px" }}>
          <div style={{ display: "flex", fontFamily: "Outfit", fontSize: 66, fontWeight: 700, color: "white", textAlign: "center", lineHeight: 1.1 }}>{title}</div>
          {by && <div style={{ display: "flex", marginTop: 16, fontSize: 36, color: "rgba(255,255,255,0.72)" }}>{by}</div>}
        </div>

        {/* Stars / DNF */}
        <div style={{ display: "flex", alignItems: "center", marginTop: 38, gap: 12 }}>
          {rating ? (
            <>
              {[0, 1, 2, 3, 4].map((i) => (
                <Star key={i} size={64} fill={Math.max(0, Math.min(1, rating - i))} />
              ))}
              <div style={{ display: "flex", marginLeft: 14, fontSize: 44, fontWeight: 700, color: "white" }}>{formatRating(rating)}</div>
            </>
          ) : r.dnf ? (
            <div style={{ display: "flex", fontSize: 36, color: "rgba(255,255,255,0.8)" }}>
              {r.dnf_pct ? `Stopped at ${Math.round(r.dnf_pct)}%` : "Did not finish"}
            </div>
          ) : null}
        </div>

        {/* Quote */}
        {excerpt && (
          <div style={{ display: "flex", marginTop: 52, width: W - 160, padding: 3, borderRadius: 40, backgroundImage: `linear-gradient(135deg, ${LIME}, ${BLUE}, ${PURPLE})` }}>
            <div style={{ display: "flex", flexDirection: "column", width: "100%", borderRadius: 37, backgroundColor: "rgba(16,16,26,0.96)", padding: "46px 52px" }}>
              <div style={{ display: "flex", fontFamily: "Outfit", fontSize: 90, lineHeight: 0.6, color: LIME }}>“</div>
              <div style={{ display: "flex", marginTop: 10, fontSize: 38, lineHeight: 1.45, color: "rgba(255,255,255,0.92)" }}>{excerpt}</div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "absolute", bottom: 84, width: W }}>
          <div style={{ display: "flex", fontSize: 38, fontWeight: 700, color: "white" }}>{who}</div>
          <div style={{ display: "flex", marginTop: 12, fontSize: 30, color: "rgba(255,255,255,0.65)" }}>Know what&apos;s in a book · thebasedreader.app</div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: fonts.length ? fonts : undefined,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
