# Pal Tools

Palworld **palbox viewer + breeding calculator** web app.

- Save-file parsing is 100% from scratch (no external parser): a hand-ported
  Oodle Kraken/Mermaid decompressor + GVAS parser in plain JS (`src/`).
- The website is TypeScript + Svelte (`web/`, Vite).
- Breeding data is the **1.0-rebalanced** dataset vendored from
  [tylercamp/palcalc](https://github.com/tylercamp/palcalc) (MIT, extracted
  from current game files). Pre-1.0 breeding tables give wrong offspring.
- Map data: relics/fast-travel/bosses from
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
  multi-step breeding route from your owned species.

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
