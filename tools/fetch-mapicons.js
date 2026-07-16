// Downloads in-game marker icons referenced by paldb's iconLookup into
// web/public/mapicons/, and emits web/src/data/mapicons.json (type → file).
// Game icon art © Pocketpair; URLs courtesy of paldb.cc.
'use strict';
const fs = require('fs');
const path = require('path');

const vendorDir = path.join(__dirname, '..', 'data', 'vendor', 'paldb');
const outDir = path.join(__dirname, '..', 'web', 'public', 'mapicons');
fs.mkdirSync(outDir, { recursive: true });

function extractVar(src, name) {
  const decl = src.indexOf('var ' + name + ' =');
  if (decl < 0) return null;
  const open = src.indexOf('{', decl);
  let depth = 0, inStr = false, esc = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (inStr) { if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return JSON.parse(src.slice(open, i + 1)); }
  }
  throw new Error('unterminated iconLookup');
}

const src = fs.readFileSync(path.join(vendorDir, 'map_data_en.js'), 'utf8');
const lookup = extractVar(src, 'iconLookup');

// Marker types we render (paldb type name → our slug)
const WANTED = {
  'Fast Travel': 'fast-travel',
  'Alpha Pal': 'alpha',
  'Dungeon': 'dungeon',
  'Lifmunk Effigy': 'relic',
  'Treasure': 'chest',
  'Treasure Element': 'chest-element',
  'Treasure Map': 'treasure-map',
  'Oilrig Treasure': 'chest-oilrig',
  'Grass Egg': 'egg-grass',
  'Desert Egg': 'egg-desert',
  'Frozen Egg': 'egg-frozen',
  'Volcano Egg': 'egg-volcano',
  'Sakura Egg': 'egg-sakura',
  'Feybreak Egg': 'egg-feybreak',
  'Sunreach Egg': 'egg-sunreach',
  'World Tree Egg': 'egg-worldtree',
  'Fruit Tree': 'skill-fruit',
  'Journals': 'journal',
  'Memo Planner': 'journal-memo',
  'NPC': 'npc',
  'Wandering Merchant': 'merchant',
  'Black Marketeer': 'black-marketeer',
  'Supply': 'supply',
  'Fishing Spot': 'fishing',
  'Ore': 'ore',
  'Coal': 'coal',
  'Sulfur': 'sulfur',
  'Pure Quartz': 'quartz',
  'Hexolite Quartz': 'hexolite',
  'Chromite': 'chromite',
  'Soralite': 'soralite',
  'Nightstar Sand': 'nightstar',
  'Crude Oil': 'crude-oil',
  'Paloxite': 'paloxite',
};

(async () => {
  const mapping = {};
  let ok = 0, missing = [];
  for (const [type, slug] of Object.entries(WANTED)) {
    const entry = lookup[type];
    const url = entry && (entry.fixed_icon || entry.icon);
    if (!url) { missing.push(type); continue; }
    const ext = path.extname(new URL(url).pathname) || '.webp';
    const file = slug + ext;
    const dest = path.join(outDir, file);
    if (!fs.existsSync(dest)) {
      const res = await fetch(url, { headers: { 'user-agent': 'pal-tools (personal project)' } });
      if (!res.ok) { missing.push(`${type} (HTTP ${res.status})`); continue; }
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    }
    mapping[type] = file;
    ok++;
  }
  fs.writeFileSync(path.join(__dirname, '..', 'web', 'src', 'data', 'mapicons.json'), JSON.stringify(mapping, null, 1));
  console.log(`icons: ${ok} ok, missing: ${missing.length}${missing.length ? ' → ' + missing.join(', ') : ''}`);
})();
