# Conference Companion architecture

## Separation of concerns

The system has four boundaries:

1. **Attendee engine** — generic UI and local attendee features.
2. **Published conference package** — normalized official conference data.
3. **Builder project state** — private import/provenance/editing state used to produce releases.
4. **Optional Cloud** — future hosted services; not required by the static PWA.

The attendee engine never parses organizer PDFs or spreadsheets. The Builder never publishes its source/provenance state into the attendee package.

## Canonical entities

- Conference
- Track
- Session
- Presentation
- Poster
- Person
- Location
- Announcement

References use immutable IDs. A session owns its date, envelope, location and track. A presentation owns its individual start/end slot and references its parent session. Calendar UIDs are generated once and preserved independently of repository/domain names.

`src/model.js` provides UI-friendly projections while retaining the canonical entity references; there is no legacy data adapter.

## Release lifecycle

A conference programme release is immutable once published. New official content uses a larger `dataVersion`. Rollback is represented operationally by activating a prior last-known-good package locally; a subsequent official rollback should still be published as a new, higher release version.

The attendee app downloads and validates a candidate before changing its active package. Activation is a single IndexedDB transaction and the prior validated record is retained.

## Attendee storage

`localStorage` is limited to tiny display/navigation preferences. Attendee-owned data is namespaced by `conference.id` and stored in IndexedDB:

- favorites
- notes
- profile
- Friend Book contacts/private annotations
- photos and thumbnails

A personal-data ZIP can round-trip this data, including image blobs.

## Engine updates

The service worker caches stable engine assets. It deliberately does not call `skipWaiting()`: a newly installed engine waits until a clean launch rather than taking control and force-reloading an attendee who may be editing notes or photos.

Conference JSON is not managed by the service-worker cache. Its lifecycle is handled by `package-store.js` so there is only one authority for data-package activation.

## Builder re-import policy

Imported rows retain private source identifiers, immutable entity identifiers, calendar UIDs and manual-field markers. On re-import:

- organizer-edited fields win;
- a changed source value behind an organizer override becomes a review warning;
- calendar-relevant source changes increment `SEQUENCE`;
- deleted source rows remain deleted;
- stable entity IDs are preserved.

## Calendar contract

ICS exports use the conference IANA timezone and include a `VTIMEZONE` component. Each calendar-relevant entity has an immutable `calendarUid`. Calendar-relevant edits increment `sequence` so downstream calendar clients can understand revisions.

## Privacy contract

Favorites, private notes, photos and private Friend Book metadata remain device-local by default. QR sharing uses a compact vCard and intentionally excludes private annotations and large media.
