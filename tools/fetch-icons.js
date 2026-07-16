// Downloads pal icons from the palcalc repo (MIT; artwork © Pocketpair) into
// web/public/pals/<InternalName>.png. Rerun after adding species.
'use strict';
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'data', 'breeding-data.json'), 'utf8'));
const outDir = path.join(__dirname, '..', 'web', 'public', 'pals');
fs.mkdirSync(outDir, { recursive: true });

const BASE = 'https://raw.githubusercontent.com/tylercamp/palcalc/main/PalCalc.UI/Resources/Pals/';

async function fetchOne(s) {
  const dest = path.join(outDir, s.id + '.png');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return 'cached';
  const url = BASE + encodeURIComponent(s.name) + '.png';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${s.name}: HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return 'ok';
}

(async () => {
  const queue = [...data.species];
  let ok = 0, cached = 0;
  const failed = [];
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (;;) {
      const s = queue.shift();
      if (!s) return;
      try {
        const r = await fetchOne(s);
        r === 'cached' ? cached++ : ok++;
      } catch (e) {
        failed.push(`${s.id}: ${e.message}`);
      }
    }
  }));
  console.log(`downloaded ${ok}, cached ${cached}, failed ${failed.length}`);
  if (failed.length) { console.log(failed.join('\n')); process.exit(1); }
})();
