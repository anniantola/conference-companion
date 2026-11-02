# Repository setup

This repository owns the attendee engine, Builder, validators, schemas and tests. Conference-specific repositories own only their package data, branding and GitHub Pages workflow.

## GitHub Pages

1. Push the repository contents to `main`.
2. Open **Settings → Pages**.
3. Select **GitHub Actions** as the Pages source.
4. The workflow runs `npm test` before deployment.
5. When the workflow is green, the attendee app is served from the repository Pages URL and the Builder is available at `/builder.html`.

## Creating a conference deployment

Use the Conference Builder and choose **Download repository-ready deployment ZIP**. The generated ZIP contains conference data, PWA identity assets and a GitHub Pages workflow. The workflow checks out this repository as the shared engine, validates the conference package and stages a static attendee site.

Upload the generated ZIP contents to a conference-specific repository root and enable GitHub Pages through GitHub Actions. The repositories retain separate histories and deployments. Keep this engine repository beside a conference repository for local `npm test` and `npm run stage`, or set `CONFERENCE_ENGINE_DIR`.
