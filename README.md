# Conference Companion

A standalone, offline-first Progressive Web App for scientific and professional conferences.

The application engine is generic. Conference-specific content lives in the `conference/`
data package, so a new event can be created without rewriting `app.js` or `styles.css`.

## Repository structure

```text
/
├── .github/workflows/deploy.yml
├── conference/
│   ├── conference-manifest.json
│   ├── conference.json
│   ├── programme.json
│   ├── people.json
│   ├── locations.json
│   ├── branding.json
│   └── assets/
├── fixtures/
│   └── multi-track-no-posters/
├── tools/
│   └── validate-conference.mjs
├── index.html
├── bootstrap.js
├── app.js
├── styles.css
├── service-worker.js
├── manifest.webmanifest
├── icon-180.png
├── icon-192.png
├── icon-512.png
└── package.json
```

## Development foundation

The app currently supports package-driven conference data, multiple days, parallel
tracks, hierarchical locations, favorites/My Schedule, notes, photos, Gallery,
search, offline PWA behavior and package validation.

The default `conference/` package is fictional development data. It can later be
replaced by a real conference package without changing the application engine.

The regression fixture is intentionally structurally different and is used to
verify that the engine does not depend on one particular programme shape.

## Run locally

```bash
python3 -m http.server 8080
```

Open:

```text
http://localhost:8080/
```

Regression fixture:

```text
http://localhost:8080/?conference=./fixtures/multi-track-no-posters
```

## Validate

```bash
npm run validate
npm run validate:fixture
npm run validate:all
```

## Deployment

The included GitHub Actions workflow deploys the repository to GitHub Pages.
Create a new empty repository, push these files to `main`, and select GitHub Actions
as the Pages source. A custom domain can be added later.

This repository is self-contained and does not depend on any other conference app,
repository, dataset or deployment.
