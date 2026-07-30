# Pal Tools

[![Deploy](https://github.com/Stians92/pal-tools/actions/workflows/deploy.yml/badge.svg)](https://github.com/Stians92/pal-tools/actions/workflows/deploy.yml)

Palworld **palbox viewer + breeding calculator** web app.

**Live at [pal-tools.pages.dev](https://pal-tools.pages.dev)** — drop your save
folder on the page; everything is parsed in your browser and nothing is uploaded.

- Save-file parsing is 100% from scratch (no external parser): a hand-ported
  Oodle Kraken/Mermaid decompressor + GVAS parser in plain JS (`src/`).
- The website is TypeScript + Svelte (`web/`, Vite).
- Breeding data is the **1.0-rebalanced** dataset vendored from
  [tylercamp/palcalc](https://github.com/tylercamp/palcalc) (MIT, extracted
  from current game files). Pre-1.0 breeding tables give wrong offspring.
- Map data: relics/fast-travel/bosses — and per-species element types
  (`data/vendor/psp_pals.json`) — from
  [oMaN-Rod/palworld-save-pal](https://github.com/oMaN-Rod/palworld-save-pal)
  (MIT, GUID-keyed 1.0 level actors); chests/eggs/fruits/journals/materials/
  NPCs/supply/fishing courtesy of [paldb.cc](https://paldb.cc) map data
  (`tools/fetch-paldb.js` + `tools/build-paldb-markers.js`). All underlying
  game data © Pocketpair.

## Use

```
cd web
npm install
npm run dev      # → http://localhost:5173
```

Drop your save folder (`%LOCALAPPDATA%\Pal\Saved\SaveGames\<steamid>\<worldid>\`)
onto the page. Everything runs locally; nothing is uploaded.

- **Palbox tab** — all pals with level, gender, IVs, souls, passives, location
  (palbox/party/base), owner; search/filter/sort; JSON export.
- **Breeding tab** — pick a target species and wanted passives: shows every
  (male, female) pair you own that produces it, with the probability an egg
  directly inherits all wanted passives; if no direct pair exists, shows a
  multi-step breeding route from your owned species. Passive-carrier chain
  planner: shortest route that keeps a carrier of all wanted passives in every
  pair, with per-step inherit odds and expected egg counts.
- **Coverage tab** — every species in the dex, tiered by the minimum number of
  breeds needed to reach it from your box; click through to a species baseline
  card (stats, elements, partner gear, work suitability) and the planner.
- **Map tab** — world + Sakurajima maps with save-aware markers: collected
  relics, unlocked fast travel, defeated alphas/tower bosses, read journals,
  plus dungeons, predators, chests, eggs, NPCs and more.
- **Pal detail** — click any palbox row: IVs, souls, passives, species stat
  bars, and every mate pairing with what it produces (owned/new filters).

Dimensional Pal Storage (`*_dps.sav`) is parsed too — DPS pals feed the
breeding and coverage calculations automatically.

CLI: `node test/extract-pals.js <save-dir>` writes `pals.json`.

## Breeding engine correctness

`tools/build-data.js` derives a compact ruleset (CombiRanks + priorities, 110
formula-excluded species, 135 unique + 2 gender-specific combos) from palcalc's
fully materialized 44,851-row pairing table and **fails the build unless the
ruleset reproduces every row**. The TS engine (`web/src/lib/breeding.ts`) is
validated against the same oracle. Rules implemented: same-species; gendered
Katress/Wixen combos; unique combos (children unreachable via formula);
otherwise nearest CombiRank to `floor((a+b+1)/2)` with the 1.0
`CombiDuplicatePriority` tiebreaker. Passive inheritance: 40/30/20/10% for
exactly 1–4 passives from the parent pool (uniform over combinations).

After a game patch: re-download palcalc's `db.json`/`breeding.json` into
`data/vendor/` and re-run `node tools/build-data.js`.

## Layout

- `src/` — dependency-free save parsing (oodle.js is GPL-3.0, a port of
  [ooz](https://github.com/powzix/ooz); the rest is original).
- `web/` — Svelte app. `src/lib/paltools.ts` (typed parser facade),
  `src/lib/breeding.ts` (engine), `src/data/breeding-data.json` (generated).
- `tools/build-data.js` — dataset builder + oracle validation.
- `data/vendor/` — vendored palcalc extracts (MIT).
- `docs/` — format spec + original feature research.
- `test/` — Node tests for the parser, browser smoke test, static server.
- `index.html` (repo root) — the original no-build vanilla JS viewer; still
  works, superseded by `web/`.

## Deployment

Pushes to `main` build and deploy to [Cloudflare Pages](https://pal-tools.pages.dev)
via GitHub Actions (`.github/workflows/deploy.yml`); pull requests get preview
deployments on branch URLs.

## Acknowledgements

- [deafdudecomputers/PalworldSaveTools](https://github.com/deafdudecomputers/PalworldSaveTools) —
  the project that inspired this one; its feature set defined the scope
  (see `docs/feature-scope.md`). No code was reused, but the idea was.
- [cheahjs/palworld-save-tools](https://github.com/cheahjs/palworld-save-tools) —
  the GVAS/Palworld save-format knowledge distilled into `docs/gvas-spec.md`
  that made a from-scratch parser feasible.
- [powzix/ooz](https://github.com/powzix/ooz) — the open-source Oodle
  reimplementation `src/oodle.js` is ported from.
- [tylercamp/palcalc](https://github.com/tylercamp/palcalc),
  [oMaN-Rod/palworld-save-pal](https://github.com/oMaN-Rod/palworld-save-pal),
  and [paldb.cc](https://paldb.cc) — vendored game data (see above).

## License

[GPL-3.0](LICENSE). `src/oodle.js` is a derivative of
[powzix/ooz](https://github.com/powzix/ooz) (GPL-3.0), which makes the combined
work GPL; the rest of the original code here is released under the same terms.
Vendored data in `data/vendor/` keeps its upstream licenses (MIT) — see
attributions above. Palworld and all game data © Pocketpair, Inc.; this project
is unaffiliated fan tooling.
