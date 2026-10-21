# Repository setup

This repository is a standalone Conference Companion development repository.

## GitHub Pages

1. Push the repository contents to `main`.
2. Open **Settings → Pages**.
3. Select **GitHub Actions** as the Pages source.
4. The workflow runs `npm test` before deployment.
5. When the workflow is green, the attendee app is served from the repository Pages URL and the Builder is available at `/builder.html`.

## Creating a conference deployment

Use the Conference Builder and choose **Download repository-ready deployment ZIP**. The generated ZIP contains the stable attendee engine, a validated conference package, PWA identity assets, JSON Schema/semantic validators and a GitHub Pages workflow.

Upload the generated ZIP contents to a conference-specific repository root and enable GitHub Pages through GitHub Actions.
