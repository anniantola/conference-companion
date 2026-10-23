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
