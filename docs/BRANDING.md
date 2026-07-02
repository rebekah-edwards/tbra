# tbr*a Branding & Design Guidelines

> Verified against `src/app/globals.css` + `src/app/layout.tsx` (deployed main `bff7131`) on 2026-07-02.
> These are the values the live mobile site actually ships. If this doc and the code disagree, the code wins — then fix this doc.

## Brand Colors

### Accent / Primary: Lime Green
- **Value:** `#a3e635` (Tailwind lime-400) — identical in dark AND light mode
- **Light variant:** `#d9f99d` (lime-200, `--primary-light`)
- **Dark variant:** `#84cc16` (lime-500, `--primary-dark`) — for hover/pressed states only
- **Usage:** Primary CTA buttons, accent highlights, the `*` in the logo
- **CRITICAL RULE:** The lime is ALWAYS bright `#a3e635`. NEVER darken it toward olive/muted green.
- **CRITICAL RULE:** Text on opaque lime backgrounds is ALWAYS black (`#18181b`), in both modes. Never white/gray on green. The ONLY exception: dark-mode translucent green pills (10–20% opacity) may use the green itself as text (`color: var(--primary)`).
- In light mode, `.text-accent` is force-overridden to black (`globals.css` — `[data-theme="light"] .text-accent { color: #000 !important; }`). Tailwind opacity variants (`text-accent/60`) do NOT get this override — use `text-foreground/50` or `text-muted/60` instead.

### Neon Purple (`--neon-purple`)
- **Dark mode:** `#c084fc` (purple-400)
- **Light mode:** `#a855f7` (purple-500)
- **Usage:** wordmark gradient end, "read more" links in light mode, ambient glow blobs, divider gradients (dividers use deeper `rgba(124,58,237,…)` = purple-600 directly)

### Neon Blue (`--neon-blue`)
- **Dark mode:** `#38bdf8` (sky-400)
- **Light mode:** `#0ea5e9` (sky-500)
- **Usage:** tappable/link text (`text-neon-blue`), rating display, wordmark gradient middle

### Link color rules
- `--link` exists (`#a3e635` dark / `#16a34a` green-600 light) but **do NOT use `text-link` or `text-primary` for link text** — dark green on light backgrounds is unreadable. Use `text-neon-blue` for tappable text, `text-foreground` for body.
- `text-secondary` / `text-tertiary` are NOT defined — never use them. Use `text-muted`.

### Core surface tokens

| Token | Dark | Light |
|---|---|---|
| `--background` | `#0a0a0f` | `#f5f4f8` |
| `--foreground` | `#e4e2ef` | `#18181b` |
| `--surface` | `#141420` | `#fbfafd` |
| `--surface-alt` | `#1c1c2a` | `#f0eff4` |
| `--border` | `#2a2a3a` | `#dddce4` |
| `--muted` | `#7a7890` | `#71717a` |
| `--destructive` | `#ef4444` | `#dc2626` |

### Intensity Scale (Content Ratings)
Labels are standardized: **None / Mild / Moderate / Significant / Extreme.** Never "Heavy", "Intense", or "Strong".

| Level | Label | Dark | Light |
|---|---|---|---|
| 0 | None | `#2a2a3a` (border gray) | `#e4e4e9` |
| 1 | Mild | `#38bdf8` (blue) | `#0ea5e9` |
| 2 | Moderate | `#facc15` (yellow) | `#d97706` (amber) |
| 3 | Significant | `#fb923c` (orange) | `#ea580c` |
| 4 | Extreme | `#f87171` (red) | `#dc2626` |

### Overlay token system (text over blurred cover art)
Book hero cards render text over blurred cover imagery via dedicated `--overlay-*` tokens (defined per theme in `globals.css`): `--overlay-text`, `--overlay-text-sub`, `--overlay-text-muted`, `--overlay-pill-bg/text`, `--overlay-action-bg/text/border` (lime-tinted), `--overlay-link-underline(-hover)`, `--overlay-nocover-bg/text`. Dark mode = white-based rgba; light mode = `#18181b`-based rgba. Use these (via `.book-header-*` / `.book-action-btn` classes), never raw colors, for anything sitting on cover art.

## Theme System

Uses `data-theme` attribute (`"dark"` or `"light"`) on `<html>`, NOT Tailwind's `dark:` prefix:

```css
/* Dark mode (default) */
.my-class { ... }
/* Light mode override */
[data-theme="light"] .my-class { ... }
```

**Never use the Tailwind `dark:` prefix** — it won't work with this theme system.

There is also a text-size preference: `data-text-size="small|medium|large"` → root font-size 14/16/18px.

## Ambient Background

The signature "neon mesh" depth: `body::before` paints four fixed radial-gradient blobs — purple `rgba(168,85,247,.08)` top-left, light purple `rgba(192,132,252,.05)` top-right, blue `rgba(56,189,248,.07)` bottom-right, lime `rgba(163,230,53,.04)` bottom-center (light mode bumps each ~+.02 opacity). All content sits above it (`@layer base { body > * { position: relative; z-index: 1; } }` — this stacking rule is load-bearing, don't remove).

*(A film-grain `body::after` texture existed historically but has been REMOVED from the app — don't re-add it, and ignore older docs describing it.)*

## Typography

### Brand Fonts (via `next/font/google` in `layout.tsx`)
- **Body:** Plus Jakarta Sans (`--font-body`) — warm humanist sans, applied to `body`
- **Headings:** Outfit (`--font-heading`) — geometric; `h1, h2, h3, .font-heading` get it automatically via `globals.css`, so no inline `style={{fontFamily}}` needed
- **Logo:** Space Grotesk (`--font-logo`) — the `tbr*a` wordmark ONLY, via `.font-logo`

(Older docs claiming DM Sans, Source Sans 3, or Literata are wrong — those fonts are not loaded.)

### The wordmark
`tbr*a` renders in Space Grotesk with the brand gradient via `.logo-gradient`:
```css
background: linear-gradient(90deg, var(--accent) 0%, var(--neon-blue) 50%, var(--neon-purple) 100%);
/* + background-clip: text */
```
This lime → blue → purple gradient is the brand signature. **It is used ONLY on the wordmark.**

### H1 — Page Titles
Plain **bold foreground text** (`text-2xl font-bold tracking-tight`), Outfit via the h1 selector. **No gradient.**
- ⚠️ Vestige: a few pages (buddy-reads, franchise grid) still carry a `neon-heading` class — it is defined NOWHERE and renders as a no-op. Don't imitate it and don't "fix" it by adding a gradient; plain foreground is the current design.
- Book pages: the title lives inside `BookHeader` (`text-xl lg:text-2xl font-bold`, overlay-white over the hero blur), not a standard H1.

### H2 — Section Headings (`.section-heading`)
```css
font-weight: 600; letter-spacing: 0.01em; color: var(--foreground);
```
Sized `text-xl lg:text-lg`. Normal case, foreground color. *(The old uppercase + neon-blue treatment is gone — sections are quieter now.)*

### H3 and below
Heading font (automatic), `font-bold` as needed, no special class.

## Pill / Badge Styles

All pills/badges use **translucent backgrounds**, never solid fills:
```css
.my-badge { background: color-mix(in srgb, var(--color) 10%, transparent); color: var(--color); }
[data-theme="light"] .my-badge { background: color-mix(in srgb, var(--color) 20%, transparent); color: #18181b; }
```
- **Verified badge** — translucent primary, green text dark / black text light (`.verified-badge`)
- **Reader badge** — accent text dark / black light (`.reader-badge`)
- **"AI" badge** — `bg-surface-alt text-muted`
- **Genre pills** — `bg-surface-alt` with border
- **Top-level genre pill** (book header) — the one solid-accent exception: lime bg, black text
- Never use left-border accents on cards/panels.

## Links

- `.read-more-link` / `.tbr-reason-tag`: lime `#a3e635` dark, purple (`var(--neon-purple)`) light — all "view all X" links use this
- General tappable text: `text-neon-blue`

## Buttons

- **Primary CTA:** solid lime `#a3e635`, black text, both modes. Never white text on green. Disabled state uses a neutral surface (never a darkened/olive green).
- **Secondary:** border (`border-border`) + translucent fill
- **Buy Button:** border-only, muted icon, visible in both modes. (Amazon affiliate: it must ALWAYS render for logged-out users — see CLAUDE.md.)
- **Track Progress** (Reading Now cards): black text dark mode, white text light mode (`.track-progress-btn`)
- Tap feedback: `.tap-scale` (scale 0.97, 120ms ease-out)

## Motion Language

All GPU-composited, all disabled under `prefers-reduced-motion`:
- **Page transitions** (View Transitions API): 200ms slide, 30px offset — forward slides left, back-nav reverses
- **Popovers:** 150ms scale(0.95→1) + 4px rise
- **Toasts:** slide up 12px + fade
- **Card entrance:** 250ms fade+rise, staggered 40ms per index (`.card-stagger`)
- **Skeletons:** 1.5s shimmer sweep across `surface-alt → border → surface-alt`
- **Ambient:** glow-drift (8s), frosted-breathe (6s), orb-drift (10s) on decorative blobs
- **Notification bell:** 600ms ring keyframe; dot pop 300ms

## Glass / Frosted Cards

- `.landing-glass-card`: `rgba(255,255,255,.06)` bg + `blur(12px)` backdrop + 10% white border (dark); light mode uses a purple→blue→lime tinted gradient at ~5% with purple border/shadow
- Bottom sheets use a 36×4px rounded drag handle (`.bottom-sheet-handle`, muted at 40%)

## Horizontal Scroll Sections

Side-scrolling rows (recommendations, series, etc.):
- `overflow-x-auto` + `no-scrollbar` (hidden scrollbar)
- `.mask-fade-right` — CSS mask `linear-gradient(to right, black 85%, transparent 100%)` hints at more content
- Right padding (`pr-12`) so the last item isn't clipped
- Desktop (`lg:`) often switches to grid with `lg:overflow-visible`

```html
<div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2 pr-12 no-scrollbar mask-fade-right">
  {items.map(item => <Card />)}
</div>
```

## Book Page Hero Card — Light Mode Vibrancy

The hero uses the cover as a blurred background. Light mode needs specific filter/blend values to stay vibrant on white. **DO NOT change these values** — they are hand-tuned.

### Hero bleed background image (`.book-hero-img`)
- **Dark (default):** `opacity-60 saturate-150 brightness-110 blur-3xl scale-150`
- **Light override:**
  ```css
  [data-theme="light"] .book-hero-img {
    opacity: 0.9;
    filter: blur(64px) saturate(2.5) brightness(1.6);
    mix-blend-mode: screen;   /* drops dark pixels into the white bg */
  }
  ```

### Card inner background image (`.book-card-bg-img`)
- **Dark:** `opacity: 0.4; filter: blur(16px) saturate(1.5);`
- **Light:** `opacity: 0.5; filter: blur(16px) saturate(2.5) brightness(1.4); mix-blend-mode: screen;`

### Overlay + edge fades (current values)
```css
.book-header-overlay { background: rgba(0,0,0,0.30); }
[data-theme="light"] .book-header-overlay { background: rgba(255,255,255,0.52); backdrop-filter: blur(8px); }

[data-theme="light"] .book-hero-fade-bottom {
  background: linear-gradient(to bottom, transparent 65%, var(--background) 100%);
}
[data-theme="light"] .book-hero-fade-sides {
  background: linear-gradient(to right, rgba(250,251,252,0.3), transparent 25%, transparent 75%, rgba(250,251,252,0.3));
}
```

### No-cover fallback
`.no-cover-gradient`: `linear-gradient(135deg, #3b5998 0%, #6b3fa0 40%, #8b5cf6 70%, #4c6ef5 100%)` + a 7%-opacity crosshatch pattern.

**WARNING:** never `replace_all` on opacity values in `globals.css` — the file is full of individually tuned opacities.

## iOS / PWA behaviors worth preserving in any native port

- `100dvh` min-height (URL-bar-safe), `viewportFit: cover` + safe-area insets on the sticky nav
- Tap highlight suppressed globally; `.tap-scale` provides press feedback instead
- Pull-to-refresh with a 200ms-eased indicator
- Status bar style `black-translucent`; theme-color `#0a0a0a` dark / `#ffffff` light
- Spoiler text: hidden (transparent text on `surface-alt` chip) until tapped; particle sparkle overlay on reveal
