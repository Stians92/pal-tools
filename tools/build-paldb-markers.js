// Builds web/src/data/paldb-markers.json from vendored paldb.cc map data
// (data/vendor/paldb/*, fetched by tools/fetch-paldb.js).
// Location data courtesy of paldb.cc; underlying game data © Pocketpair.
'use strict';
const fs = require('fs');
const path = require('path');

const vendorDir = path.join(__dirname, '..', 'data', 'vendor', 'paldb');
const read = f => fs.readFileSync(path.join(vendorDir, f), 'utf8');

// Extract a `var NAME = [...]` / `{...}` literal from a JS source without eval:
// bracket-match from the first opener, respecting strings/escapes, then JSON.parse.
function extractVar(src, name) {
  const decl = src.indexOf('var ' + name + ' =');
  if (decl < 0) return null;
  const iBracket = src.indexOf('[', decl);
  const iBrace = src.indexOf('{', decl);
  const open = (iBracket >= 0 && (iBrace < 0 || iBracket < iBrace)) ? iBracket : iBrace;
  const openCh = src[open];
  const closeCh = openCh === '[' ? ']' : '}';
  let depth = 0, inStr = false, esc = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return JSON.parse(src.slice(open, i + 1));
    }
  }
  throw new Error(`unterminated literal for ${name}`);
}

const mainRaw = extractVar(read('map_data_en.js'), 'fixedDungeon');
let treeRaw = [];
try { treeRaw = extractVar(read('treemap_data_en.js'), 'fixedDungeon') ?? []; }
catch (e) { console.warn('treemap parse failed:', e.message); }

// --- survey types (printed for validation against research numbers) ---
const typeCounts = {};
for (const m of mainRaw) typeCounts[m.type] = (typeCounts[m.type] || 0) + 1;
console.log('main types:', JSON.stringify(typeCounts, null, 0));
const treeTypes = {};
for (const m of treeRaw) treeTypes[m.type] = (treeTypes[m.type] || 0) + 1;
console.log('tree types:', JSON.stringify(treeTypes, null, 0));

// --- note-id join (save keys = NoteMasterDataTable row names) ---
// NoteDescText rows are keyed like "NOTE_<id>_..." or carry the note title;
// build title→id where derivable, then href/title → noteId.
let noteRows = {};
try {
  const nmt = JSON.parse(read('NoteMasterDataTable.json'));
  const rows = nmt?.[0]?.Rows ?? nmt?.Rows ?? nmt;
  noteRows = rows && typeof rows === 'object' ? rows : {};
} catch (e) { console.warn('NoteMasterDataTable parse failed:', e.message); }
const noteIds = Object.keys(noteRows);
console.log('note ids in master table:', noteIds.length, noteIds.slice(0, 8).join(', '));

// Join paldb journal titles to note ids. Hyphens are significant ("Day1-1" vs
// "Day11" are different notes), so normalization keeps them. Tower-boss
// diaries use the leaders' names; the id prefixes follow the tower biome
// (Zoe Rayne = grass-region tower, etc.). Only ids present in the master
// table are emitted; anything else ships noteId=null (no guessing).
const normalizeForJoin = s => String(s).toLowerCase().replace(/[^a-z0-9-]/g, '');
const idByNorm = new Map();
for (const id of noteIds) idByNorm.set(normalizeForJoin(id), id);

const BOSS_PREFIX_BY_NAME = {
  rayne: 'GrassBoss',       // Zoe Rayne — Rayne Syndicate Tower (grass)
  everhart: 'ForestBoss',   // Lily Everhart — Free Pal Alliance Tower (forest)
  travers: 'DesertBoss',    // Axel Travers — Eternal Pyre Tower (desert)
  ashford: 'SnowBoss',      // Victor Ashford — PIDF Tower (snow)
  dryden: 'VolcanoBoss',    // Marcus Dryden — PAL Genetics Tower (volcano)
};

function joinNoteId(href, title) {
  const t = `${href ?? ''} ${title ?? ''}`;
  // Castaway's Journal — "Day 5", "Day 1-1", "Day XX"
  let m = t.match(/day[ _-]?(\d+)(?:-(\d+))?/i);
  if (m) {
    const hit = idByNorm.get('day' + m[1] + (m[2] ? '-' + m[2] : ''));
    if (hit) return hit;
  }
  if (/day[ _-]?xx/i.test(t)) return idByNorm.get('day-xx') ?? null;
  // Tower-leader diaries — "<Name>'s Diary - N"
  for (const [name, prefix] of Object.entries(BOSS_PREFIX_BY_NAME)) {
    if (t.toLowerCase().includes(name)) {
      const n = t.match(/(\d+)\s*$/);
      if (n) {
        const hit = idByNorm.get(normalizeForJoin(prefix + n[1]));
        if (hit) return hit;
      }
    }
  }
  return null;
}

// --- category mapping ---
const MATERIAL_TYPES = new Set(['Ore', 'Coal', 'Sulfur', 'Pure Quartz', 'Hexolite Quartz', 'Chromite', 'Soralite', 'Nightstar Sand', 'Crude Oil', 'Paloxite']);
const CHEST_TYPES = new Set(['Treasure', 'Treasure Element', 'Oilrig Treasure', 'Treasure Map']);
const NPC_TYPES = new Set(['NPC', 'Wandering Merchant', 'Black Marketeer', 'Pal Merchant']);

const out = {
  meta: {
    source: 'paldb.cc map data (location data courtesy of paldb.cc; game data © Pocketpair)',
    fetched: new Date().toISOString(),
  },
  chests: [], eggs: [], skillFruits: [], journals: [],
  materials: [], npcs: [], supply: [], fishing: [],
};

const r1 = v => Math.round(v * 10) / 10;
let journalMatched = 0;

function addMarker(m, area) {
  const base = { x: r1(m.pos.X), y: r1(m.pos.Y) };
  if (area === 'tree') base.area = 'tree';
  const type = m.type;
  if (CHEST_TYPES.has(type)) {
    out.chests.push({ ...base, sub: type === 'Treasure' ? (m.class ? m.class.replace('map-rarity', 'rarity ') : 'chest') : type.toLowerCase(), name: m.item ?? undefined });
  } else if (/ Egg$/.test(type)) {
    out.eggs.push({ ...base, sub: type.replace(/ Egg$/, '') });
  } else if (type === 'Fruit Tree') {
    out.skillFruits.push(base);
  } else if (type === 'Journals' || type === 'Memo Planner') {
    const noteId = joinNoteId(m.href, m.item);
    if (noteId) journalMatched++;
    out.journals.push({ ...base, title: m.item ?? type, noteId });
  } else if (MATERIAL_TYPES.has(type) || /(Cluster)$/.test(type)) {
    out.materials.push({ ...base, sub: type });
  } else if (NPC_TYPES.has(type)) {
    out.npcs.push({ ...base, sub: type, name: m.item ?? undefined });
  } else if (type === 'Supply') {
    out.supply.push(base);
  } else if (type === 'Fishing' || type === 'Salvage' || type === 'Fishing Spot') {
    out.fishing.push({ ...base, sub: type });
  }
  // other types (Alpha Pal, Dungeon, Fast Travel, effigies…) intentionally
  // skipped — already covered by the GUID-keyed palworld-save-pal datasets.
}

for (const m of mainRaw) { if (m && m.pos) addMarker(m, 'main'); }
for (const m of treeRaw) { if (m && m.pos) addMarker(m, 'tree'); }

const counts = Object.fromEntries(Object.entries(out).filter(([k]) => k !== 'meta').map(([k, v]) => [k, v.length]));
console.log('output counts:', JSON.stringify(counts));
console.log(`journals matched to save note-ids: ${journalMatched}/${out.journals.length}`);

const dest = path.join(__dirname, '..', 'web', 'src', 'data', 'paldb-markers.json');
fs.writeFileSync(dest, JSON.stringify(out));
console.log('wrote', dest, `(${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
