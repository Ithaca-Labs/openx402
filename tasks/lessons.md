# Lessons

## Pattern

- Mistake: Reinterpreted an approved generated logo when producing deterministic assets, causing identity drift.
- Rule: Once a visual source is approved, extract its geometry first and compare every derived mark side-by-side before export.

## Exact applications

- Mistake: Recreated an approved mockup instead of extracting the requested panel, and centered the file canvas rather than the visible lockup bounds.
- Rule: Match the panel's composition exactly, but regenerate its background at delivery resolution when the source is only a low-resolution overview. Center logos by measured visible bounds, then verify equal optical margins.

## Raster quality

- Mistake: Used low-resolution overview-panel crops as production social exports.
- Rule: Treat overview panels as art direction, generate texture at final resolution, and overlay the canonical vector-derived logo separately.

## Typography fidelity

- Mistake: Substituted a thin Helvetica-style outlined wordmark for the approved Archivo display treatment.
- Rule: Lock the approved font family, weight, width, and visible proportions before deriving any logo or social asset; never use a fallback font in exports.

## Mark derivation

- Mistake: Manually repositioned the avatar brackets, narrowing the canonical center gap and shifting the visible mark vertically.
- Rule: Derive avatars and icons by uniformly scaling the canonical `100×100` mark viewBox; never reposition the two brackets independently.

## Social scale

- Mistake: Let the OG lockup occupy too much of the canvas, weakening negative space and apparent centering.
- Rule: Center social lockups by trimmed visible bounds and verify their canvas occupancy at final export size.
