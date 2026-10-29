# Release protocol (static GitHub Pages pilot)

## v1.2.9 identity merge update

Step 4 duplicate review uses one checkbox per profile. Check profiles in the order you want them combined: the first checked profile is the surviving primary. To change it, uncheck the primary; the earliest still checked profile becomes primary. Review the merge preview and choose values for any conflicting single-value fields, then confirm. Each duplicate-name group keeps its own selection. **Mark selected as different people** records explicit pairwise distinctions; reopen a confirmed distinction before attempting to merge those two identities. The merge is staged and read-back verified before its success message appears. Export a Builder project backup after substantial identity cleanup.

## v1.2.8 source-provenance and cleanup update

In Step 2, source removal reconstructs old source links when possible and previews the resulting rows and derived package. If an imported programme still contains records that cannot be safely attributed, use **Clear imported programme data**. Review its row-by-row origin choices: choose **Delete as imported** only when the record is imported; choose **Keep as manually maintained** to preserve organizer content. Clearly marked imported rows are removed, manual rows stay, and unresolved rows block confirmation until each has a decision. After clearing/removing, confirm the source list is empty as expected and inspect Steps 3, 4, 5 and 8. The Builder verifies the saved project and rebuilt package before reporting success. Export a new Builder project backup after verifying the result.

## v1.2.7 source-removal and compact-control update

In Step 2, inspect the source manager's impact preview before removal. Choose **Remove source and associated programme data** to remove all entries exclusively supported by that file, including organizer corrections. Choose **Remove source but preserve manually edited entries** to keep corrected exclusive entries as independent, visibly labelled manual records; unchanged exclusive entries are deleted. Entries supported by other sources remain, with the removed source detached. Cancel leaves the project unchanged. After confirmation, check Steps 3–5 and Step 8, especially when removing the final source, and save/export a Builder project backup after the result is correct. The Compact Schedule switch aligns its thumb to the track edges using layout; check attendee behavior at narrow and desktop widths.

## v1.2.6 Builder usability release

Before accepting programme data, review the Step 2 source comparison and choose merge, replace-source, or replace-programme deliberately. Source removal and programme replacement show the affected records before the atomic commit. Use Step 4's contextual identity cards to record same-person or different-person decisions; unresolved groups remain visible. PDF rows are not committed during extraction: inspect confidence groups, correct fields, exclude noise, preview the resulting programme changes, then confirm. Parser heuristics cannot establish correctness for every PDF layout; validate against the actual organizer programme, especially parallel columns, author lines, and OCR results.

1. Export a new package from the Builder (do not manually edit immutable entity IDs or calendar UIDs).
2. Keep Builder project backup ZIP privately; do not publish it with attendee data.
3. Commit the generated deployment into that conference's dedicated repository.
4. Confirm GitHub Actions validation passes and deployed PWA opens online and offline.
5. Create a Git tag/release for the exact published package (`data-vN`).
6. A **new published rollback release** is a new publish, never a copied older `conference-manifest.json`: restore the last-good content into the Builder, set `dataVersion` to a number greater than every previously published release, update `publishedAt`, checksums and changelog, and publish/tag again. Preserve existing `calendarUid` for existing events; increase their `SEQUENCE` when calendar-visible fields change. Separately, an attendee can select a previous validated local package in Settings. That pins the cached release and pauses automatic conference updates across reloads until **Resume automatic updates** is chosen; it does not publish or change a conference data version.
7. Never delete attendees' local data; use stable IDs.

## v1.2.5 reliability notes

Project backup replacement and programme import are transactional. Validate a project archive and its staged trial package before confirming replacement. CSV/XLSX/row JSON are previews until mapped; structured JSON and PDF commit only after staged checks. If a write fails, the previous saved project remains authoritative. External SheetJS, PDF.js, and Tesseract dependencies remain lazy CDN imports; XLSX/PDF Builder imports therefore need connectivity unless the dependency is already cached. The attendee app itself remains offline-capable.

The package cache retains the active validated release and four recent validated releases. Rollback selection is persisted and pinned; automatic updates resume only when the attendee asks. This local engine release history is distinct from conference `dataVersion` and does not change the publication process.

The Builder currently provides a downloadable repository ZIP, **not** authenticated GitHub commit/tag automation. Users must execute steps 3–5 in GitHub. The static pilot does not provide organizer accounts, cloud APIs, hosted vCards or push.

## Acceptance required before NEURONICS production

- Import actual official NEURONICS data and validate times, rooms, authors and posters.
- Run the second independent fixture in `fixtures/multi-track-no-posters` (America/New_York, 4 tracks, multiple venues, no posters).
- Perform manual device/browser tests for install, offline reload, note editing during an app update, re-import, photo capture, backup/restore and ICS imports in Google/Apple/Outlook.
- Confirm share-image previews on the final custom HTTPS domain (many crawlers prefer PNG/JPEG and absolute URLs).
- Check accessibility using keyboard and screen reader, and representative phone widths.
# v1.2.5 reliability release

- Builder project ZIP imports validate project structure, referenced assets, and a disposable trial package before asking to replace the saved project. The current autosave is persisted first; IndexedDB's atomic project write leaves it intact if the incoming write fails. Structurally valid but incomplete drafts remain restorable.
- CSV/XLSX/row JSON remain mapping previews until Apply mapping. Structured JSON and PDF imports stage all changes in a clone, validate/build before committing, and atomically save source files with programme changes. Failed parser loads or saves preserve the prior project and source files.
- Conference package cache retains five validated releases (active plus four recent) and prunes older package records atomically with activation. Persistent rollback pins its selected release and is not affected by cleanup; personal attendee data lives in separate storage.
- Runtime and Node schema validation enforce the repository schema subset, including enum, type, required, properties, additionalProperties, minimum/maximum, minLength/pattern, minItems/maxItems, and items. This is not full Draft 2020-12 support.
- Package asset URLs use the same HTTPS/relative-path validator for legacy and light/dark logos, sponsor variants, and person photos. Blob URLs remain allowed only by the trusted Builder preview resolver.
