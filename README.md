# Conference Companion

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
- Standards-based `.ics` export for one programme item, starred schedule or full programme, including `VTIMEZONE`, immutable calendar UIDs and `SEQUENCE` support.
- Friend Book with an optional local profile photo, conference card, compact vCard QR sharing, vCard import, QR image scanning where `BarcodeDetector` is available, private notes/tags and “met at” context.
- Announcements.
- Generic conference branding, track/location colors, typography, logo and sponsor assets.
- Installable PWA with a service worker that does not force-reload an attendee while an engine update is waiting.

### Conference data lifecycle

`bootstrap.js` loads `conference-manifest.json` network-first. `src/package-store.js` then:

1. checks schema and minimum engine compatibility;
2. enforces monotonic `dataVersion` releases;
3. downloads the complete candidate JSON package;
4. verifies SHA-256 checksums;
5. validates structure and referential integrity;
6. atomically activates the validated package in IndexedDB;
7. retains the previous validated release for local rollback;
8. falls back to the last-known-good release when offline or when a candidate fails validation.

A same-version release with changed checksums is treated as a mutated release and is not activated. Older network releases are ignored. The Settings page shows the active data release, changelog/notices and exposes rollback only when a previous validated release is available.

### Conference Builder

Open `builder.html` in the development repository. The Builder implements:

- PDF import through PDF.js with OCR fallback for image-only pages;
- XLS/XLSX import through SheetJS;
- CSV and structured JSON import;
- deterministic column mapping;
- editable review table;
- source provenance and re-import conflict handling;
- preservation of organizer-edited fields on re-import;
- stable private identities for conference, sessions, presentations, calendar UIDs, people, locations and tracks;
- people, location and track editing;
- branding, app icon, conference logo and sponsor assets;
- feature flags and review policy warnings;
- announcements;
- JSON Schema contract validation plus semantic/referential validation;
- monotonically increasing release versions and changelog history;
- private Builder project autosave in IndexedDB;
- Builder project ZIP export/import, including source files and assets;
- repository-ready deployment ZIP generation with the attendee engine, conference package, install assets, validator and GitHub Pages workflow.

The Builder deliberately keeps source files, mappings, provenance, manual overrides and re-import metadata private. They are not published in attendee conference JSON.

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

This runs JSON Schema contract checks, semantic/referential validation and core tests for the canonical model, ICS output, vCard/QR handling, ZIP backup, immutable Builder identities and monotonic release versioning.

## Deployment

The repository workflow validates the project before deploying to GitHub Pages. A conference-specific deployment generated by the Builder contains its own validation workflow and can be uploaded to a fresh conference repository.

No GitHub credentials, organizer credentials or attendee account are embedded in a generated attendee app.

## Cloud boundary

The static implementation intentionally keeps attendee-owned data on the device. A future optional Conference Cloud can add organizer accounts, managed publishing, push notifications, opt-in hosted profiles, tokenized `webcal` feeds and analytics without changing the canonical package contract. Those hosted services are outside this static repository by design.
