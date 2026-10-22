# 2026-10-22 — PPTX alignment changes

## New files (visibly separated from pre-existing source)
- `tools/test-release.mjs` — cross-conference integrity and ICS acceptance checks.
- `tools/test-importers.mjs` — CSV/PDF import regressions.
- `RELEASE_PROCESS.md` — static publish, tag, rollback-as-new-release and production acceptance.
- `.github/workflows/deploy.yml` and `.nojekyll` — included in this full ZIP; absent from GitHub Pages deployment artifact because dotfiles were excluded from that artifact (both existed in the GitHub repository).

## Modified files
- `src/calendar.js` — UUIDv4 URN for **new** Builder-issued calendar UIDs. Pre-existing published UIDs remain untouched.
- `tools/test-core.mjs` — UUID contract and independent fixture checks.
- `tools/test-release.mjs` — release-level semantic and checksum assertions (new).
- `src/builder/package.js` — generated app has OG/Twitter preview tags pointing to the share-preview asset.
- `src/builder/importers.js` — date extraction supports European/ISO dates; CSV accepts quoted commas, escaped quotes and multiline text.
- `fixtures/multi-track-no-posters/*` — genuinely independent US timezone, venues, speakers and branding with regenerated checksums.
- `package.json`, `README.md`, `ARCHITECTURE.md` — testing and UID documentation.

## Not invented / not claimed complete
- **NEURONICS production data:** official programme not supplied; the default `conference/` remains an explicit generic demo, not a fictitious NEURONICS programme.
- **AI-assisted PDF classification:** current importer uses PDF.js, OCR and deterministic heuristics. AI classification requires a real service/key and privacy policy; it is not represented as implemented.
- **Cloud, GitHub automated publishing, Git tags:** deliberately deferred or manual in the static pilot.
- **Full browser/device interoperability and update-recovery testing:** described in `RELEASE_PROCESS.md`; source/CI tests cannot replace real-device validation.
