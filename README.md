# Conference Companion

Current engine release: **v1.2.1**.

Conference Companion is a standalone, offline-first conference PWA plus a browser-based Conference Builder. The attendee engine is stable and conference content is published as a normalized, versioned data package rather than being hard-coded into the UI.

## What is implemented

### Attendee PWA

- Package-driven programme with canonical `Session`, `Presentation`, `Poster`, `Person`, `Track` and `Location` entities.
- Multiple conference days, parallel tracks, location filters, search, current-time navigation and overlap warnings.
- Favorites / My Schedule.
- Notes stored in IndexedDB.
- Photos stored in IndexedDB, including camera capture, EXIF/time matching, assignment review, thumbnails, titles, notes, Gallery and Unclassified photos.
- PPTX export for notes and presentation photos.
- Personal-data ZIP backup and restore, including favorites, notes, Friend Book, profile photo and conference photos.
- Standards-based `.ics` export for one programme item, starred schedule or full programme, including `VTIMEZONE`, immutable calendar UIDs and `SEQUENCE` support. New Builder-created UIDs use persistent `urn:uuid:<UUIDv4>`; already published UIDs remain unchanged.
- Friend Book with an optional local profile photo, conference card, compact vCard QR sharing, vCard import, QR image scanning where `BarcodeDetector` is available, private notes/tags and conference/event “met at” context.
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

A same-version release with changed checksums is treated as a mutated release and is not activated. Older network releases are ignored. The Settings page shows the active data release, changelog/notices and exposes rollback only when a previous validated release is available.

### Conference Builder

Open `builder.html` in the development repository. The Builder implements:

- PDF import through PDF.js with OCR fallback for image-only pages and low-confidence review warnings;
- XLS/XLSX import through SheetJS with explicit worksheet selection;
- CSV and structured JSON import;
- deterministic column mapping;
- editable review table with multi-row selection and bulk edits;
- first-class session editor so location/track/session-window changes are made once per Session and cascade to child talks;
- source provenance and re-import conflict handling;
- re-import reconciliation that prioritizes structured entity IDs and matches spreadsheets only against pre-import records from the same source sheet; presentation matches use title/presenter and schedule context, while posters require a poster number in matching session context; source row position alone never transfers an identity or organizer correction;
- preservation of organizer-edited fields, entity IDs, calendar UIDs and SEQUENCE history on correctly matched re-imports; ambiguous matches remain separate and are reported for review, while missing source rows remain visible;
- explicit person IDs for structured data, affiliation-aware identity matching, and a Builder review selector for unresolved same-name people without enough affiliation evidence;
- stable private identities for conference, sessions, presentations, calendar UIDs, people, locations and tracks;
- people editing including ORCID/web links and optional uploaded speaker photos;
- location editing including hierarchy, map URL and coordinates;
- track editing and per-location/per-track color palettes;
- branding, app icon, conference logo and sponsor assets;
- feature flags and review policy warnings;
- announcements;
- JSON Schema contract validation plus semantic/referential validation before ZIP export;
- missing PDF schedule fields and incomplete programme rows remain editable drafts and block export until corrected;
- stable data versions and changelog history, with export tracking separated from the organizer's explicit confirmation that a release was deployed;
- private Builder project autosave in IndexedDB;
- Builder project ZIP export/import, including source files and assets;
- repository-ready deployment ZIP generation with the attendee engine, conference package, install assets, validator and GitHub Pages workflow.

The Builder deliberately keeps source files, mappings, provenance, manual overrides and re-import metadata private. They are not published in attendee conference JSON.

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

PDF/XLSX parsing libraries are loaded lazily by the Builder when those import paths are used. The attendee PWA has no dependency on those libraries.

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

`npm test` runs all Node checks and Playwright Chromium tests. `npm run test:unit`
and `npm run test:browser` run them separately. Playwright starts its own local
HTTP server on port 8080; stop any other server on that port first. Failed browser
tests retain traces in `test-results/`. No API keys or hosted services are needed.

Browser tests cover both unrelated packages, navigation, preferences, favorites,
notes, offline reload, Builder CSV mapping/bulk edits/autosave, real IndexedDB
package activation/rollback, corrupt and incomplete releases, semantic rejection,
mutated and older releases, and preservation/isolation of attendee data. A real
service-worker replacement verifies waiting activation and coherent cached engine
scripts while a user edits. Generated deployment ZIPs are extracted and validated
for both packages. Pages CI installs Chromium, runs the complete suite, and stages
only public files into `_site`; dependencies and test traces are excluded.

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
