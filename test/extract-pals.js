// End-to-end test: decompress + parse Level.sav and Players/*.sav, list all pals.
const fs = require('fs');
const path = require('path');
const { decompressSav } = require('../src/savefile.js');
const pals = require('../src/pals.js');

const saveDir = process.argv[2];
if (!saveDir) { console.error('usage: node extract-pals.js <save-dir>'); process.exit(2); }

function load(f) { return new Uint8Array(fs.readFileSync(f)); }

const t0 = Date.now();
const levelGvas = decompressSav(load(path.join(saveDir, 'Level.sav')));
console.error(`Level.sav decompressed: ${levelGvas.length} bytes (${Date.now() - t0} ms)`);

const t1 = Date.now();
const level = pals.parseLevelSav(levelGvas);
console.error(`Level.sav parsed (${Date.now() - t1} ms), class=${level.header.saveGameClassName}`);

const world = pals.extractWorld(level);

const playerMetas = [];
const playersDir = path.join(saveDir, 'Players');
for (const f of fs.readdirSync(playersDir)) {
  // hex-uid saves only — skips companions like the *_dps.sav pal-storage files
  if (!/^[0-9A-F]+\.sav$/i.test(f)) continue;
  const gvasBytes = decompressSav(load(path.join(playersDir, f)));
  const parsed = pals.parsePlayerSav(gvasBytes);
  const meta = pals.extractPlayerMeta(parsed);
  playerMetas.push(meta);
  console.error(`player ${f}: uid=${meta.playerUid} palbox=${meta.palboxContainerId} party=${meta.partyContainerId}`);
}

pals.classifyPals(world, playerMetas);

console.error(`\nPlayers (${world.players.length}):`);
for (const p of world.players)
  console.error(`  ${p.nickname}  Lv ${p.level}  uid=${p.uid}`);

console.error(`\nPals (${world.pals.length}):`);
const counts = {};
for (const p of world.pals) counts[p.where] = (counts[p.where] || 0) + 1;
console.error(`  by location: ${JSON.stringify(counts)}`);

const fmt = p => {
  const flags = [p.isAlpha ? 'ALPHA' : '', p.isLucky ? 'LUCKY' : ''].filter(Boolean).join(',');
  return `  Lv ${String(p.level).padStart(3)}  ${p.species.padEnd(24)} ${(p.gender || '?').padEnd(6)} ` +
         `IV ${p.talentHp}/${p.talentMelee}/${p.talentShot}/${p.talentDefense}`.padEnd(22) +
         ` ${p.nickname ? `"${p.nickname}"` : ''}${flags ? ` [${flags}]` : ''}`;
};

for (const where of ['party', 'palbox', 'base/other', 'unknown']) {
  const group = world.pals.filter(p => p.where === where);
  if (!group.length) continue;
  console.error(`\n== ${where} (${group.length}) ==`);
  for (const p of group.sort((a, b) => b.level - a.level)) console.error(fmt(p));
}

fs.writeFileSync(path.join(__dirname, '..', 'pals.json'),
  JSON.stringify({ players: world.players, pals: world.pals }, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
console.error('\nwrote pals.json');
