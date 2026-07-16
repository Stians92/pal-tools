// src/lib/paltools.ts
import "../../../src/oodle.js";
import "../../../src/gvas.js";
import "../../../src/savefile.js";
import "../../../src/pals.js";
var PT = globalThis.PalTools;
var decompressSav = (b) => PT.decompressSav(b);
var parseLevelSav = (b) => PT.parseLevelSav(b);
var parsePlayerSav = (b) => PT.parsePlayerSav(b);
var extractWorld = (p) => PT.extractWorld(p);
var extractPlayerMeta = (p) => PT.extractPlayerMeta(p);
var classifyPals = (w, m) => PT.classifyPals(w, m);
async function loadSaveFiles(files) {
  const candidates = files.filter((f) => /(^|\/)Level\.sav$/i.test(f.path));
  if (!candidates.length) throw new Error("No Level.sav found in the selection");
  const isBackup = (p) => /(^|\/)backup\//i.test(p);
  const live = candidates.filter((f) => !isBackup(f.path));
  const pool = live.length ? live : candidates;
  pool.sort((a, b) => (b.file.lastModified || 0) - (a.file.lastModified || 0));
  const level = pool[0];
  const baseDir = level.path.replace(/Level\.sav$/i, "");
  const playerFiles = files.filter((f) => f.path.startsWith(baseDir) && new RegExp("^" + escapeRegExp(baseDir) + "Players/[0-9A-F]+\\.sav$", "i").test(f.path));
  const levelBytes = new Uint8Array(await level.file.arrayBuffer());
  const world = extractWorld(parseLevelSav(decompressSav(levelBytes)));
  const metas = [];
  for (const pf of playerFiles) {
    try {
      const bytes = new Uint8Array(await pf.file.arrayBuffer());
      metas.push(extractPlayerMeta(parsePlayerSav(decompressSav(bytes))));
    } catch (e) {
      console.warn("player parse failed:", pf.path, e);
    }
  }
  classifyPals(world, metas);
  return {
    world,
    metas,
    loadedFrom: baseDir.replace(/\/$/, "") || "(dropped files)",
    worldCount: new Set(live.map((f) => f.path.replace(/Level\.sav$/i, ""))).size || 1
  };
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export {
  classifyPals,
  decompressSav,
  extractPlayerMeta,
  extractWorld,
  loadSaveFiles,
  parseLevelSav,
  parsePlayerSav
};
