# web — the Pal Tools app

Svelte 5 + TypeScript + Vite. See the [repo README](../README.md) for what the
app does and where the data comes from.

```
npm install
npm run dev      # → http://localhost:5173
npm run build    # → dist/ (deployed to https://pal-tools.pages.dev on push to main)
npm run check    # svelte-check + tsc
```

- `src/lib/paltools.ts` — typed facade over the dependency-free save parser in
  the repo-root `src/` (imported for side effects; registers a `PalTools` global).
- `src/lib/breeding.ts` — breeding engine, validated against palcalc's 44,851-row
  pairing oracle by `tools/build-data.js`.
- `src/data/` — generated datasets (`breeding-data.json`, `markers.json`, …);
  regenerate with the `tools/` scripts, don't edit by hand.

Everything runs client-side; save files never leave the browser.
