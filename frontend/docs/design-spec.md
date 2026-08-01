# Product & Design Specification

## 1. Purpose

This document is the design source of truth for the application. It defines the visual language, shared interface patterns, page responsibilities, responsive behavior, and quality bar for implementation.

The product is a branded explorer for discovering and understanding activity across the x402 ecosystem. It should feel trustworthy, fast, legible, and data-rich without becoming visually noisy.

The reference product is [x402scan](https://www.x402scan.com/). The reference images in [`docs/inspo/`](./inspo/) describe layout and interaction patterns only. They are not a source for copying brand colors, logos, icons, text, or visual assets.

## 2. Design direction

### Concept: quiet infrastructure

The interface should communicate reliable infrastructure through restraint:

- Primarily Paper (`#F4F0E6`) or light neutral surfaces with Ink (`#111111`) typography.
- Thin Graphite rules and subtle elevation to separate data groups.
- Signal Yellow (`#FFD21C`) used sparingly for active navigation, links, charts, selected states, progress, and primary actions.
- Generous horizontal alignment and a consistent centered content column.
- Dense information presented in calm, scannable structures: stat cards, tables, charts, filters, and compact entity cards.

The design should gradually reveal the brand accent through interaction and data visualization. Do not turn the entire interface into an accent-colored theme.

### What this is not

- Do not copy x402scan's logo, favicon, exact colors, typography, copy, or icons.
- Do not use generic gradients, glassmorphism, excessive rounded cards, or decorative crypto clichés.
- Do not introduce a second visual identity for individual routes.
- Do not invent logos or brand assets when an approved asset is not available.

## 3. Brand and asset rules

The approved brand package is available at `/Users/arkoroy/Desktop/ith/brand/`. Product implementation should copy or otherwise expose the required assets through the app's public asset pipeline; do not import from an absolute local filesystem path at runtime.

Confirmed brand inputs:

1. Canonical product name: `openx402`.
2. Primary logo lockups: `brand/logo/svg/lockup-primary-light.svg` for light surfaces and `brand/logo/svg/lockup-primary-dark.svg` for dark surfaces.
3. Compact mark: `brand/logo/svg/mark-black.svg` on yellow/paper, `brand/logo/svg/mark-yellow.svg` on ink.
4. Favicon/app icons: `brand/favicon/favicon.svg`, plus PNG sizes from 16 px through 512 px and `apple-touch-icon.png`.
5. Brand colors: Signal Yellow `#FFD21C`, Ink `#111111`, Paper `#F4F0E6`, and Graphite `#5D5B56`.
6. Typography: Archivo Variable for display/body/UI and IBM Plex Mono for technical labels and machine-readable metadata. The supplied `brand/tokens.css` defines the font-face declarations and baseline tokens.

Use SVG in product surfaces and PNG for platform exports. Preserve the logo's proportions and clear space. Do not redraw the gate mark, add effects, fuse it with the Stellar logo, or substitute the former hourglass variant. The brand guide specifies a 16 px minimum for the mark and 96 px minimum for mark plus wordmark.

The package does not contain a supplied directory of marketplace, facilitator, network, or ecosystem entity logos. Use entity-provided marks only where available from the data source, with a neutral fallback that does not imitate the openx402 mark.

## 4. Application structure

### Routes

| Route | Page purpose | Primary content | Main actions |
| --- | --- | --- | --- |
| `/` | Discover the ecosystem at a glance | Hero/search entry point, headline metrics, recent activity, featured entities | Search, open an entity, view all activity |
| `/all` | View aggregate ecosystem performance | Overall stats, time controls, charts, ranked entities table | Change time range/grouping, sort, paginate, open entity |
| `/marketplace` | Browse available services/merchants | Marketplace metrics, category sections, entity cards, search/filter controls | Search, filter, browse, open entity |
| `/transactions` | Inspect tracked payments | Transactions table, filters, pagination | Filter, sort, paginate, open transaction/entity |
| `/facilitators` | Compare payment facilitators | Facilitator metrics, ranked table/cards, activity indicators | Sort, filter, open facilitator |
| `/networks` | Compare supported networks | Network cards/table, usage and volume summaries | Sort, filter, open network |
| `/ecosystem` | Explore the wider ecosystem | Curated ecosystem categories and entity directory | Filter by category, open entity/external link |

Each route must have a clear page title and one-sentence description. The active route must be visible in the shared navigation.

## 5. Shared shell

### Header and navigation

Use one shared navigation component on every route. The reference is [`docs/inspo/nav.png`](./inspo/nav.png).

Desktop behavior:

- Full-width header with a thin bottom border.
- Brand logo/mark at the left.
- Horizontal route navigation beside or after the brand.
- Active item uses the brand accent and a clear underline or bottom indicator.
- Header remains visually quiet; avoid a heavy shadow.

Responsive behavior:

- On narrow screens, preserve the logo and replace the full route list with an accessible menu control or horizontally scrollable navigation; choose one pattern and use it consistently.
- The active route must remain discoverable without relying on color alone.
- The header must not cause horizontal page overflow.

### Content canvas

- Use a centered max-width content container with consistent side padding.
- Page headers align with the content below them.
- Long pages may scroll normally; do not create nested scrolling regions unless required by a table.
- Footer treatment should be consistent across routes and may include brand, external links, privacy, and terms.

### Page header

Every data route should start with:

- `h1` page title.
- Supporting description.
- Optional controls aligned to the right on desktop and stacked below on mobile.
- A visible divider or spacing transition before the main content.

## 6. Visual system

### Color

Define colors as semantic tokens, not one-off values:

```text
--color-background
--color-surface
--color-surface-muted
--color-border
--color-text
--color-text-muted
--color-accent
--color-accent-foreground
--color-success
--color-warning
--color-danger
```

The brand accent is reserved for active navigation, links, focus rings, chart strokes, positive emphasis, selected controls, and primary actions. Data meaning must not depend on color alone.

### Typography

- Use the approved brand font(s) once supplied.
- Establish a clear hierarchy: page title, section title, metric value, body, label, and metadata.
- Use tabular numerals for metrics and table columns where supported.
- Use a monospace treatment only for hashes, wallet addresses, IDs, and other machine-readable values.
- Never use typography below a legible mobile size merely to fit more columns.

### Shape, borders, and elevation

- Prefer modest corner radii and 1px borders.
- Use elevation only to distinguish interactive cards, popovers, or floating controls.
- Tables and chart cards should feel like one coherent system, not unrelated widget styles.
- Icons should be optically aligned and paired with visible labels when the meaning is not universally understood.

## 7. Reusable components

Build the following as shared primitives before composing route-specific pages:

- `AppShell` / page container
- `SiteHeader` and responsive navigation
- `PageHeader`
- `StatCard` with label, value, optional delta, and optional mini-chart
- `TimeRangeSelect` and grouping/filter controls
- `SectionHeader`
- `EntityLogo` with loading, missing, and error fallback
- `EntityCard`
- `DataTable` with sortable columns, responsive behavior, and pagination
- `Sparkline` / compact chart
- `Badge` / status indicator
- `EmptyState`, `LoadingState`, and `ErrorState`
- `Footer`

Components should accept semantic data and state props. Avoid route-specific markup variations that make the same pattern look different from page to page.

## 8. Page-specific requirements

### Discover (`/`)

This is the orientation page, not a duplicate of `/all`.

- Lead with a concise explanation of what the explorer makes visible.
- Make search/discovery the most obvious action.
- Follow with a small set of headline metrics and a recent or notable activity module.
- Include clear paths into Marketplace, Transactions, Facilitators, Networks, and Ecosystem.

### All (`/all`)

Reference: [`docs/inspo/all.png`](./inspo/all.png).

- Show overall statistics in a four-card grid on desktop.
- Each card may include a compact trend visualization and a defined time range.
- Provide grouping and time-range controls near the section title.
- Follow statistics with a ranked entity table containing enough context to compare entries quickly.
- On mobile, cards become a single-column or two-column layout and the table becomes a deliberate card/list presentation or supports horizontal scrolling with preserved column meaning.

### Marketplace (`/marketplace`)

Reference: [`docs/inspo/marketplace.png`](./inspo/marketplace.png).

- Page header should establish that users are exploring services/merchants.
- Show marketplace headline metrics before browse sections.
- Group entities into meaningful categories or ranked collections.
- Cards should expose identity, short description, URL/domain, and the most useful activity metrics.
- Carousels, if used, must have visible previous/next controls, keyboard support, and a non-carousel fallback on small screens.

### Transactions (`/transactions`)

Reference: [`docs/inspo/txns.png`](./inspo/txns.png).

- Make recency and transaction identity easy to scan.
- Suggested fields: entity/server, amount, sender, transaction hash, timestamp, network, and facilitator.
- Hashes and addresses must be shortened visually but copyable in full.
- Support loading, empty, error, sorting, and pagination states.
- Timestamp rendering must communicate timezone or use a consistent relative-time convention with an accessible exact-time label.

### Facilitators, Networks, and Ecosystem

Use the same page grammar: page header, optional headline metrics, then a ranked or categorized directory.

- Facilitators emphasize routing/activity and supported capabilities.
- Networks emphasize chain identity, volume, transaction count, and availability.
- Ecosystem emphasizes categories, recognizable entity identity, descriptions, and outbound destinations.

Do not force every route into the exact same card/table layout when the content has different information needs; reuse the visual primitives and interaction rules instead.

## 9. Data and interaction states

Every data-bearing component must define these states before implementation:

- Loading: preserve layout dimensions with skeletons or placeholders.
- Success: show formatted values and the last-updated context where relevant.
- Empty: explain why no data is present and provide a useful next action.
- Error: explain what failed in plain language and provide retry behavior where possible.
- Partial data: show available content without presenting missing values as zero.
- Stale data: communicate staleness when freshness affects interpretation.

Controls should provide immediate visual feedback, preserve the selected state, and avoid resetting unrelated filters. Links to external destinations must be clearly identified.

## 10. Responsive and accessibility requirements

- Design mobile-first and verify at minimum narrow mobile, tablet, laptop, and wide desktop widths.
- Maintain a visible keyboard focus state for every interactive element.
- Use semantic headings, landmarks, buttons, links, labels, and table markup.
- Meet WCAG AA contrast for text, controls, and focus indicators.
- Never use color as the only way to communicate status, selection, sorting, or trend direction.
- Provide accessible names for icon buttons and meaningful alt text for informative images; decorative images use empty alt text.
- Respect `prefers-reduced-motion` and keep animations non-essential.
- Tables must remain usable with zoom and keyboard navigation.

## 11. Motion

Motion should clarify state, not decorate the interface:

- Use short transitions for hover, focus, selection, and disclosure.
- Use a restrained page-entry reveal only where it improves orientation.
- Avoid animated counters or continuously moving charts unless the data is genuinely live and the motion can be paused.
- Disable or reduce non-essential motion for users who request reduced motion.

## 12. Implementation notes

- Keep the Next.js implementation aligned with the version-specific guidance in `node_modules/next/dist/docs/` before writing application code.
- Keep content/data models separate from presentation components.
- Use semantic tokens so brand updates do not require editing individual components.
- Prefer real data-shaped fixtures during UI development so loading, empty, long-text, and missing-logo states are exercised.
- Do not remove or replace approved brand files with generated substitutes.

## 13. Definition of done

The implementation is ready for review when:

- All six routes plus the discover home route use the shared shell and active navigation.
- The brand asset and token inputs are confirmed and used consistently.
- Each route has a clear responsive layout and defined loading, empty, and error states.
- Tables, filters, pagination, links, and menu controls are keyboard accessible.
- No page has horizontal overflow at supported widths.
- Charts and metrics have text equivalents or accessible labels.
- Visual comparison against the reference images confirms the intended information hierarchy without copying the reference brand.
- `npm run lint` and `npm run build` pass.

## 14. Open inputs

Brand inputs are resolved by the package at `/Users/arkoroy/Desktop/ith/brand/` and its [`BRAND_GUIDE.md`](../../brand/BRAND_GUIDE.md), [`ASSET_MANIFEST.md`](../../brand/ASSET_MANIFEST.md), and [`tokens.css`](../../brand/tokens.css). The remaining product decisions are:

1. Confirm the data source/API and freshness expectations.
2. Confirm whether entity details open in dedicated routes, drawers, or external links.
3. Confirm the preferred mobile navigation pattern.
4. Confirm whether dark mode is in scope. The brand package supports Ink/Paper/Yellow colorways, but dark mode is not required by this specification unless explicitly approved.
