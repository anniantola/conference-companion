# Conference Companion test results

## v1.2.11 targeted data integrity checks — 2026-10-29

Regression coverage now checks automatic identity status across repeated package builds, name edits and reordered appearances, reimport identity reconciliation, keyed legacy source journals, and HTML-like attendee timezone labels. The full Node 22 unit suite passed locally. The complete local Playwright run passed 142 tests: 71 Chromium and 71 Firefox. WebKit requires the CI runner's browser system dependencies on this host.

## v1.2.10 identity synchronization update — 2026-10-29

Added identity regressions for explicit imported person IDs, separate same-name profiles, independent speaker and chair assignments, stable row-targeted diagnostics at source rows 42/43/44/81/82/83 in a 100-entry programme, repeated package builds, re-import, and project ZIP backup/restore. The Chromium Builder workflow persists **Different people**, simulates a failed IndexedDB write without changing saved decisions, reloads the project, navigates from the contextual validation error to the exact Step 3 assignment control, and verifies the error is gone after assignment while a separate chair issue remains.

Unresolved appearance identities now block export and are not emitted as synthetic profiles. Confirmation persistence now validates the nested assignment shape during backup restoration.

The complete Node 22 `test:unit` suite passed after the v1.2.10 changes, including schema/semantic checks, all Builder suites, synthetic 91-record/18-poster coverage, backup restore, source removal, generated deployment validation, and branding. The full local Playwright run passed all 140 Chromium/Firefox cases (70 each); the final focused identity, failed-write, and project ZIP round-trip rerun passed 8/8 across those two browsers. The configured 70 WebKit cases could not launch locally: Playwright MiniBrowser exits before application code because this host lacks `libavif.so.16`. This is an environment dependency limitation; the deployment workflow installs WebKit system dependencies and remains the WebKit verification gate.

The CI failure-injection regression now waits for the existing autosave to finish before aborting the next IndexedDB write, ensuring the simulated failure targets the identity-decision transaction. The source-removal/backup restore flow now waits for the reset reload before selecting the backup and verifies both the restored IndexedDB record and rendered programme. Builder startup gates editing until the saved project, initial package and handlers are ready; the source-replacement regression confirms the readiness signal before editing.

The new identity tests cover first-selected primary order,
four-profile merge and primary promotion, consolidated affiliations/papers,
programme-reference remapping, preservation of alternate photos, explicitly
different identities, and browser persistence/backup behavior.

## v1.2.9 results

`npm exec --package=node@22 -- npm run test:unit` passed all schema, semantic,
attendee, Builder, import, identity, backup, source-removal, deployment ZIP,
and branding checks after the v1.2.9 changes.

The configured Playwright run attempted 207 browser cases. A Chromium backup
restore assertion raced the intentional page reload, and a Firefox test read
an identity ID before it was available in that fixture; both tests were fixed
to await navigation/use rendered profile IDs, then the affected cases passed
in both browsers. The other identity flows also passed in focused Chromium and
Firefox runs. WebKit could not launch locally because this host lacks
`libavif.so.16`; its 69 cases failed before application code ran. The workflow
installs WebKit with system dependencies, so CI remains the complete WebKit
verification gate.

### v1.2.9 final regression rerun — 2026-10-29

The complete Node 22 `test:unit` suite passed again. All 138 locally runnable
Playwright cases passed on the final test changes: Chromium 69/69 and Firefox
69/69. The duplicate-group selection test passed five consecutive Chromium
runs and three Firefox runs; source-replacement persistence passed three
consecutive Firefox runs. The simulated failed-write test now arms its IndexedDB
abort on the merge confirmation action, so an unrelated autosave cannot consume
the injected failure. The source-replacement fixture waits until the conference
name is present in IndexedDB before continuing, preventing a navigation/save
race in Firefox.

WebKit remains unavailable on this local host because Playwright MiniBrowser
cannot load `libavif.so.16`; this is a browser-launch dependency failure before
test code, not a test assertion. GitHub Actions installs browser dependencies
and is the required WebKit and deployment verification gate.

## Previous release results

The v1.2.8 run results are retained in git history for audit; current release
test counts and deployment status are appended after release verification.

The complete Node 22 `npm run test:unit` gate passed on the final provenance,
cleanup, and empty-programme runtime changes. This includes schema and semantic
validation, the 91-row/18-poster regression, Builder identity/import tests,
legacy source-journal recovery, source-removal transactions, project backup,
and generated deployment ZIP validation.

The complete configured browser run executed 201 tests: Chromium passed 67/67
and Firefox passed 67/67. WebKit's 67 cases could not start because the local
host lacks `libavif.so.16`; Playwright MiniBrowser exited before application
code ran. The focused source-cleanup cases passed in Chromium and Firefox,
including persisted IndexedDB checks, reload, Step 3/4/8 DOM verification, and
Builder ZIP backup/restore. The deployment workflow installs WebKit system
dependencies and remains the three-engine verification gate.

The confirmed deletion defect was stale programme rows in Builder project data,
not a cached preview: missing historical provenance prevented row removal, and
package generation then kept publishing those rows and their generated people.
Clearing the final imported programme also exposed an empty-date assumption in
the attendee status card; empty schedules now start and preview normally.

Physical-device verification of camera/device state, PWA installation, and
mobile screen readers remains outside this browser test run.

# Reliability update v1.2.5 — 2026-10-28

The complete Node 22 unit gate passed, including all schemas and package fixtures, legacy project migration, asset-byte ZIP round trips, incomplete-draft backup restoration, malformed backup rejection, the 91-row/18-poster CSV case, deployment ZIP validation, and URL/security regressions.

All 104 Playwright tests passed across Chromium and Firefox (52 per browser), including transactional backup restore, cancellation, simulated IndexedDB write failures, failed programme parsing/import writes, bounded release retention, rollback reload/offline behavior, and attendee-data preservation.

WebKit could not launch in this environment. A focused launch attempt fails before test code because Playwright MiniBrowser cannot load the host shared library `libavif.so.16`; no package was installed system-wide. The repository GitHub Actions workflow installs Playwright system dependencies and runs the complete three-browser suite; its run result is recorded in the release report.

The Builder's SheetJS, PDF.js and Tesseract.js paths remain lazy public-CDN imports. XLSX/PDF/OCR Builder imports need connectivity unless dependencies are cached; the attendee runtime does not load them.

# Conference Companion v1.2.6 verification — 2026-10-28

The complete Node 22 `test:unit` gate passed: schema and semantic validation for all shipped fixtures; core, static, release, importer, Builder trust/identity, synthetic 91-row/18-poster, transactional project backup, deployment ZIP, and branding regressions.

The complete configured Playwright run executed 174 tests: all 58 Chromium tests and all 58 Firefox tests passed. Every WebKit test failed before application code because Playwright MiniBrowser could not load the host library `libavif.so.16`. After that run, the complete Builder end-to-end file was rerun with the two final import regressions (CSV→overlapping-XLSX and explicit keep-separate resolution): all 18 cases passed across Chromium and Firefox. Counting the two added cases, 60 test cases per Chromium and Firefox are verified. WebKit could not launch any of its 60 cases; this is an environment dependency failure, not an application assertion failure. The repository CI workflow installs browser dependencies and remains the full WebKit verification gate.

New browser workflows cover persistent same/different identity decisions with programme/source context; multi-source preview, correction retention, safe removal and replacement; staged PDF extraction review with unrecognized text kept out of the programme; and CSV followed by overlapping XLSX reconciliation without duplicate rows. Compact toggle geometry is checked in attendee and Step 8 preview at narrow through desktop widths.

PDF coverage uses representative synthetic page/column text and a browser PDF.js test double. It validates staging, classification, corrections and confirmation behavior, but does not establish accuracy for arbitrary PDFs or the organizer's specific real-world programme. The SheetJS browser workflow is tested with a parser module double; actual workbook decoding remains dependent on the lazy CDN library.

---

# Conference Companion v1.2.7 verification — 2026-10-28

The full Node 22 `npm run test:unit` gate passed, including package schemas and semantic checks, existing project and import regressions, the 91-row/18-poster fixture, multiple poster sessions, deployment ZIP validation, and the new source-removal transaction tests.

The complete Playwright suite passed in Chromium and Firefox: 126 tests total (63 per browser). New browser coverage verifies the source-removal impact dialog and cancellation, deletion of the final imported programme while preserving independent manual rows/people/locations, removed programme disappearance in the rendered Review/People/attendee preview views, corrected-row preservation and explicit reimport matching, XLSX removal while retaining a CSV-shared entry, backup/reload persistence, failed IndexedDB transaction recovery, and compact-toggle alignment at 320, 375, 430, 768, and 1100 px in standalone and Step 8 preview in light and dark themes.

Local WebKit could not launch its first browser process because this host lacks `libavif.so.16`; the failures occur before application code executes. The complete WebKit suite remains covered by the GitHub Actions deployment workflow, which installs Playwright browser dependencies. This is a local runner limitation rather than an application assertion result; confirm the Actions run before release completion.

---

# Builder trust and v1.2.1 verification — 2026-10-26

The complete Node 22 unit/schema/importer/Builder/deployment suite passed after
the Builder trust changes. Generated deployment ZIPs for the default, no-poster,
and multiple-poster fixtures passed both repository validators. Chromium and
Firefox completed all 50 Playwright tests after updating the cache-name checks
to derive the current service-worker cache key; the added Builder identity
resolution workflow passed in both browsers.

The local all-project Playwright attempt exposed the host's missing WebKit
dependency (`libavif16`); Playwright cannot launch WebKit here. Installing the
system dependency was unavailable because this account has no sudo password.
This is a host limitation, not a WebKit assertion failure. The GitHub Actions
workflow installs the browser dependencies and its full three-browser result is
the final WebKit verification.

Engine and generated package metadata are v1.2.1 because shared semantic
validation changed. The Builder-only code does not include any conference-
specific content. See the successful deployment Actions run after the push for
the final 75-test Chromium/Firefox/WebKit result.

---

# Production pilot hardening verification — 2026-10-26, engine v1.2.0

All Node.js 22.23.4 unit, schema, conference validation, static/accessibility,
release, importer, Builder regression, conference-independent validation, and
generated deployment ZIP checks passed. The complete browser command ran all
three configured projects: Chromium and Firefox passed **48/48** tests. The
five-run Firefox backup-failure recovery regression also passed **5/5**.

GitHub Actions run [40305099093](https://github.com/anniantola/conference-companion/actions/runs/40305099093)
then passed the complete `npm test` gate, including **72/72 Playwright tests**
across Chromium, Firefox, and WebKit, and deployed the Pages artifact from
commit `bc50291`. The deployed `bootstrap.js` reports engine v1.2.0.

WebKit's 24 tests could not launch in this local environment because the host is
missing WebKit runtime libraries. The GitHub Actions deployment workflow installs
Chromium, Firefox, WebKit, and their system dependencies. No local WebKit pass is
claimed. The workflow pins Ubuntu 24.04 because `ubuntu-latest` had migrated to
Ubuntu 26.04 and its Playwright dependency-install step stalled there.

Coverage includes strict external URL validation in conference packages and
vCards/QR contact import, malformed and missing-photo backup rejection, rollback
and post-reload personal-data preservation, accessible named dialogs and keyboard
focus handling, offline navigation and persistence in Chromium/Firefox, and
waiting service-worker engine activation without interrupting active clients.
Backup imports replace all personal data for the target conference after
validation and confirmation; failed imports preserve current data.

`git diff --check` passed. Physical camera selection/permissions, platform PWA
installation, mobile screen readers, and real iOS Safari remain device checks.

---

# Friend Book My Card verification — 2026-10-23, engine v1.1.5

The complete `npm test` gate passed with Node.js 22.23.4 and Playwright Chromium.
All schema, semantic validation, core, static, release, importer, Builder
regression, and generated deployment ZIP checks passed. Playwright completed
**22/22 tests**, with no skips.

The profile regression cancelled unsaved text and photo changes without altering
storage, saved every existing profile field and photo, verified the summary after
reload, exported the complete profile in the personal backup, changed the profile,
and restored all fields and the photo from that backup. Existing vCard, QR,
Friend Book, and 320/375/768 px mobile checks passed after moving the editor.

`git diff --check` and JavaScript syntax checks passed. Physical mobile interaction
and screen-reader checks remain outside Chromium automation.

---

# Mobile usability and privacy verification — 2026-10-23, engine v1.1.4

Ran the complete `npm test` gate with Node.js 22.23.4 and Playwright Chromium.
All schema, validation, core, static, release, importer, six Builder regression,
deployment ZIP, and browser checks passed. Playwright completed **21/21 tests**
with no skips; this includes mobile layouts at 320, 375 and 768 px.

The new regressions validate PWA manifest scope and icon dimensions, early native
install-prompt handling, iOS instructions and standalone detection; decode a QR
offline using the vendored fallback; exercise scanner camera selection, automatic
import, de-duplication, cancellation, permission errors and inactivity cleanup;
test alphabetical expandable contacts; measure compact schedule card heights and
persistence; and verify data deletion cancellation, pending-save handling,
reload behavior, and isolation from another conference.

Physical iOS/Android installation surfaces, real camera permissions/camera choice,
and cross-browser native scanner behavior still require device checks.

---

# Attendee completion verification — 2026-10-23, engine v1.1.3

Executed the complete `npm test` suite with the required Node.js 22.23.4
runtime and Playwright Chromium on Linux. All schema, semantic validation,
core, static/deployment, release, importer, Builder regression and generated
deployment checks passed. Playwright completed **12/12 tests** with no skips.

New browser coverage verifies multiple poster sessions; session-specific photo
suggestions and calendars; notes, photos, favorites, complete backup/restore,
profile/vCard and private Friend Book data; attendee layouts and touch paths at
320, 375, 768 and 1280 pixels; package-update photo preservation; and a complete
synthetic Builder import-to-deployed-attendee workflow.

The system Node.js 18.19.1 runtime stopped at the generated-deployment test
because it does not provide the required global Web Crypto API. The project and
GitHub Actions specify Node 22 or later, so verification was rerun in that
supported runtime and passed. `git diff --check` also passed.

Limits: automated acceptance uses Chromium rather than Safari/Firefox or
physical devices. Camera EXIF capture, OS share sheets/calendar clients,
installed-PWA behavior, camera QR scanning and screen-reader behavior remain
manual interoperability checks. PDF heuristics still require organizer review.

---

# Engine-update test synchronization follow-up — 2026-10-23

- Reviewed failed Actions run 39914234056 for c132ee1. The clean-launch navigation
  remained pending until the 45-second test deadline; teardown reported ERR_ABORTED.
- Original test: 30/30 local repetitions passed, so the CI-specific hang was not
  reproduced locally. Inspection found that closing a page was incorrectly used
  as an activation-completion barrier.
- Corrected test: **30/30 consecutive repetitions passed** using
  `npm exec --package=node@22 -c 'playwright test -g "engine update waits" --repeat-each=30'`.
- Complete `npm test`: all Node checks and **5/5 Chromium tests passed**.
- `git diff --check`: passed. Timeouts/retries and production worker code unchanged.
- Added checks for the editing client's original controller, installed/waiting
  replacement, completed activation before navigation, clean-launch Builder UI,
  new-page controller and removal of the previous engine cache.

The test now observes the replacement worker without creating a scoped document
client during activation. This fixes the synchronization gap; the exact Chromium
internal cause of the original CI hang cannot be proven from its logs alone.
Remote deployment results are reported after pushing the tested commit.

---

# Validation results — 2026-10-23, engine v1.1.2

Executed the complete `npm test` suite with Node v22.23.4 and Playwright 1.64.1
Chromium on Linux. System Node 18 was insufficient; Node 22 was supplied through
`npm exec --package=node@22 -c 'npm test'`, matching the CI major version.
Chromium downloaded and launched successfully in this session.

| Check | Result |
| --- | --- |
| JSON Schemas, default and independent conference | Passed |
| Semantic/referential validation, both conferences | Passed |
| Core model, calendar, vCard/QR, backup and Builder identity/cascade tests | Passed |
| Static/accessibility smoke checks and Pages public artifact staging | Passed |
| Release integrity and cross-conference checks | Passed |
| Importers including PDF columns, wrapped titles, posters and ambiguous assignments | Passed |
| Existing six Builder bug regression groups | Passed unchanged |
| New reciprocal membership, poster parent and location hierarchy regressions | Passed |
| Generated deployment ZIP extraction and validators, both conferences | Passed |
| Playwright navigation/preferences/offline notes/favorites, both conferences | Passed (2 tests) |
| Playwright Builder import/mapping/bulk edit/autosave | Passed |
| Playwright package activation/recovery/rollback and user data preservation | Passed |
| Playwright waiting engine update and cached script coherence | Passed |

Final result: all Node suites and **5/5 Chromium browser tests passed**, with no
skipped tests. `git diff --check` also passed. During development browser testing
exposed and verified a fix for note persistence delayed by navigation/preferences.

Limits: no Safari/Firefox/physical-device acceptance, live GitHub Actions/Pages
deployment, arbitrary organizer PDF corpus, CDN parsing/OCR integration, external
calendar-client imports or camera hardware testing was performed. PDF layout
regressions use deterministic PDF.js-shaped text items and extracted text. PDF
rows remain provisional and require organizer review. No official programme data
was supplied or invented.

---

## Historical results from the previous development snapshot

# Builder bug-fix verification — 2026-10-22

## Automated checks: PASS

The full `npm test` pipeline completed successfully with Node.js 22.16.0:

1. Schema checks for the default and independent conference fixture.
2. Referential/data validation for both packages.
3. Core model, immutable identity, calendar/ICS, backup and session-cascade tests.
4. Static/accessibility smoke tests.
5. Release contract tests.
6. Existing PDF/CSV importer tests.
7. **NEW** `tools/test-bugfixes.mjs` — all six defect groups passed.

Additional verification: all JavaScript sources pass `node --check`; a Builder-generated
repository deployment ZIP was created and validated, including a venue with missing
coordinates, complete deployment assets, and GitHub Pages workflow.

## Six regression groups

- Preserve separate imports, re-import updates, organizer edits, event identities,
  independent workbook sheets, and explicit row deletions.
- Separate repeated session titles by time, room and track; preserve contiguous
  talks, repair legacy accidentally merged sessions and honor canonical imported
  session IDs. Untimed posters sharing a session remain grouped.
- Parse PDF rows when a European or ISO date appears on the same line as times.
- Omit blank lat/lon, retain true zeros, reject out-of-range coordinates.
- Detect semicolon-delimited CSV even when quoted headers contain commas or line breaks.
- Reject invalid dates including February 30 and non-leap February 29; accept leap years.

## Browser limitation

The environment denied Chromium navigation to both `http://localhost` and local
`file://` addresses (`net::ERR_BLOCKED_BY_ADMINISTRATOR`). Automated tests above
were actually executed; no browser-level interaction result is claimed.
Run installation, import and offline testing on the deployed GitHub Pages site.
