// Downloads paldb.cc map data files (plain JS with embedded JSON arrays) into
// data/vendor/paldb/. Re-run after game patches. Attribution: paldb.cc.
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'data', 'vendor', 'paldb');
fs.mkdirSync(dir, { recursive: true });

const FILES = [
  ['map_data_en.js', 'https://paldb.cc/js/map_data_en.js'],
  ['treemap_data_en.js', 'https://paldb.cc/js/treemap_data_en.js'],
  // note-id join sources (c2t-r/PalworldData FModel dump)
  ['NoteMasterDataTable.json', 'https://raw.githubusercontent.com/c2t-r/PalworldData/HEAD/DataTable/NoteData/NoteMasterDataTable.json'],
  ['NoteDescText.json', 'https://raw.githubusercontent.com/c2t-r/PalworldData/HEAD/DataTable/Text/NoteDescText.json'],
];

(async () => {
  for (const [name, url] of FILES) {
    const res = await fetch(url, { headers: { 'user-agent': 'pal-tools (personal project)' } });
    if (!res.ok) { console.error(`${name}: HTTP ${res.status} from ${url}`); process.exit(1); }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(dir, name), buf);
    console.log(`${name}: ${(buf.length / 1024).toFixed(0)} KB`);
  }
})();
