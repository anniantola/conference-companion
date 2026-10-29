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

Builder re-imports match structured immutable entity IDs first. Spreadsheet rows
are reconciled only against records that existed before the incoming batch, and
only within the same source file and worksheet. Presentation matches use a
unique title/presenter and schedule context; posters require a poster number in
matching session/date context. A file/worksheet/row address is provenance only
and cannot decide identity by itself. Tied or insufficiently identified
candidates stay separate and require organizer review, and absent source records
are retained with a warning.
Organizer corrections, entity IDs, calendar UIDs and calendar `SEQUENCE` are
preserved only after a safe match. People identities use explicit IDs or
name-plus-affiliation evidence. Identity assignment registers affiliated
speakers before resolving chairs, so an unaffiliated chair reuses a single
reliable known identity. Multiple known affiliations for the same name remain
separate until an organizer resolves them. Existing saved IDs are retained.
The Builder's explicit profile merge records an alias, updates all row
speaker/chair IDs and keeps the selected surviving profile and field values;
the alias also applies to future structured re-imports. The People directory
renders compact rows and a single active editor. Wizard navigation and the
active step are Builder project state and do not affect attendee packages.

`src/model.js` indexes canonical entities by ID and creates UI projections without rebuilding a legacy conference model. Programme items use `locationId` directly; there is no room-name compatibility field.

## 3. Package validation and migration

The browser update pipeline has two validation layers before activation:

1. JSON Schema validation using the contracts in `schemas/`;
2. semantic/referential validation using `src/validation.js`.

`src/migrations.js` is the single schema-migration boundary. The current published schema is version 1; future migrations are registered there instead of scattering schema conversion logic across the UI.

The Builder runs those same JSON Schema contracts and semantic validation
before allowing a generated ZIP. Missing titles, poster dates/times, and other
required schedule values are not filled with plausible defaults; imported
draft rows remain visible with source-aware errors until corrected. ZIP export
is tracked separately from confirmed publication. Confirmed releases bind each
data version to a content fingerprint so an already published version cannot
be reused for different programme content.

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

Rollback is a deliberate, persistent update pause stored with the package
metadata. The selected validated release remains pinned across restarts and
offline launches; package loading will not fetch the newer network manifest
until the attendee chooses **Resume automatic updates**. Cached records are
revalidated on every load and retained for recovery. Rollback does not change
attendee stores or the app-engine version. If the pinned entry is damaged, the
loader can select another validated cached record at or below the pinned data
version. A candidate still downloading cannot activate after another client
has set the rollback lock.

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

CSV and structured JSON are parsed locally. XLS/XLSX loads SheetJS from the
SheetJS CDN, PDF extraction loads PDF.js from jsDelivr, and OCR loads Tesseract.js
plus its worker/runtime/language assets from jsDelivr. They are Apache-2.0
licensed and loaded only when needed. These files are not included in the
attendee engine or generated attendee ZIP. Builder import for those formats
needs network access when the relevant parser is first used; offline Builder
import is not guaranteed. Keeping the large optional parser/OCR runtime outside
attendee deployments avoids increasing the PWA download and cache footprint.

Builder project backups contain project state and imported source/branding
assets. Each binary gets a unique archive path, independent of its filename.
Restore stages and validates the complete ZIP and every referenced asset
before writing one autosave record, so missing, corrupt, or colliding archive
entries cannot replace the current project. Existing single-logo and flat
sponsor formats remain supported. Shared IndexedDB serialization preserves
typed-array bytes; old numeric-key byte objects are normalized during project
load.

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

## 12. Poster-session and attendee workflow completion (v1.1.3)

`posterSessionId` is required for every Poster and must resolve to a Session whose
type is `poster-session`. The model exposes `posterSessions` in chronological order
and retains `posterSession` as a compatibility alias for the first session. Each
poster projection carries its resolved parent. Attendee code never uses the alias
to infer a poster's date, room, gallery order, photo match or calendar membership.

Timestamp-based photo matching finds every active poster session at the capture
time, then offers only starred posters belonging to those sessions. When parallel
poster sessions overlap and no location metadata exists, all relevant active
sessions remain visible for attendee review instead of selecting a room silently.

The full-screen photo editor temporarily closes an open native details dialog and
restores it on exit. This avoids the browser's native modal-inertness boundary while
preserving the selected event/poster and the attendee's place.

The third independent fixture and browser suites establish conference-independent
coverage for multi-session posters, attendee-owned data, mobile layouts, Friend
Book/calendar workflows, package updates and a Builder-to-attendee deployment.

## 13. Install, live scanning and personal-data erasure (v1.1.4)

The install contract keeps manifest `id`, `start_url` and `scope` relative to the
repository root and uses `display: standalone`. `bootstrap.js` captures the
one-shot `beforeinstallprompt` event before conference-package initialization;
the attendee UI consumes it when available and otherwise presents platform-
specific manual instructions. `display-mode: standalone` and iOS
`navigator.standalone` are both recognized.

Live contact scanning owns a single camera lifecycle. The scanner prefers the
environment camera, decodes frames automatically, and releases its media tracks
on success, cancellation, navigation, visibility loss or page teardown. The
vendored scanner selects native `BarcodeDetector` support first and falls back to
its offline worker decoder. Parsed vCards are deduplicated by email, then ORCID,
then name plus affiliation; private annotations survive updates.

Attendee deletion is conference-scoped across the shared user database, the
conference-specific photo database and its preferences key. A multi-store
IndexedDB transaction clears state, profile, contacts and schema metadata for the
current conference only. The UI invalidates delayed work, cancels debounce timers
and awaits active writes before clearing photos and rendering empty state. It does
not touch canonical conference packages, engine caches or another conference's
records.

## 14. Friend Book profile editing (v1.1.5)

The Friend Book My Card summary and expandable editor use the existing profile
object and `userStore.getProfile`/`saveProfile` contract. A temporary in-memory
draft holds form edits and selected profile photos until Save. Cancel reloads the
persisted profile into the editor and revokes the draft preview URL. QR generation,
vCard export and backup/restore continue to use the one saved profile object.

## 15. Pilot hardening (v1.2.0)

Backup import is explicitly replace-only for the selected conference's
attendee-owned record set. `src/backup.js` validates the envelope, version,
record shapes, contact URLs, image references and ZIP entry checksums before the
application begins a restore. Every referenced image must be present and have
recognized image data; invalid or incomplete archives are rejected without
mutating application stores. The app waits for outstanding attendee writes,
captures a rollback snapshot, replaces the conference photo database, then
replaces state/profile/contacts atomically in the shared user database. If the
second database commit or preference write fails, the first commit is rolled
back. Visible application state changes only after storage commits succeed.
Conference packages remain in their independent package store.

User-owned `Blob`/`File` values are stored in IndexedDB as typed byte arrays and
reconstructed as `Blob` values when read. This avoids WebKit's IndexedDB
File/Blob persistence failures while keeping the app-facing profile, photo,
backup, and Builder project contracts unchanged. Existing records containing
native Blob values remain readable; Builder source files retain their name,
type, and other metadata alongside the encoded bytes.

`src/safe-url.js` defines the shared external-link policy. User and package URLs
are restricted to HTTPS (plus `mailto:` for validated email links); ORCID IDs
and DOI references have dedicated parsing and normalization. Relative package
asset paths are accepted only in asset fields and cannot traverse directories.
Package validation is used by attendee package loading and Builder output;
vCard parsing applies the same checks before contact persistence. Renderers also
normalize links before assigning them to `href` attributes.

QR and photo viewers are native modal `<dialog>` elements. Browser modal focus
containment and Escape behavior are retained, opening focus is deliberate, and
closing returns focus to the initiating control. CI runs Playwright projects for
Chromium, Firefox and WebKit and installs each engine's runner dependencies.
Engine updates still avoid `skipWaiting`; a waiting worker activates only after
the previous in-scope clients close and does not clear attendee data stores.

## 16. Builder trust and release tracking (v1.2.1)

Builder exports load the shared schema files and run schema and semantic checks
before a ZIP can be downloaded. The generated repository runs the same schema
and semantic validator. Incomplete PDF text is kept as a draft row; titles,
poster session dates, and poster times are never synthesized from conference
defaults. Contradictory session grouping fields block export until corrected.

Spreadsheet row addresses remain provenance, not identity. A row is reconciled
only by a unique content match within the same source file and worksheet, or by
an explicit structured entity ID. Ambiguous or duplicated IDs remain conflicts;
organizer edits and calendar identity survive confirmed matches. Person identity
uses explicit IDs or exact affiliation evidence; unresolved name-only rows stay
distinct and can be assigned a person ID in the review table.

ZIP creation updates the local export record only. Organizers confirm deployment
separately, which records a content fingerprint for that data version and adds
the release to the changelog. Re-exporting identical published content is
allowed; changing it requires a higher version. The shared semantic validator
update ships with engine v1.2.1; no conference-specific programme data changed.

## 17. Builder identity, diagnostics, and live preview (v1.2.3)

The Builder persists `identityRegistry.personRecords` by immutable person ID. Each record tracks known normalized names and affiliations; the older `identityRegistry.people` lookup remains readable for existing projects. Explicit spreadsheet person IDs take priority. Exact name plus affiliation matches are reused only when unique. A name-only appearance may reuse one reliably identified profile, while unresolved same-name appearances remain separate until organizer review. Confirmed profile merges move the registry record and all programme references to the surviving ID.

Semantic validation remains in `src/validation.js`. The Builder's diagnostic presenter adds session or presentation titles, date/time, room and track, and a link to the appropriate review editor. A parent venue is a grouping location, not an exclusive room; concurrent events in different rooms of the same venue do not produce room-conflict warnings. Distinct poster themes sharing the exact same exhibition window can coexist in one hall. Other same-room overlaps, including partially overlapping poster sessions, remain warnings.

Step 8 loads `index.html` in a same-origin iframe with the current Builder package sent through a checked `postMessage` handshake. This uses the attendee runtime and styles instead of a copied schedule renderer. Each iframe generation gets a random, separate personal-storage conference ID and does not register a service worker. Local image assets are exposed through temporary object URLs. The generated ZIP retains the real conference ID and packaged asset paths. Entering Step 8 builds the current project; automatic updates follow settings, programme, feature and branding changes. **Refresh preview** and **Validate** force a new iframe generation even when the content fingerprint is unchanged. Loading, Up to date and Failed describe iframe readiness independently of publication validation. Date, room and viewport selections survive refresh. The Builder waits for active asset reads, ignores superseded package renders and checks iframe generation before reporting readiness, so rapid edits cannot install a stale preview. Refresh neither downloads a ZIP nor changes publication versions. Step 6 also shows a small immediate color and typography sample.

## 18. Branding and offline typography (v1.2.3)

Builder projects retain legacy darkMode, typography, headerStyle, logo, and single-file sponsor records. On load, old darkMode true maps to the dark attendee default and false maps to follow-device. A legacy logo remains the fallback for both theme variants. New branding stores defaultAppearance, independent previewAppearance, logoLight/logoDark, separate heading/body font IDs, theme-specific header backgrounds, logo alignment and size, and ordered sponsor records. Preview appearance is not serialized into conference branding.json.

The attendee runtime resolves defaultAppearance before the deprecated boolean and applies theme logo/background variants whenever the actual theme changes. sponsorLogos carries each variant and display height; sponsorAssets remains for older readers. The Builder preview and deployment ZIP use the same branding package and paths. The generated ZIP and GitHub Pages artifact include 1.4 MB of local WOFF2 Unicode subsets, the font stylesheet, and six OFL notices. The service worker precaches these assets so every curated choice remains available offline. Contrast checks warn when a brand color is weak for white text; primary buttons choose black or white foregrounds automatically.

## 19. Project backup and startup safety (v1.2.5)

Builder project archives are fully parsed and checked before replacement. Restore runs a disposable package build; structural/schema failures are rejected, while semantic draft warnings do not block restoring incomplete organizer work. Confirmed replacement first saves the current in-memory project, then uses the project's one-record IndexedDB transaction for the incoming state. Project data and its byte-backed assets are encoded together.

Programme import parsing is isolated from the live project. CSV/XLSX/row-JSON data remains a mapping preview until applied; structured conference JSON and PDF extraction build a cloned next state. Source files, programme rows, identities, and metadata are persisted together in one project record after structural checks (structured conference JSON also passes full package schema and semantic validation). XLSX worksheet requests carry a generation token so stale parses cannot commit.

Release package history is capped at five validated records per conference base, including the active release. Older release records are pruned in the same IndexedDB transaction that stores the new release and updates metadata. Rollback pins a retained release and blocks activation until updates are explicitly resumed. Attendee-owned records are stored separately and are unaffected.

The shared JSON Schema validator implements the repository's used subset: type unions, enum, required, properties, additionalProperties, minimum/maximum, minLength, pattern, minItems/maxItems, and items. It is intentionally not described as full Draft 2020-12 support.

## 20. Import source and identity review (v1.2.6)

Programme import remains staged in memory until the organizer confirms the comparison and one atomic project-record save succeeds. The import mode is explicit: merge, replace the selected source, or replace the programme. Source records retain contributing-source IDs and source positions; the Step 2 manager shows per-source counts and status and removal previews whether rows are shared or manually edited. Cross-file reconciliation uses normalized title plus schedule and contextual corroboration; an uncertain match is presented for organizer resolution, and a matching time/location alone is never sufficient.

Step 4 identity review persists decisions for identity pairs. `same` invokes the existing reference-safe merge path, `different` is retained as evidence that same-name profiles are separate, and `unresolved` leaves the ambiguity visible. Bulk operations are applied to a cloned project and saved once; a collision or invalid operation leaves the current project untouched. The review cards use programme, profile, and source context rather than asking organizers to reason from IDs. Earlier Step 3 assignments and current identity registry data continue to load.

PDF extraction produces an in-memory review object, not programme rows. Native text is grouped by page and probable columns; OCR is attempted only when native text is sparse or lacks useful schedule anchors. Time-anchored rows are separated by confidence, and unrecognized lines remain text until explicitly converted. Extraction is still rule-based; PDFs with unusual reading order, complex merged cells, or weak scans can need substantial correction. OCR/PDF.js and spreadsheet parsing remain lazy CDN dependencies, so these Builder imports may need network access unless cached. No arbitrary-layout accuracy claim is made.

Project archive validation is completed before the Builder drains pending
autosaves or swaps the current project. The restore writes the complete staged
project in one IndexedDB record, then reloads the interface. Any parsing,
integrity, missing-asset, or validation failure leaves the currently stored
project as-is. Shared binary storage uses explicit byte markers and keeps
ArrayBuffer/view contents intact across Builder reloads; legacy numeric-key
objects are converted to byte arrays on project load.

Bootstrap startup diagnostics use DOM elements and `textContent`, never HTML
interpolation. The first error line is bounded, and only the conference path
without query/fragment parameters is displayed.

## 21. Source removal and compact schedule control (v1.2.7)

Source removal is computed against a cloned Builder project with the normal
package builder. The organizer chooses whether exclusive source-backed rows,
including corrected rows, are removed, or whether corrected rows become
source-free manually maintained records. Rows with another contributing source
lose only the removed contributor. The impact counts come from comparing the
derived packages before and after the staged operation, including people,
sessions and posters. The project structure is checked and the staged project
is persisted as one IndexedDB record before becoming live in the Builder.
Unused source state, references, and identity metadata are pruned while stable
IDs and calendar UIDs on retained rows remain unchanged.

The compact schedule switch uses a flex track and start/end alignment for its
thumb. It has no fixed travel transform, so the thumb position derives from the
switch's actual inner width and padding.

## 22. Historical programme provenance and clearing imported data (v1.2.8)

`src/builder/source-provenance.js` resolves current references (`fileId`,
`contributors`, `sources`, and `sourceRecords`), legacy source-ID prefixes,
aliases kept in source/import metadata, and uniquely matching journal records
using mapped programme fields. Content-based recovery is accepted only when
the match is strong and unique; conflicting or absent evidence remains
uncertain. Resolution is idempotent and only writes recovered provenance into
a staged operation.

Step 2 retains the two per-source removal policies and adds **Clear imported
programme data** for damaged or obsolete source registries. The clear preview
shows derived people, sessions/posters, locations and tracks affected. Every
row with uncertain origin requires an explicit keep-as-manual or delete choice;
newly created rows are marked as organizer-created. Source removal and clear
are staged against a cloned project, checked structurally, written in one
IndexedDB transaction, read back, and rebuilt. Row/source references and a
content fingerprint are compared with the reviewed plan. A mismatch restores
the prior project before an error is shown. A loaded empty package is a valid
Step 8 preview state and reports ready instead of remaining in Loading.

The v1.2.7 failure was primarily data-level: old rows with missing
`row.source` links remained in the persisted `rows` collection, so normal
package generation correctly kept rendering them and their people. It was not
an IndexedDB cache that could be fixed by refreshing the preview. Clearing the
last imported programme also exposed a runtime status-card assumption that at
least one date exists; the attendee runtime now renders an explicit empty
programme state instead of failing startup. Historical source journals stored
as either arrays or keyed objects are normalized before recovery and removal.

## 23. Organizer-confirmed multi-profile identity merges (v1.2.9)

Step 4's duplicate review is built from `identityReviewGroups()`, which combines candidate profiles, programme appearances, source references and each saved pairwise identity decision. Each profile is an independent checkbox. UI selection order is stored per duplicate group, so the first checked profile is the canonical ID; deselecting it promotes the next selected ID without relying on display order. Groups may be merged independently, and rerendering the panel preserves each selection order.

`mergePersonProfilesMany()` applies a whole selection to a cloned project. It rejects stale IDs, duplicate selections, confirmed-different pairs and conflicting outside decisions before the result is exposed. A valid merge remaps every role/reference array, aliases and registry records; combines affiliations, papers and links; keeps the first selected profile's stable ID; stores alternate photos; and removes duplicate profile records. The Builder validates and package-builds this candidate, saves it as one IndexedDB project update, reads it back, and verifies removed identities and references are absent before updating the live interface. A failed save or verification restores the prior project. A merge preview lets organizers choose among conflicting single-value fields; the primary's value is preferred otherwise. Explicit different-person decisions remain separate from merge selection and must be reopened before a conflicting merge.

## 24. Separate profile decisions from programme assignments (v1.2.10)

`identityDecisions.pairs` describes the relationship between canonical profiles. Step 4 uses these pair decisions to clear only profile-level duplicate warnings. Each programme appearance has independent `personIdentityAssignments[role][index]` state (`automatic` or organizer `confirmed`), and `personIdentityIssues` is recomputed from the current canonical registry on every package build. A `different` pair does not assign an unaffiliated speaker, chair, or poster author to either profile; that issue remains a blocking, contextual validation error until an organizer selects the right profile in Step 3. The error carries the stable Builder row ID and role/index so navigation focuses the correct control even when source row numbers differ from current array positions.

Confirmed Step 3 assignments are carried through re-import only when the same normalized name remains in the same role slot. Explicit IDs in the new import take precedence. Old project IDs backed by saved profile metadata, legacy resolved-name markers, or existing structured package identities are migrated conservatively; a bare generated/provisional UUID is not confirmation. Unresolved assignments are omitted from generated people and programme references, preventing fake attendee profiles, and their blocking error prevents deployment export. IndexedDB writes are read back and package-rebuilt before the UI confirms an identity decision or assignment.
