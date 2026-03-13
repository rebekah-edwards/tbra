# tbr(a) - Taxonomy v0 (draft)

Owner: Rebekah (final editorial authority)
Author: Spine (product/data architecture)
Updated: 2026-02-26

## Goals
- Make the first book page *immediately useful* to a based reader who wants to avoid progressive messaging and see detailed content profiles.
- Keep v0 simple enough to populate 100 books quickly.
- Preserve auditability: internal citations + evidence level per claim.

## Global scoring conventions

### Intensity scale (0-4)
- **0 - None** (not present)
- **1 - Minor** (brief / background / fleeting)
- **2 - Moderate** (recurring but not dominant)
- **3 - Major** (frequent / central)
- **4 - Extreme** (graphic / pervasive / defining)

### Notes requirement
- **Required** for any category with **intensity ≥ 2**.
- Notes should be descriptive, spoiler-minimizing, and avoid moral judgments.

### Evidence levels (per claim)
- **AI Inferred** - derived from summaries/reviews/excerpts.
- **Cited** - backed by stored citations (internal).
- **Human Verified** - team member read the full book and confirmed/updated.

### Citations policy
- Citations are stored internally.
- Front end may show an optional **"Why we think this"** expandable section for selected fields (v0 can ship with this hidden behind a toggle or admin-only).

---

## Categories (v0)

Below are the first 11 categories for launch.

### 1) LGBTQIA+ representation
- **Intensity (0-4)**
- **Notes (≥2)**
- Optional sub-tags (later): identity types present, relationship centrality, on-page vs implied.

### 2) Religious content
- **Intensity (0-4)**
- **Notes (≥2)**
- Capture: overt religiosity, clergy/rituals, conversion themes, devotional framing.

### 3) Witchcraft / occult
- **Intensity (0-4)**
- **Notes (≥2)**
- Capture: magic-as-occult framing vs fantasy "spellcasting"; rituals, summoning, demonology.

### 4) Sexual content
- **Intensity (0-4)**
- **Notes (≥2)**
- Capture: on-page vs fade-to-black, explicitness, frequency.

### 5) Violence & gore
- **Intensity (0-4)**
- **Notes (≥2)**
- Capture: body horror, torture, graphic description, sexualized violence (if relevant to #10).

### 6) Political & ideological content
- **Intensity (0-4)**
- **Notes (≥2)**
- Definition: political / social / cultural messaging outside religion.
- Notes should be *descriptive* ("contains progressive gender themes", "anti-capitalist framing", "traditional family values framing").

### 7) Profanity / language
- **Intensity (0-4)**
- **Notes (≥2)**
- Capture: frequency and severity.

### 8) Substance use
- **Intensity (0-4)**
- **Notes (≥2)**
- Capture: alcohol/drugs, glamorized vs cautionary, addiction themes.

### 9) Self-harm / suicide
- **Intensity (0-4)**
- **Notes (≥2)**
- Capture: ideation vs attempt, on-page depiction.

### 10) Sexual assault / coercion
- **Intensity (0-4)**
- **Notes (≥2)**
- Capture: threat, coercion, assault, aftermath; keep notes minimal but clear.

### 11) Child harm
- **Intensity (0-4)**
- **Notes (≥2)**
- Capture: threat vs depiction, on-page vs implied.

---

## Resolved questions
1) Naming locked: **Political & ideological content**
2) "Why we think this" — show for **all categories** (resolved 2026-03-12)

## Open questions
3) Do we add a separate "Romance focus" (not sexual explicitness) in v1?
