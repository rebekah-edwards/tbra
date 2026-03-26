# Font Themes (Premium Feature — Future)

Font themes allow premium users to customize the app's typographic feel. Each theme defines a heading and body font pair.

## Architecture

- Font theme stored in user profile: `fontTheme` column in `users` table
- Applied via `data-font-theme` attribute on `<html>`, same pattern as `data-theme`
- CSS variables `--font-heading` and `--font-body` are redefined per theme
- All fonts loaded via `next/font/google` in `layout.tsx`

## Default Theme: "Modern"

- **Heading:** Outfit (geometric, confident)
- **Body:** Plus Jakarta Sans (warm humanist, excellent readability)
- Applied when no `data-font-theme` is set, or `data-font-theme="modern"`

## Future Themes

### "Literary"
- **Heading:** Lora (elegant serif, editorial feel)
- **Body:** Source Sans 3 (neutral, high readability)
- **Vibe:** Book review magazine, literary journal

### "Indie"
- **Heading:** Cabinet Grotesk (soft, rounded geometric — not on Google Fonts, would need self-hosting or substitute with Nunito)
- **Body:** Instrument Sans (clean, slightly warm)
- **Vibe:** Independent bookstore, curated

### "Classic"
- **Heading:** Libre Baskerville (traditional serif)
- **Body:** Inter (the universal sans)
- **Vibe:** Timeless library, established

## Implementation Notes

- The logo ALWAYS uses Space Grotesk regardless of font theme (loaded as `--font-logo`)
- `.neon-heading` gradient text works with any heading font
- `.section-heading` uses `var(--font-heading)` via the `h2` selector
- Non-heading elements that need the heading font use the `.font-heading` utility class
- When implementing: add fonts to `layout.tsx`, add CSS variable overrides in `globals.css` under `[data-font-theme="theme-name"]`
