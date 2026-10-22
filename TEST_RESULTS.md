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
