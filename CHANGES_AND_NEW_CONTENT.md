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

## 2026-10-22 — Six audited Builder bug fixes (engine v1.1.1)

### NEW files
- `src/builder/merge.js`: safe multi-source row reconciliation. Preserves unrelated files, worksheets, hand-created rows, edited fields, stable event identities, and explicit deletions. Rows absent from a re-import are **retained for manual review** and reported, never automatically removed.
- `tools/test-bugfixes.mjs`: repeatable regression suite for all six previously reproduced defects, plus legacy session migration, imported-canonical-session preservation, source-row conflict handling and poster grouping.

### MODIFIED files
- `src/builder/main.js`: maps both PDF and structured/CSV/XLSX imports to the new merge module.
- `src/builder/package.js`: groups identically named sessions by date, track, location **and temporal continuity**; separates past incorrectly grouped sessions, while respecting explicit canonical package membership. Empty coordinates are omitted (true 0 is kept) and out-of-range coordinates are ignored.
- `src/builder/importers.js`: CSV delimiter detection ignores delimiters inside quoted headers; PDF extraction handles a date and timed presentation on the same line.
- `src/validation.js`: strict Gregorian date validity for conference and session dates (including leap years).
- `package.json`: new `npm run test:bugfixes` included in `npm test` and GitHub Actions' existing test gate.
- `bootstrap.js`, `service-worker.js`, `src/builder/package.js`, `package.json`: engine version v1.1.1 so installed PWAs receive a new service-worker cache; newly generated packages require engine >=1.1.1.

### Scope and caveats
- All six test groups pass with Node 22. GitHub Pages will re-run `npm test` when these files are uploaded.
- HTTP/file browsing with Chromium was prevented by the test environment's administrator policy. Real browser acceptance still needs to run on the deployed site.
- Ambiguous source-row reorderings are not silently discarded; verify retained rows via the Builder conflict panel. An organizer can explicitly delete unwanted rows.
- The current GitHub branch was not modified by preparing this ZIP.
- `TEST_RESULTS.md` (NEW): executed test matrix and the browser-environment limitation.

## 2026-10-23 — Browser acceptance, PDF review and deployment (v1.1.2)

- Added locked Playwright Chromium tests for navigation, offline notes/favorites,
  preferences, Builder CSV mapping/bulk editing/autosave, package release failure
  recovery, rollback, attendee data isolation and waiting engine updates.
- Fixed engine asset coherence: installed assets use the active version cache
  while replacement workers wait; conference JSON still uses package activation.
- Improved deterministic PDF extraction with gutter separation, repeated timed
  column inference, explicit room/track/session context, wrapped title retention,
  numbered posters and provisional assignment/OCR warnings. Added layout fixtures.
- Added reciprocal presentation membership, poster parent type and location cycle
  validation, with regressions across both independent conference packages.
- Added extracted deployment ZIP checks for both packages. Pages now stages public
  files and excludes dependencies, tests and traces; generated workflows also stage
  their attendee files. Development CI installs Chromium and runs the full suite.
- Retained the six previous bug fixes and their tests. No conference programme or
  attendee storage schema was changed. Browser coverage is Chromium automation;
  real-device interoperability, arbitrary PDF/OCR quality and live Pages deployment
  still require acceptance outside this local suite.
- Browser repetition exposed a note-save race: navigation/preferences could reset
  the shared write timer and reload before notes reached IndexedDB. Writes now
  start immediately, and note status says Saved only after transaction completion.
  The offline UI note/favorite regressions cover the previously failing sequence.
- Generated deployment ZIPs now create `.nojekyll` directly instead of fetching a
  dotfile omitted from Pages artifacts; ZIP regressions simulate that missing file.
