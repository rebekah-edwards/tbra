# tbr*a Branding & Design Guidelines

## Brand Colors

### Accent / Primary: Lime Green
- **Value:** `#a3e635` (Tailwind lime-400)
- **Dark variant:** `#84cc16` (lime-500)
- **Usage:** Primary CTA buttons, accent highlights, the `*` in the logo
- **CRITICAL RULE:** Text on lime green backgrounds must ALWAYS be **black** (`#18181b`). Never use white, gray, or any other color on top of this green. The ONLY exception is in dark mode where translucent green pills may use the green itself as text color (e.g., `color: var(--primary)` on a 10% opacity green background).

### Neon Purple
- **Dark mode:** `#c084fc` (purple-400)
- **Light mode:** `#7c3aed` (purple-600)
- **Usage:** Gradient headings, "read more" / "view all" links on light mode

### Neon Blue
- **Dark mode:** `#38bdf8` (sky-400)
- **Light mode:** `#2563eb` (blue-600)
- **Usage:** Section headings, links, rating display

### Intensity Scale (Content Ratings)
- 0 (None): border/muted color
- 1 (Mild): blue
- 2 (Moderate): yellow/amber
- 3 (Heavy): orange
- 4 (Extreme): red

## Theme System

Uses `data-theme` attribute (`"dark"` or `"light"`), NOT Tailwind's `dark:` prefix. All theme-specific styles must use:
```css
/* Dark mode (default) */
.my-class { ... }

/* Light mode override */
[data-theme="light"] .my-class { ... }
```

**Never use Tailwind `dark:` prefix** — it won't work with this theme system.

## Typography

### Brand Fonts
- **Body:** DM Sans (`--font-body`) — clean, modern sans-serif for all body text
- **Headings:** Space Grotesk (`--font-heading`) — geometric, techy feel for all headings
- Always set headings with `style={{ fontFamily: "var(--font-heading), system-ui, sans-serif" }}`

### H1 — Page Titles
- **Standard pages** (Home, Search, Stats, etc.): `.neon-heading text-2xl font-bold tracking-tight`
  - Uses the rainbow gradient (accent -> blue -> purple) via `.neon-heading`
  - Example: "Search", "Your Stats", "Reading Notes"
- **Book pages**: Book title is rendered inside the `BookHeader` component, NOT as a standard H1
  - Title uses `text-xl lg:text-2xl font-bold` in white/foreground (no gradient)
  - The gradient color effect comes from the hero blur background instead
- **Auth pages** (Login, Signup): `.neon-heading text-3xl font-bold tracking-tight`

### H2 — Section Headings
- Use `.section-heading` class: **uppercase, bold (700), letter-spacing 0.05em**
- Color: `text-neon-blue` (sky-400 dark, blue-600 light)
- Size: `text-xl lg:text-lg` on home page sections, `text-xl` on book page sections
- Examples: "READING NOW", "WHAT READERS THINK", "WHAT'S INSIDE", "MORE IN THIS SERIES"

### H3 and below
- Use heading font but no special class — just `font-bold` as needed

## Pill / Badge Styles

All pills and badges should use **translucent backgrounds**, not solid fills. This creates visual consistency across the app.

Pattern:
```css
/* Dark mode: subtle, translucent */
.my-badge { background: color-mix(in srgb, var(--color) 10%, transparent); color: var(--color); }

/* Light mode: slightly more opaque, BLACK text */
[data-theme="light"] .my-badge { background: color-mix(in srgb, var(--color) 20%, transparent); color: #18181b; }
```

### Specific Badges
- **"Verified"** — translucent primary/accent, `.verified-badge`
- **"AI"** — `bg-surface-alt text-muted` (gray, subtle)
- **Genre pills** — `bg-surface-alt` with border
- **Top-level genre pill** (book header) — solid accent bg, black text

## Link Colors

### "Read more" / "View all" pattern (`.read-more-link`)
- **Dark mode:** Lime green (`#a3e635`)
- **Light mode:** Purple (`var(--neon-purple)` = `#7c3aed`)

All "view all X" links (reviews, notes, series) should use this class for consistency.

## Button Styles

### Primary CTA (e.g., "Reading Now", "Sign in to track")
- Solid lime green background, black text
- Never white text on green

### Secondary (e.g., "Format", "Owned")
- Border-only with translucent fill
- Uses `border-border` for visibility in both modes

### Buy Button
- Border-only (`border-border`), muted icon
- Must be visible in both light and dark modes

## Horizontal Scroll Sections

Side-scrolling content rows (book recommendations, series, etc.) should:
- Use `overflow-x-auto` with `no-scrollbar` (hide browser scrollbar)
- Apply `.mask-fade-right` to show a fade-out hint on the right edge, signaling more content
- The fade uses CSS mask: `linear-gradient(to right, black 85%, transparent 100%)`
- Add right padding (`pr-12`) so the last item isn't clipped by the fade
- On desktop (`lg:`), some sections switch to grid layout with `lg:overflow-visible` which naturally removes scroll

### Pattern
```html
<div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2 pr-12 no-scrollbar mask-fade-right">
  {items.map(item => <Card />)}
</div>
```

## Book Page Hero Card — Light Mode Vibrancy

The book page hero area uses the book cover as a blurred background gradient. In light mode, specific filter/blend settings are required to keep the colors vibrant against the white background. **DO NOT change these values.**

### Hero bleed background image (`.book-hero-img`)
- **Dark mode (default):** `opacity-60 saturate-150 brightness-110 blur-3xl scale-150`
- **Light mode override** (in globals.css):
  ```css
  [data-theme="light"] .book-hero-img {
    opacity: 0.9;
    filter: blur(64px) saturate(2.5) brightness(1.6);
    mix-blend-mode: screen;
  }
  ```
  - `mix-blend-mode: screen` drops dark pixels (they become the white bg) and lets bright/colorful pixels shine through
  - `saturate(2.5)` and `brightness(1.6)` compensate for the screen blend washing out colors

### Card inner background image (`.book-card-bg-img`)
- **Dark mode:** `opacity: 0.4; filter: blur(16px) saturate(1.5);`
- **Light mode override:**
  ```css
  [data-theme="light"] .book-card-bg-img {
    opacity: 0.5;
    filter: blur(16px) saturate(2.5) brightness(1.4);
    mix-blend-mode: screen;
  }
  ```

### Hero bleed fade edges (light mode)
```css
[data-theme="light"] .book-hero-fade-bottom {
  background: linear-gradient(to bottom, transparent 30%, rgba(250,251,252,0.85) 80%, #fafbfc);
}
[data-theme="light"] .book-hero-fade-sides {
  background: linear-gradient(to right, rgba(250,251,252,0.3), transparent 25%, transparent 75%, rgba(250,251,252,0.3));
}
```

**WARNING:** These values were carefully tuned. Changing opacity, saturation, brightness, or blend mode will break the light mode book card appearance. The `@layer base { body > * { position: relative; z-index: 1; } }` rule is critical for the stacking context — removing or moving it will also break the visual hierarchy.

## Film Grain Texture

A subtle SVG noise overlay is applied via `body::after` for organic texture:
- **Dark mode:** 3% opacity
- **Light mode:** 4.5% opacity
- Uses `feTurbulence` with `baseFrequency='.75'` and `numOctaves='4'`
- `z-index: 0` (between glow at z-index 0 and content at z-index 1 via `@layer base`)
- The hero bleed also has its own grain via `.hero-bleed::after` if needed (currently only the body-level grain is active)

**Do not increase grain opacity above ~10%** without verifying it doesn't affect text readability or card appearance. Never use `replace_all` on opacity values in globals.css — there are many carefully tuned opacity values throughout the file.

## Dark Mode Defaults
- Background: `#0a0a0f` (near-black with slight blue)
- Surface: `#12121a`
- Text: `#e4e2ef` (warm off-white)

## Light Mode Defaults
- Background: `#fafbfc` (cool white)
- Surface: `#ffffff`
- Text: `#18181b` (near-black)
