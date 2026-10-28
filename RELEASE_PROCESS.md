# Release protocol (static GitHub Pages pilot)

1. Export a new package from the Builder (do not manually edit immutable entity IDs or calendar UIDs).
2. Keep Builder project backup ZIP privately; do not publish it with attendee data.
3. Commit the generated deployment into that conference's dedicated repository.
4. Confirm GitHub Actions validation passes and deployed PWA opens online and offline.
5. Create a Git tag/release for the exact published package (`data-vN`).
6. A **new published rollback release** is a new publish, never a copied older `conference-manifest.json`: restore the last-good content into the Builder, set `dataVersion` to a number greater than every previously published release, update `publishedAt`, checksums and changelog, and publish/tag again. Preserve existing `calendarUid` for existing events; increase their `SEQUENCE` when calendar-visible fields change. Separately, an attendee can select a previous validated local package in Settings. That pins the cached release and pauses automatic conference updates across reloads until **Resume automatic updates** is chosen; it does not publish or change a conference data version.
7. Never delete attendees' local data; use stable IDs.

The Builder currently provides a downloadable repository ZIP, **not** authenticated GitHub commit/tag automation. Users must execute steps 3–5 in GitHub. The static pilot does not provide organizer accounts, cloud APIs, hosted vCards or push.

## Acceptance required before NEURONICS production

- Import actual official NEURONICS data and validate times, rooms, authors and posters.
- Run the second independent fixture in `fixtures/multi-track-no-posters` (America/New_York, 4 tracks, multiple venues, no posters).
- Perform manual device/browser tests for install, offline reload, note editing during an app update, re-import, photo capture, backup/restore and ICS imports in Google/Apple/Outlook.
- Confirm share-image previews on the final custom HTTPS domain (many crawlers prefer PNG/JPEG and absolute URLs).
- Check accessibility using keyboard and screen reader, and representative phone widths.
