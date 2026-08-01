# Todo

## Plan

- [x] Author every approved colorway natively at 1024×1024.
- [x] Export each colorway as a separate SVG and PNG.
- [x] Create a dedicated downloadable 1024 colorway ZIP.
- [x] Refresh the manifest and complete brand package.

## Verification

- [x] Confirm identical canonical paths and native 1024 artboards.
- [x] Confirm opaque backgrounds and transparent alpha variants.
- [x] Visually inspect every separate colorway.
- [x] Validate SVGs and both ZIP archives.

## Review

### Changed

- Added 10 separate native 1024×1024 SVG and PNG colorways.
- Added a dedicated downloadable colorway ZIP and updated the complete package.
- Added a colorway preview and usage notes.

### Verified

- All files use the two canonical paths with identical `translate(179.2 179.2) scale(6.656)` geometry.
- All PNGs are 1024×1024; every mark has the same centered `575×587+225+219` visible bounds.
- Opaque corner pixels match their specified backgrounds; transparent variants retain alpha.
- All SVGs pass `xmllint`; both ZIP archives pass `unzip -tq`.

### Risks

- White-on-yellow and yellow-on-white are intentionally included for completeness but are low-contrast alternates.

### Follow-ups

- None.
