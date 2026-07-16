# Feature parity scope — PalworldSaveTools (v2.0.7) as a web app

Goal: feature parity with deafdudecomputers/PalworldSaveTools, delivered as a
dependency-free client-side web app. Reference is a PySide6 desktop GUI with a
native (C/C++) palsav engine + vendored ooz for Oodle.

## Reference feature inventory

Players/Guilds: view/search/sort players (name, level, pal count, UID, guild,
last-seen); rename; edit level/stats/tech points; delete inactive/duplicate
players. Guilds: rename, change leader, set level, move players, delete
empty/inactive, unlock lab research.

Pal editor: IVs (0-100), level, trust rank; souls (0-20 ×4); active skills,
learn-all, passives, work suitability; Boss/Alpha, Lucky, Awakened flags; rank,
favorite/lock; add new pal; cheat mode caps 255; relic abilities.

Base tools: export/import base blueprints (JSON), clone bases, adjust radius,
delete inactive bases/non-base map objects.

Map viewer: interactive world map, base/player markers, overlays, exclusion
zone drawing, zoom/pan, guild/player filtering.

Inventory: player bag/equipment/key items, character stats, unlock fast
travel; base container browsing, cross-guild ops, structure deletion.

Breeding tab (calculator).

Exclusions: protection lists (players/guilds/bases) for cleanup ops.

Save tools: SAV↔JSON convert; GamePass→Steam; SteamID→UID; restore map fog;
palbox slot injector; raw save editor; character transfer between worlds;
fix host save (UID swap); save diagnostic; WorldOption editor; JSON editor tab.

Cleanup functions: delete empty guilds / inactive bases / inactive players /
duplicates / orphaned data; clean invalid items/pals/passives; illegal
structure cleanup; reset missions/dungeons/oil rig/invader/supply drops;
fix negative timestamps; unlock private chests; repair structures.

## Web app build order

1. Core engine (JS, no deps): Oodle decompress port (src/oodle.js), zlib
   inflate/deflate from scratch, GVAS parser/writer (docs/gvas-spec.md).
2. Palbox/pal list viewer (user's first ask) + player list.
3. Pal editor, player editor, guild view.
4. SAV↔JSON converter, JSON editor.
5. Cleanup functions, transfer tools, map viewer, the rest.

Architecture: single-page client-side app; File System Access API / file input
for .sav files; Web Worker for parsing 15MB+ saves; everything local.
