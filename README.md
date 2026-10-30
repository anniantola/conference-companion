# Conference Companion

Current engine release: **v1.2.13**.

Conference Companion is a standalone, offline-first conference PWA plus a browser-based Conference Builder. The attendee engine is stable and conference content is published as a normalized, versioned data package rather than being hard-coded into the UI.

## What is implemented

Builder project backups are restored only after archive, project structure, binary assets, and a disposable package build pass validation; an organizer confirms replacement before saving. Incomplete drafts remain restorable. CSV/XLSX/row-JSON imports stay as mapping previews until applied, and failed parsing or storage writes preserve the existing project and previous source files. The attendee release cache keeps five validated releases (active plus four recent); an explicitly selected rollback remains pinned until updates are resumed.

Step 4 profile identity decisions and Step 3 programme-person assignments are separate. Confirming two profiles as different suppresses only the duplicate-profile warning; an appearance with an ambiguous name still blocks export until its speaker, chair, or poster-author assignment is explicitly selected. Assignment issues link to the exact programme row by stable row ID, and confirmed row assignments survive re-import and Builder backup/restore. Repeated package builds recompute ambiguity from current profiles and decisions rather than trusting stale row flags.

Step 3 bulk edits use the same name-based identity reconciliation as individual row edits. Replacing a speaker or chair cannot carry a previous person's confirmed ID into the new name.

In Step 4, each possible duplicate profile has its own checkbox. The first profile checked is the primary that survives; additional checked profiles are merged into it. Unchecking the primary promotes the earliest remaining selection, and each name group maintains an independent selection order. The confirmation preview shows retained profile information and offers choices for conflicting single-value fields. A merge updates all programme references in one staged operation and preserves alternate profile photographs in the Builder backup. A confirmed **Different people** decision blocks an incompatible merge until it is explicitly reopened.

Builder Step 2 now provides a source manager, explicit merge/replace-source/replace-programme modes, and a before-commit comparison of additions, updates, unchanged entries, conflicts, and removals. Source removal recovers historical provenance from legacy identifiers and import journals. **Clear imported programme data** removes imported rows even if the source registry is damaged; rows whose origin is genuinely uncertain require an individual keep/delete decision. Deletion is staged, validated, persisted, read back, and compared with the rebuilt attendee package before the Builder reports success. Corrected source-backed entries can be explicitly retained as manual records; shared entries and independent manual records remain. Step 4 presents ambiguous identities with programme and source context, and supports persistent pair decisions (same, different, or unresolved) plus atomic bulk profile resolution. PDF extraction is staged separately: confident entries, entries needing review, and unrecognized text are distinct; uncertain entries are opt-in and large extractions require acknowledgement. This remains heuristic extraction, not a guarantee for arbitrary PDF layouts; organizers must review every entry and the specific real programme PDF has not been verified.

### Attendee PWA

- Package-driven programme with canonical `Session`, `Presentation`, `Poster`, `Person`, `Track` and `Location` entities.
- Multiple conference days, parallel tracks, location filters, search, current-time navigation and overlap warnings.
- Favorites / My Schedule.
- Notes stored in IndexedDB.
- Photos stored in IndexedDB, including camera capture, EXIF/time matching, assignment review, thumbnails, titles, notes, Gallery and Unclassified photos.
- PPTX export for notes and presentation photos.
- Personal-data ZIP backup and restore, including favorites, notes, Friend Book, profile photo and conference photos.
- Standards-based `.ics` export for one programme item, starred schedule or full programme, including `VTIMEZONE`, immutable calendar UIDs and `SEQUENCE` support. New Builder-created UIDs use persistent `urn:uuid:<UUIDv4>`; already published UIDs remain unchanged.
- Friend Book with an optional local profile photo, conference card, compact vCard QR sharing, vCard import, live QR scanning with `BarcodeDetector` or a bundled offline fallback, private notes/tags and conference/event “met at” context.
- Announcements.
- Generic conference branding, track/location colors, typography, logo and sponsor assets.
- Installable PWA with a service worker that does not force-reload an attendee while an engine update is waiting.

### Conference data lifecycle

`bootstrap.js` loads `conference-manifest.json` network-first. `src/package-store.js` then:

1. checks schema and minimum engine compatibility;
2. enforces monotonic `dataVersion` releases;
3. downloads the complete candidate JSON package;
4. verifies SHA-256 checksums;
5. applies supported schema migrations and validates the current JSON Schemas;
6. validates semantic and referential integrity;
7. atomically activates the validated package in IndexedDB;
8. retains the previous validated release for local rollback;
9. falls back to the last-known-good release when offline or when a candidate fails validation.

A same-version release with changed checksums is treated as a mutated release and is not activated. Older network releases are ignored. The Settings page shows the active data release and changelog/notices. Choosing a previous validated release pins it across restarts and disables network package checks until **Resume automatic updates** is selected. Engine updates and conference `dataVersion` releases remain separate; rollback never deletes attendee data.

Each deployment resolves its package path to a canonical absolute URL before using IndexedDB. Its service worker caches engine assets under its own scope, so separate GitHub Pages repositories on one hostname cannot exchange packages, rollback choices, or offline assets. Attendee state, photos, and preferences use both the deployment path and package URL in their storage keys; Builder projects use the deployment path. Old origin-wide records are left untouched because their owning deployment cannot always be determined. The first v1.2.13 launch needs a network connection to seed the new scoped release cache; old rollback pins do not transfer automatically. Restore a previously downloaded personal backup in the intended deployment, and restore a Builder project ZIP in its intended Builder. If no backup exists, keep the browser profile and site data intact for assisted recovery; clearing site data destroys those legacy records.

### Conference Builder

Open `builder.html` in the development repository. The Builder implements:

- an eight-step wizard with direct step navigation, Previous/Next controls, active-step persistence, and validation links to the relevant step; steps can be visited in any order;
- PDF import through PDF.js with lazy OCR fallback for scanned pages. Extraction is staged in a review screen; time-anchored candidates, lower-confidence entries and unrecognized text are separated, and no PDF rows reach the programme before confirmation;
- XLS/XLSX import through SheetJS with explicit worksheet selection;
- CSV and structured JSON import;
- deterministic column mapping, including optional speaker/author and chair IDs in CSV/XLSX imports;
- editable review table with multi-row selection and bulk edits;
- first-class session editor so location/track/session-window changes are made once per Session and cascade to child talks;
- source provenance and re-import conflict handling;
- an imported-source manager with file-level contribution summaries and explicit Merge, Replace this source, and Replace programme modes. A preview lists additions, updates, unchanged rows, uncertain matches, and removals before the organizer confirms;
- re-import reconciliation that prioritizes structured entity IDs and compares existing project rows only. Exact-title/context matches can cross file formats; a renamed cross-file candidate is offered for organizer choice, not automatically matched. Posters require a poster number in matching session context; source row position alone never transfers an identity or organizer correction;
- preservation of organizer-edited fields, entity IDs, calendar UIDs and SEQUENCE history on correctly matched re-imports; ambiguous matches remain separate and are reported for review, while missing source rows remain visible;
- a persistent ID-centered person registry (with migration of older name/affiliation indexes), explicit person IDs for structured and spreadsheet data, affiliation-aware matching, and a contextual identity-review workflow. Organizers can confirm two profiles are the same person, explicitly keep them separate, or leave the pair unresolved; decisions persist in project backups and across re-imports;
- stable private identities for conference, sessions, presentations, calendar UIDs, people, locations and tracks;
- an alphabetic People directory with search, role filters, one Save/Cancel editor, ORCID/web links and optional uploaded photographs; identity comparisons show programme titles, sessions, dates, rooms/tracks and source references. Single and bulk resolutions are previewed and saved atomically, with surviving-profile and field-selection controls;
- location editing including hierarchy, map URL and coordinates;
- track editing and per-location/per-track color palettes, reflected in programme review;
- branding, app icon, conference logo and sponsor assets, with immediate color previews and a live attendee-runtime preview for date, room and screen size;
- feature flags and review policy warnings;
- announcements;
- JSON Schema contract validation plus semantic/referential validation before ZIP export; contextual messages name the affected programme item, date/time and room/track and link to its editor;
- missing PDF schedule fields and incomplete programme rows remain editable drafts and block export until corrected;
- stable data versions and changelog history, with export tracking separated from the organizer's explicit confirmation that a release was deployed;
- private Builder project autosave in IndexedDB with visible save failures;
- Builder project ZIP export/import, including source files and assets;
- repository-ready deployment ZIP generation with the attendee engine, conference package, install assets, validator and GitHub Pages workflow.

CSV, XLSX, structured JSON and PDF programme imports share the same pre-commit comparison and confirmation boundary. Source removal reports which rows are shared or manually edited. Replace-programme previews the unmatched rows that will be removed and preserves conference settings and branding. Failed parsing or storage writes leave the saved project unchanged.

PDF extraction uses layout positions to separate repeated time columns, recognizes only time-anchored programme candidates automatically, and keeps headings, footers, author lines and other unassigned text in a separate review list. Organizers can edit candidates, exclude them or explicitly convert unrecognized lines into incomplete draft rows. Confidence labels describe heuristic assignment quality; they do not guarantee accurate extraction. Arbitrary conference PDFs and the specific organizer's original PDF have not been independently verified. OCR is attempted for image-only or text-poor pages, and its results require review.

Builder project ZIPs are complete private backups: they include the full project, imported source files, app icon, legacy and light/dark logos, person photographs, ordered sponsor metadata and nested light/dark sponsor variants. Assets have unique archive paths and are checked for missing or damaged content. Import validates the whole archive before replacing the autosaved project; a failed import leaves the current project intact. Older single-logo and flat-sponsor projects remain supported. Keep project ZIPs private because they include source documents and organizer review data. The personal attendee backup is separate and replace-restores only the selected conference after its own validation.

The Builder deliberately keeps source files, mappings, provenance, manual overrides and re-import metadata private. They are not published in attendee conference JSON.

The live attendee preview uses the same generated package model and runtime as the deployment ZIP. Opening Step 8 builds it from the current project, and changes to settings, programme, features, and branding update it automatically. **Refresh preview** always rebuilds the iframe, even when the package fingerprint is unchanged; **Validate** also refreshes it. The status shows Loading, Up to date, or Failed independently of validation errors, so an incomplete project can still be inspected. Refresh keeps the selected date, room, and screen size. Each iframe load gets a temporary Builder-only conference ID for personal storage, so preview interactions cannot overwrite attendee-owned data for the actual conference. Refresh does not export a ZIP or change publication versions. Installation and service-worker registration are disabled in the preview. Uploaded logo, sponsor and profile images are shown from local object URLs; published URLs still use the ZIP assets. Review the deployed site on physical devices for PWA installation, camera, and platform-specific appearance.

Step 6 configures the attendee default appearance (Light, Dark, or Follow device), separate light/dark preview appearance, theme-specific logos, header colors and layout, heading and body fonts, color presets, and sponsor order and variants. Existing darkMode projects migrate as true → Dark and false → Follow device; a legacy single logo remains the fallback for both themes. Six curated font families use local WOFF2 subsets cached by the service worker for offline use. Their Open Font License notices are included under assets/fonts/. Generated conference packages carry the branding fields and asset variants shown in Step 8. Preview appearance remains private Builder state and is not exported as the conference default.

CSV and structured JSON imports work without external libraries. XLS/XLSX, PDF text extraction and OCR load SheetJS, PDF.js, and Tesseract.js lazily from their public CDNs when those formats/features are used. These Builder imports therefore need network access to fetch the library (and, for OCR, worker/runtime/language data); the attendee application and its offline operation do not depend on these libraries. The current versions use Apache-2.0-licensed packages. They are not bundled in the attendee deployment: vendoring their complete browser runtimes and OCR data would materially increase Builder payload and maintenance, while only a subset of the distribution is needed for each task. Offline Builder file import is not currently guaranteed.

The synthetic 91-row regression contains 23 distinct person names and 18 posters. Before the chair identity fix it generated 45 profiles, including 22 accidental duplicate chair profiles; fresh imports now generate 23. Previously saved projects keep their existing person IDs until an organizer confirms a merge. A confirmed merge updates programme references and preserves the selected profile details, affiliations, papers and chosen photograph. Project ZIPs from earlier Builder versions remain importable.

Downloading a deployment ZIP records an export only. After uploading and deploying that ZIP, the organizer can confirm the published version in the Builder. A confirmed data version is bound to its content fingerprint: unchanged content can be re-exported, while changed content requires a higher version. Builder package validation runs the repository JSON Schemas and semantic checks before an export is enabled.

## Repository layout

```text
/
├── .github/workflows/deploy.yml
├── conference/                     # default fictional development package
├── fixtures/
│   └── multi-track-no-posters/     # structurally different regression package
├── schemas/                        # JSON Schema contracts
├── src/
│   ├── package-store.js            # validated/atomic data release lifecycle
│   ├── model.js                    # canonical model + UI projections
│   ├── user-store.js               # attendee IndexedDB data
│   ├── validation.js               # semantic/referential validation
│   ├── json-schema.js              # runtime JSON Schema validation
│   ├── migrations.js               # schema migration boundary
│   ├── calendar.js                 # ICS/VTIMEZONE generation
│   ├── vcard.js                    # profile/contact vCards
│   ├── qrcode.js                   # dependency-free QR encoder
│   ├── backup.js                   # personal-data ZIP backup
│   ├── zip.js                      # ZIP reader/writer used by local exports
│   └── builder/
│       ├── main.js
│       ├── importers.js
│       ├── package.js
│       ├── project-store.js
│       └── project-file.js
├── tools/
│   ├── validate-conference.mjs
│   ├── schema-check.mjs
│   └── test-core.mjs
├── index.html
├── app.js
├── bootstrap.js
├── styles.css
├── service-worker.js
├── builder.html
├── builder.css
└── manifest.webmanifest
```

## Conference package

A deployed package contains:

```text
conference/
├── conference-manifest.json
├── conference.json
├── programme.json
├── people.json
├── locations.json
├── branding.json
└── assets/
```

`conference-manifest.json` contains independent release metadata:

- `schemaVersion`
- monotonically increasing `dataVersion`
- `minimumEngineVersion`
- `publishedAt`
- package file checksums
- changelog entries

PWA install metadata remains in the separate root `manifest.webmanifest`.

## Local development

A local HTTP server is required because package files are loaded using `fetch()`:

```bash
python3 -m http.server 8080
```

Attendee app:

```text
http://localhost:8080/
```

Regression package:

```text
http://localhost:8080/?conference=./fixtures/multi-track-no-posters
```

Conference Builder:

```text
http://localhost:8080/builder.html
```

## Validation and tests

```bash
npm test
```

This runs JSON Schema contract checks, semantic/referential validation and core tests for the canonical model, unrelated multi-track fixture, timezone/DST ICS output, UID contract, vCard/QR handling, ZIP backup, immutable Builder identities, session-level room cascade, monotonic release versioning, service-worker asset coverage and static accessibility smoke checks.

## Deployment

The repository workflow validates the project before deploying to GitHub Pages. A conference-specific deployment generated by the Builder contains its own validation workflow and can be uploaded to a fresh conference repository.

No GitHub credentials, organizer credentials or attendee account are embedded in a generated attendee app.

## Cloud boundary

The static implementation intentionally keeps attendee-owned data on the device. A future optional Conference Cloud can add organizer accounts, managed publishing, push notifications, opt-in hosted profiles, tokenized `webcal` feeds and analytics without changing the canonical package contract. Those hosted services are outside this static repository by design.

### Builder import regression fixes (v1.1.1)

`npm run test:bugfixes` exercises six fixes: preserving independent imports;
separating recurring session titles by time/location/track; parsing timed PDF
lines with inline dates; distinguishing blank from genuine zero coordinates;
detecting semicolon CSV despite quoted header commas; and rejecting impossible
calendar dates. This command runs in `npm test` and the Pages deployment gate.
Re-importing a source updates rows with matching source identities, preserves
manual edits, and retains unmatched older rows with a visible warning instead
of silently removing them. Review potentially obsolete rows in the Builder.

### Browser and deployment regressions (v1.1.2)

Use Node 22 or later. Install the locked test dependencies and free Chromium once:

```bash
npm ci
npx playwright install --with-deps chromium
npm test
```

`npm test` runs all Node checks and Playwright Chromium, Firefox, and WebKit tests. `npm run test:unit`
and `npm run test:browser` run them separately. Playwright starts its own local
HTTP server on port 8080; stop any other server on that port first. Failed browser
tests retain traces in `test-results/`. No API keys or hosted services are needed.

Browser tests cover both unrelated packages, navigation, preferences, favorites,
notes, offline reload, Builder CSV mapping/bulk edits/autosave, real IndexedDB
package activation/rollback, corrupt and incomplete releases, semantic rejection,
mutated and older releases, and preservation/isolation of attendee data. A real
service-worker replacement verifies waiting activation and coherent cached engine
scripts while a user edits. Generated deployment ZIPs are extracted and validated
for all conference fixtures. Browser coverage includes project ZIP byte-level
round trips, failed-restore non-overwrite, persistent online/offline rollback,
resume behavior, attendee-data preservation, and inert startup error rendering.
Pages CI installs all three browser engines and system dependencies, runs the
complete suite, and stages only public files into `_site`; dependencies and test
traces are excluded.

PDF extraction separates large gutters and infers independent columns when at
least two timed anchors recur in each column. Explicit `Track:`, `Room:` and
`Session:` headings provide context; numbered poster entries can inherit an
explicit poster-session window. Wrapped titles, OCR, ambiguous authors and
unassigned/overlapping entries produce organizer-review warnings. Every PDF row
remains provisional. Complex tables, unlabelled tracks, cross-page poster lists
and author-only continuation lines still require manual review. PDF.js/OCR are
loaded from public CDNs when used; the automated layout tests use deterministic
PDF text-item fixtures and do not certify arbitrary PDFs or CDN availability.

Note writes now begin immediately and display “Saved” after the IndexedDB
transaction completes, preventing navigation/preferences from delaying a pending
note write past a reload.

### Attendee completion regressions (v1.1.3)

Poster support is session-specific. A package may define any number of
`poster-session` records across dates and locations, and each poster must reference
its parent with `posterSessionId`. The attendee app groups posters and starred
posters chronologically by session; details, search, notes, gallery metadata,
photo-time suggestions and starred calendar exports all use the referenced parent
session. The synthetic `fixtures/multiple-poster-sessions` package verifies two
days and rooms without introducing official programme content.

Playwright now covers attendee layouts at 320, 375, 768 and 1280 pixels, including
six-item bottom navigation, schedule filters, event/poster sheets, scrolling,
notes, Gallery, Friend Book, Settings, QR and touch interaction. Personal-data
coverage creates and edits notes/photos, favorites and a contact card; imports a
vCard; saves private contact fields; exports individual/starred/full calendars;
and round-trips a complete ZIP backup. Conference-package update tests also keep
photo blobs alongside notes, profile and Friend Book data.

The Builder browser test imports representative synthetic CSV data, maps fields,
corrects a row, configures and validates the conference, downloads the deployment
ZIP, inspects its canonical entities, then loads the generated conference package
through the attendee UI. It covers parallel tracks, multiple venues, two poster
sessions and a social event.

Automated mobile checks detect document-level horizontal overflow and verify key
controls, but they do not replace VoiceOver/TalkBack, physical camera, installed
PWA, or platform file-share testing. Browser photo fixtures do not exercise EXIF
parsing from real camera files.

### Mobile installation, live QR and privacy controls (v1.1.4)

The manifest uses relative `id`, `start_url` and `scope` values so both this
GitHub Pages project and Builder-generated repositories install within their own
subdirectory and launch in `standalone` display mode. Chromium's one-shot native
install event is captured before package loading. When no programmatic prompt is
available, Settings labels the action as instructions and gives accurate iOS,
Android or desktop browser steps instead of claiming it can open a native prompt.

Friend Book QR scanning now opens a live rear-camera preview and stops after a
valid vCard, cancellation, navigation or page inactivity. It uses the browser's
`BarcodeDetector` when available and the vendored MIT-licensed `qr-scanner`
worker otherwise; both runtime files are cached for offline use and included in
Builder deployments. Manual `.vcf` import remains available. Contacts are sorted
alphabetically and collapsed to keyboard-accessible name rows by default.

Compact schedule mode now measurably reduces card height, padding, gaps and
typography in both Programme and My Schedule. A separate destructive Settings
action deletes only the current conference's attendee state, photos, Friend Book,
profile and preferences after an explicit warning. Pending writes are drained or
cancelled first; conference packages, installed engine files, other conferences,
downloaded backups and separately saved device photos are not removed.

Playwright validates manifest icons/scope, native-prompt plumbing, iOS guidance,
standalone detection, real offline QR decoding, live scanner lifecycle/error
handling, duplicate prevention, expandable contacts, measured compact layouts,
and cancellation/deletion/reload/isolation. Native browser install surfaces,
physical rear-camera selection and permission UI still require device testing.

### Friend Book My Card editor (v1.1.5)

The existing conference profile now appears above saved contacts in Friend Book.
Its summary includes saved contact details, with Share QR, Download vCard and Edit
actions beside it. Edit expands the existing profile fields; Save writes through
the same conference-scoped profile store, while Cancel discards unsaved text and
photo changes. Profile photos and fields remain part of personal backups.

### Production pilot hardening (v1.2.0)

Personal backup restore is a **replace** operation for the current conference's
attendee-owned data: favorites, notes, preferences, profile, contacts, and
application-stored photos. A confirmation explains replacement before storage
changes. The full backup is checked first, including ZIP integrity, required
photo files and image data, contact fields, and external links. A missing,
corrupted, or invalid photo rejects the whole restore and leaves existing
records in place. User data commits in one IndexedDB transaction; the separate
photo database is restored from a snapshot if a later commit fails. Official
conference packages and separately saved device photos are not part of restore.
For WebKit compatibility, attendee and Builder photo/file Blobs are stored as
typed bytes in IndexedDB and rebuilt as Blobs when loaded; existing native-Blob
records are still accepted.

Imported links from vCards, QR cards, backups, and conference packages allow
HTTPS, validated email links, ORCID identifiers, and DOI references. Executable
schemes, protocol-relative URLs, URL credentials, and unsafe relative asset
paths are rejected. DOI references are normalized to `https://doi.org/…` when
used as links; email fields remain email addresses.

The QR and photo overlays use native modal dialogs for browser-managed focus
containment, Escape handling, and return focus. Dialogs and scanner controls
have explicit accessible names. Playwright runs in Chromium, Firefox, and WebKit
in CI, including offline navigation, persistence, and engine-update lifecycle
checks. A waiting engine worker still activates only after open clients close;
it does not force a reload or clear attendee data.

Automated checks do not replace physical iOS/Android install, camera, and
VoiceOver/TalkBack checks. Local Linux WebKit runs also require Playwright's
WebKit operating-system libraries; the CI workflow installs them on its runner.
