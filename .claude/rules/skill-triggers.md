# Skill Trigger Guide

When working on tbr*a, proactively leverage installed skills based on the current task context.

## UI / Component Work
When building, modifying, or reviewing React components or pages:
- **frontend-design** — Use for any new UI, page layout, or visual component creation
- **vercel-react-best-practices** — Apply when writing or refactoring components (Server Components, data fetching, performance patterns)
- **vercel-composition-patterns** — Apply when structuring component hierarchies, creating shared abstractions, or refactoring component APIs
- **web-design-guidelines** — Use when reviewing UI changes for accessibility, UX, and design compliance

## Database / Query Work
When touching schema, queries, migrations, or enrichment pipeline:
- **drizzle-orm-expert** — Use for any Drizzle schema changes, relational queries, migration strategies, or Turso/libSQL integration
- **sql-optimization-patterns** — Use when writing or reviewing queries against the 62MB+ book database, adding indexes, or diagnosing slow queries

## Security / Auth
When working on auth, sessions, API routes, user input, or reviewing code before deploy:
- **insecure-defaults** — Run against any auth code, session handling, API routes, or config changes. Check for hardcoded secrets, weak defaults, fail-open patterns
- **sharp-edges** — Use when reviewing API designs, config patterns, or any code that handles user trust boundaries
- **differential-review** — Use when reviewing a batch of changes before commit/deploy. Estimates blast radius and flags security regressions

## Input Validation
When handling user input, form data, API request/response shapes, or import pipelines:
- **zod-validation-expert** — Use for all schema validation, form parsing, API input validation, and type inference from Zod schemas

## Error Handling
When implementing new features, API routes, or user-facing flows:
- **error-handling-patterns** — Apply when building new server actions, API routes, or any flow where failures need graceful degradation for beta users

## App Packaging / PWA
When preparing for mobile deployment, offline support, or installability:
- **progressive-web-app** — Use for service worker setup, web app manifest, caching strategies, and installability checks

## Pre-Deploy / Review Checklist
Before any significant deploy, invoke these in sequence:
1. **differential-review** — Review all changes since last deploy
2. **insecure-defaults** — Scan for security regressions
3. **sharp-edges** — Check for footgun patterns in new code
