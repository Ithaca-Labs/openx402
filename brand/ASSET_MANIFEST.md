# openx402 asset manifest

The approved [`openx402-brandkit-overview.png`](./openx402-brandkit-overview.png) is the sole identity source. Every exported mark below uses the same measured bracket/X geometry.

Preview the complete system: [`openx402-asset-contact-sheet.png`](./openx402-asset-contact-sheet.png).

## Canonical logo

### Vector marks

All have transparent backgrounds and identical geometry.

- [`mark-yellow.svg`](./logo/svg/mark-yellow.svg) — preferred on Ink
- [`mark-black.svg`](./logo/svg/mark-black.svg) — preferred on Yellow or Paper
- [`mark-white.svg`](./logo/svg/mark-white.svg) — emergency monochrome on dark imagery

### Vector horizontal lockups

All wordmarks use the same outlined Archivo Variable SemiBold 600 master at 100% width; no fallback or runtime font dependency.

- [`lockup-primary-dark.svg`](./logo/svg/lockup-primary-dark.svg) — yellow mark + Paper wordmark
- [`lockup-primary-light.svg`](./logo/svg/lockup-primary-light.svg) — yellow mark + Ink wordmark
- [`lockup-yellow.svg`](./logo/svg/lockup-yellow.svg) — one-color yellow
- [`lockup-black.svg`](./logo/svg/lockup-black.svg) — one-color black
- [`lockup-white.svg`](./logo/svg/lockup-white.svg) — one-color white

### Vector wordmarks

- [`wordmark-black.svg`](./logo/svg/wordmark-black.svg)
- [`wordmark-white.svg`](./logo/svg/wordmark-white.svg)
- [`wordmark-yellow.svg`](./logo/svg/wordmark-yellow.svg)

### Transparent PNG marks

- [`mark-yellow-transparent-1024.png`](./logo/png/mark-yellow-transparent-1024.png)
- [`mark-black-transparent-1024.png`](./logo/png/mark-black-transparent-1024.png)
- [`mark-white-transparent-1024.png`](./logo/png/mark-white-transparent-1024.png)

### Transparent PNG lockups

- [`lockup-primary-dark-transparent-2000.png`](./logo/png/lockup-primary-dark-transparent-2000.png)
- [`lockup-primary-light-transparent-2000.png`](./logo/png/lockup-primary-light-transparent-2000.png)
- [`lockup-yellow-transparent-2000.png`](./logo/png/lockup-yellow-transparent-2000.png)
- [`lockup-black-transparent-2000.png`](./logo/png/lockup-black-transparent-2000.png)
- [`lockup-white-transparent-2000.png`](./logo/png/lockup-white-transparent-2000.png)

Wordmark-only transparent PNGs are included in black, white, and yellow at 2000 px wide.

## Fonts

- [`Archivo-Variable.ttf`](./fonts/Archivo-Variable.ttf) — primary, display, and wordmark family
- [`IBMPlexMono-Regular.ttf`](./fonts/IBMPlexMono-Regular.ttf) / [`IBMPlexMono-Medium.ttf`](./fonts/IBMPlexMono-Medium.ttf) — technical labels
- SIL Open Font License files are packaged beside each family.

### Background-safe previews

- [`lockup-on-ink-2400x800.png`](./logo/png/lockup-on-ink-2400x800.png)
- [`lockup-on-yellow-2400x800.png`](./logo/png/lockup-on-yellow-2400x800.png)
- [`lockup-on-paper-2400x800.png`](./logo/png/lockup-on-paper-2400x800.png)

## Favicons and app icons

- [`favicon.svg`](./favicon/favicon.svg)
- PNG: `16`, `32`, `48`, `180`, `192`, and `512` px
- [`apple-touch-icon.png`](./favicon/apple-touch-icon.png)
- [`icon-192.png`](./favicon/icon-192.png)
- [`icon-512.png`](./favicon/icon-512.png)

## Social

- X: [`x-header-1500x500.png`](./social/x-header-1500x500.png) — HD-generated paper/yellow texture inspired by panel 7, with the canonical black lockup composited separately
- GitHub: [`github-social-preview-1280x640.png`](./social/github-social-preview-1280x640.png)
- Open Graph: [`open-graph-1200x630.png`](./social/open-graph-1200x630.png) — HD-generated ink/yellow texture inspired by panel 1, with the canonical primary-dark lockup centered at 66.7% canvas width
- LinkedIn-compatible crop: [`open-graph-1200x627.png`](./social/open-graph-1200x627.png)
- Avatar: [`avatar-400.png`](./social/avatar-400.png) — preferred social master with a full Ink background and 21–22% visible padding
- Complete profile set: [`social/profile/`](./social/profile/) — X, LinkedIn, GitHub, Discord, 1024 px master, alternate colorways, and transparent marks
- Separate 1024 colorways: [`social/profile/1024-colorways/`](./social/profile/1024-colorways/) — 10 native SVG and PNG exports covering Ink, Signal Yellow, Paper, white, and transparent backgrounds
- Downloadable 1024 pack: [`openx402-social-avatar-colorways-1024.zip`](./social/profile/openx402-social-avatar-colorways-1024.zip)
- Square-background colorway preview: [`social-avatar-square-preview.png`](./social/profile/social-avatar-square-preview.png)
- Square post: [`feed-square-1080x1080.png`](./social/feed-square-1080x1080.png)
- Portrait post: [`feed-portrait-1080x1350.png`](./social/feed-portrait-1080x1350.png)

Editable SVG wrappers sit beside the social PNGs. Full-resolution generated backgrounds are included as [`x-header-background-generated.png`](./social/x-header-background-generated.png) and [`open-graph-background-generated.png`](./social/open-graph-background-generated.png).

## Rules

1. Use SVG in product/web surfaces; PNG for platform uploads.
2. Keep one mark color per lockup. Only the primary lockups mix yellow with Paper/Ink.
3. Do not redraw the mark from memory or substitute the former hourglass variant.
4. Preserve aspect ratio and clear space.
5. Use the packaged files directly; do not reconstruct the logo from the overview bitmap.
6. Overview panels are art direction only; never upscale or ship panel crops.
