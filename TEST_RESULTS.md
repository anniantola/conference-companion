# Production pilot hardening verification — 2026-10-26, engine v1.2.0

All Node.js 22.23.4 unit, schema, conference validation, static/accessibility,
release, importer, Builder regression, conference-independent validation, and
generated deployment ZIP checks passed. The complete browser command ran all
three configured projects: Chromium and Firefox passed **48/48** tests. The
five-run Firefox backup-failure recovery regression also passed **5/5**.

WebKit's 24 tests could not launch in this local environment because the host is
missing WebKit runtime libraries. The GitHub Actions deployment workflow installs
Chromium, Firefox, WebKit, and their system dependencies; its full result is
recorded after the push. No local WebKit pass is claimed.

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
