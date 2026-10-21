# Fresh GitHub repository setup

Create a completely new, empty GitHub repository for this project.

Recommended name:

```text
conference-companion
```

Then:

1. Extract the repository ZIP.
2. Upload or push the extracted contents to the repository root.
3. Commit to `main`.
4. Open **Settings → Pages**.
5. Set the Pages source to **GitHub Actions**.
6. Let `.github/workflows/deploy.yml` publish the site.

The repository is standalone and contains its own app engine, conference package,
validation tooling, PWA manifest, service worker, icons and deployment workflow.
