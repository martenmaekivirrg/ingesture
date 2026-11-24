# Ingesture

A small installable web app for capturing a thought (dictated or typed), a photo, or something shared from another Android app, and dropping it into the `inbox/` folder of a GitHub repository. In my setup that repository is an Obsidian vault, and a scheduled Claude run files each capture into notes.

- No framework, no build step: open `index.html` through any static server.
- Every capture is saved on the device first (IndexedDB) and uploaded with the GitHub *Create or update file contents* API, so nothing is lost offline.
- The GitHub token is a fine-grained token for one repository, typed in by the user and stored only in that browser.

```
npm test               # unit tests (Node 24)
npx playwright test    # browser tests
```

Personal project, shared as is.
