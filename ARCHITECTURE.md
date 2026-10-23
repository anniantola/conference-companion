# Conference Companion architecture

This repository follows the Conference Companion technical plan used for the NEURONICS 2027 pilot: one reusable attendee engine, one normalized conference package per event, a separate organizer Builder, and an optional Cloud layer that remains deferred for the static pilot.

## 1. Separation of concerns

The system has four boundaries:

1. **Attendee engine** — generic UI, offline behavior and local attendee features.
2. **Published conference package** — normalized official conference data and branding.
3. **Builder project state** — private import/provenance/review state used to create releases.
4. **Optional Cloud** — future hosted services; not required by the static PWA.

The attendee engine never parses organizer PDFs or spreadsheets. The Builder never publishes raw source files, mappings, provenance or private review state into the attendee package.

## 2. Canonical entities and identity rules

Published data uses the plan's canonical entities:

- Conference
- Track
- Session
- Presentation
- Poster
- Person
- Location
- Announcement

Non-negotiable rules:

- entity IDs are immutable;
- references use IDs, never titles;
- Session owns the date, session window, location and track;
- Presentation owns its individual start/end slot and references its Session;
- ISO dates and an IANA conference timezone are used;
- `schemaVersion` handles data-contract evolution;
- `dataVersion` handles official programme releases.

`src/model.js` indexes canonical entities by ID and creates UI projections without rebuilding a legacy conference model. Programme items use `locationId` directly; there is no room-name compatibility field.

## 3. Package validation and migration

The browser update pipeline has two validation layers before activation:

1. JSON Schema validation using the contracts in `schemas/`;
2. semantic/referential validation using `src/validation.js`.

`src/migrations.js` is the single schema-migration boundary. The current published schema is version 1; future migrations are registered there instead of scattering schema conversion logic across the UI.

## 4. Offline/update lifecycle

Conference programme updates are independent of app-engine updates.

1. Fetch `conference-manifest.json` network-first.
2. Compare `dataVersion` and release checksums with the active package.
3. Download the complete candidate package.
4. Verify SHA-256 checksums.
5. Apply supported schema migrations.
6. Validate current JSON Schemas and cross-record rules.
7. Atomically activate the candidate in IndexedDB.
8. Keep the previous validated release for rollback.
9. Re-render against the same immutable entity IDs.
10. If download/validation fails, continue on the last-known-good package.

The service worker caches engine assets only. Conference JSON activation is owned by `package-store.js`, so there is one source of truth for official data.

## 5. Attendee storage and privacy

`localStorage` contains only small display/navigation preferences such as theme, compact mode, selected location/track and last view.

Attendee-owned state is namespaced by `conference.id` and stored in IndexedDB:

- favorites / My Schedule;
- talk and poster notes;
- profile and Friend Book contacts;
- private Friend Book notes/tags/met-at metadata;
- photo blobs, thumbnails and annotations.

A personal-data ZIP can round-trip this information, including images. Official conference updates never overwrite attendee-owned state.

## 6. Builder import/review contract

The Builder follows the plan's pipeline:

**Extract → Normalize → Structure → Validate → Review → Emit**

Supported sources:

- PDF: PDF.js text extraction, OCR fallback for image-only pages, heuristic draft rows for organizer review;
- XLS/XLSX: explicit worksheet selection plus deterministic column mapping;
- CSV: deterministic column mapping;
- structured JSON: bypasses extraction and preserves canonical IDs when supplied.

Review tools include row editing, selection + bulk edits, a session-level editor, people/locations/tracks, warnings/conflicts, branding, features, announcements and a phone preview.

Re-import preserves organizer corrections using source IDs and field-level manual markers. If an upstream source changes behind a reviewed correction, the correction wins and the conflict is surfaced for review.

## 7. Session-level editing rule

The Builder exposes Sessions as first-class editable entities. A room/location, track, date or session-window change is stored once in `sessionOverrides` and applied to the Session during package generation. Child presentations inherit the updated Session context automatically.

Calendar `SEQUENCE` is bumped for affected child presentations when a session-level calendar-relevant field changes.

## 8. Friend Book contract

The offline Friend Book uses standards-based local sharing:

- personal card: name, position, affiliation, email, ORCID, LinkedIn, website, papers/bio and optional local photo;
- compact vCard 4.0 + QR sharing;
- `.vcf` import/export;
- QR image scanning where `BarcodeDetector` is available;
- local snapshot of saved contacts;
- `metAtConferenceId`, optional `metAtEventId`, private notes, tags and free-text met-at context.

Large photos/paper payloads are intentionally not embedded in QR codes.

## 9. Calendar / ICS contract

New Builder-created calendar entities use the plan's UID shape:

`urn:uuid:<UUIDv4>`

The UID is assigned once and preserved on subsequent edits. Previously published UIDs are retained unchanged.

ICS exports include:

- conference `TZID` and `VTIMEZONE`;
- `SUMMARY`, `LOCATION`, `DESCRIPTION`, `URL`;
- `LAST-MODIFIED` and `SEQUENCE`;
- single-event, starred-schedule and full-programme exports.

## 10. Static deployment boundary

The Builder generates a repository-ready static deployment ZIP containing:

- stable attendee engine;
- validated conference package;
- PWA manifest/icons/branding assets;
- JSON Schemas and validators;
- GitHub Pages workflow with `npm test` as a deployment gate.

No organizer or GitHub credentials are embedded in the attendee PWA. Direct managed GitHub publishing, Git tags/releases, custom-domain automation, `webcal`, push and organizer accounts belong to the optional managed/Cloud layer and are intentionally not required by this static implementation.

## 11. Automated browser acceptance and engine coherence (v1.1.2)

Playwright exercises Chromium with real IndexedDB, Cache Storage and service
workers against a local static server. Release tests replace only the HTTP
package responses; activation, integrity checks and rollback use production
modules. Browser contexts isolate attendee storage between tests.

Installed engine assets are served from their versioned cache. A waiting worker
cannot replace an active page's modules via network-first fetching. Conference
JSON remains network-first and activates only through the package store.

PDF column inference requires repeated timed anchors and keeps source provenance
per page/column/line. Single-column source identities retain their previous shape.
Heuristic results carry private review warnings into the Builder report, never
into published conference JSON. Semantic validation additionally enforces parent
presentation membership, poster-session types and acyclic location hierarchies.

Development Pages builds install locked Playwright dependencies and gate deployment
on the full suite. An explicit public-file staging script excludes development
artifacts. Builder exports remain dependency-free attendee repositories; their
own `npm test` checks exported schemas/data, and their generated workflow stages
public files before upload. They do not claim to include the development browser
suite or private Builder sources.
