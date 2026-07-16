// Builds web/src/data/markers.json from vendored palworld-save-pal extracts
// (data/vendor/*.json, MIT, 1.0 game data).
'use strict';
const fs = require('fs');
const path = require('path');

const vendor = p => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'vendor', p), 'utf8'));

const ft = vendor('fast_travel_points.json');
const bosses = vendor('bosses.json');
const mapObjects = vendor('map_objects.json');

const out = {
  meta: { source: 'oMaN-Rod/palworld-save-pal (MIT), game data v1.0', built: new Date().toISOString() },
  fastTravel: Object.entries(ft).map(([id, p]) => ({
    id, x: p.x, y: p.y, name: p.localized_name,
  })),
  alphas: Object.values(bosses).map(b => ({
    spawnerId: b.spawner_id, characterId: b.character_id, level: b.level,
    x: b.x, y: b.y,
  })),
  dungeons: Object.values(mapObjects).filter(o => o.type === 'dungeon').map(o => ({ x: o.x, y: o.y })),
  predators: Object.values(mapObjects).filter(o => o.type === 'predator_pal').map(o => ({ x: o.x, y: o.y, pal: o.pal })),
};

const dest = path.join(__dirname, '..', 'web', 'src', 'data', 'markers.json');
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`fastTravel ${out.fastTravel.length}, alphas ${out.alphas.length}, dungeons ${out.dungeons.length}, predators ${out.predators.length}`);
console.log('wrote', dest, `(${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
