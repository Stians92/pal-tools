// Typed facade over the from-scratch save parser (../../src/*.js).
// Those files are dependency-free classic scripts that register a global
// `PalTools` object when no CommonJS `module` is present; we import them for
// their side effects and re-export a typed API.

import '../../../src/oodle.js';
import '../../../src/gvas.js';
import '../../../src/savefile.js';
import '../../../src/pals.js';

export interface PalKey {
  playerUid: string;
  instanceId: string;
}

export interface Pal {
  key: PalKey;
  groupId: string | null;
  nickname: string | null;
  level: number;
  exp: number;
  characterId: string;
  /** characterId with BOSS_/PREDATOR_ prefix stripped */
  species: string;
  isAlpha: boolean;
  isLucky: boolean;
  gender: 'Male' | 'Female' | null;
  rank: number;
  rankHp: number;
  rankAttack: number;
  rankDefence: number;
  rankCraftSpeed: number;
  talentHp: number;
  talentMelee: number;
  talentShot: number;
  talentDefense: number;
  passives: string[];
  equipWaza: string[];
  masteredWaza: string[];
  hp: number | null;
  ownerUid: string | null;
  containerId: string | null;
  slotIndex: number;
  friendship: number;
  /** set by classifyPals */
  where?: 'palbox' | 'party' | 'base/other' | 'unknown';
}

export interface Player {
  key: PalKey;
  uid: string;
  nickname: string | null;
  level: number;
  exp: number;
  groupId: string | null;
}

export interface WorldData {
  players: Player[];
  pals: Pal[];
  containers: Map<string, { id: string; slotNum: number; slots: unknown[] }>;
  guilds: { id: string; groupType: string | null }[];
}

export interface PlayerMeta {
  playerUid: string | null;
  instanceId: string | null;
  palboxContainerId: string | null;
  partyContainerId: string | null;
  inventory: unknown;
  /** 32-hex instance ids of collected relics/effigies (typed + legacy union) */
  collectedRelics: string[];
  /** 32-hex guids of unlocked fast travel points */
  unlockedFastTravel: string[];
  /** defeated field/alpha boss spawner ids (lowercase) */
  defeatedBosses: string[];
  defeatedTowers: string[];
  collectedNotes: string[];
}

interface PalToolsGlobal {
  decompressSav(bytes: Uint8Array): Uint8Array;
  parseLevelSav(gvasBytes: Uint8Array): unknown;
  parsePlayerSav(gvasBytes: Uint8Array): unknown;
  extractWorld(parsed: unknown): WorldData;
  extractDpsPals(parsed: unknown, ownerUid: string): Pal[];
  extractPlayerMeta(parsed: unknown): PlayerMeta;
  classifyPals(world: WorldData, metas: PlayerMeta[]): WorldData;
}

const PT = (globalThis as unknown as { PalTools: PalToolsGlobal }).PalTools;

export const decompressSav = (b: Uint8Array) => PT.decompressSav(b);
export const parseLevelSav = (b: Uint8Array) => PT.parseLevelSav(b);
export const parsePlayerSav = (b: Uint8Array) => PT.parsePlayerSav(b);
export const extractWorld = (p: unknown) => PT.extractWorld(p);
export const extractDpsPals = (p: unknown, uid: string) => PT.extractDpsPals(p, uid);
export const extractPlayerMeta = (p: unknown) => PT.extractPlayerMeta(p);
export const classifyPals = (w: WorldData, m: PlayerMeta[]) => PT.classifyPals(w, m);

export interface LoadedSave {
  world: WorldData;
  metas: PlayerMeta[];
  /** directory (within the drop) the loaded Level.sav came from */
  loadedFrom: string;
  /** number of distinct non-backup worlds found in the drop */
  worldCount: number;
}

/**
 * Portable snapshot of the parsed save, as written by the Palbox tab's
 * "Export JSON" and accepted back by the save loader. Much smaller than the
 * real save and needs no decompression, so it's the easy way for a co-op
 * host to share their box. View/plan-only: it cannot be written back to a
 * real save.
 */
export interface ExportedSave {
  format: 'paltools';
  version: 1;
  players: Player[];
  pals: Pal[];
  metas: PlayerMeta[];
}

export function serializeExport(players: Player[], pals: Pal[], metas: PlayerMeta[]): string {
  const data: ExportedSave = { format: 'paltools', version: 1, players, pals, metas };
  return JSON.stringify(data, null, 2);
}

export function parseExport(text: string): LoadedSave {
  let data: Partial<ExportedSave>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('not valid JSON');
  }
  if (data?.format !== 'paltools')
    throw new Error('not a Pal Tools export (missing format tag)');
  if (!Array.isArray(data.pals) || !Array.isArray(data.players) || !Array.isArray(data.metas))
    throw new Error('malformed Pal Tools export');
  return {
    world: { players: data.players, pals: data.pals, containers: new Map(), guilds: [] },
    metas: data.metas,
    loadedFrom: 'JSON export',
    worldCount: 1,
  };
}

/**
 * Load a full save from browser File objects. The drop may be a world folder,
 * or a parent folder containing several worlds and `backup/` snapshots — pick
 * the most recently modified non-backup world and scope Players/ to it.
 * A Pal Tools JSON export is accepted instead when no Level.sav is present.
 */
export async function loadSaveFiles(files: { path: string; file: File }[]): Promise<LoadedSave> {
  const candidates = files.filter(f => /(^|\/)Level\.sav$/i.test(f.path));
  if (!candidates.length) {
    const json = files.find(f => /\.json$/i.test(f.path));
    if (json) return parseExport(await json.file.text());
    throw new Error('No Level.sav found in the selection');
  }

  const isBackup = (p: string) => /(^|\/)backup\//i.test(p);
  const live = candidates.filter(f => !isBackup(f.path));
  const pool = live.length ? live : candidates; // all-backup drop: use backups
  pool.sort((a, b) => (b.file.lastModified || 0) - (a.file.lastModified || 0));
  const level = pool[0];
  const baseDir = level.path.replace(/Level\.sav$/i, ''); // '' or 'World/…/'

  const playerFiles = files.filter(f =>
    f.path.startsWith(baseDir) &&
    new RegExp('^' + escapeRegExp(baseDir) + 'Players/[0-9A-F]+\\.sav$', 'i').test(f.path));

  let levelBytes: Uint8Array;
  try {
    levelBytes = new Uint8Array(await level.file.arrayBuffer());
  } catch {
    // Chromium refuses to read a dropped file that changed on disk after the
    // drop (ERR_UPLOAD_FILE_CHANGED) — happens when the game is saving
    throw new Error(`${level.path} changed on disk while reading it — close ` +
      'Palworld (or copy the save folder somewhere first), then drop it again');
  }
  let world: WorldData;
  try {
    world = extractWorld(parseLevelSav(decompressSav(levelBytes)));
  } catch (e) {
    throw new Error(`${level.path}: ${(e as Error).message}`);
  }

  const metas: PlayerMeta[] = [];
  for (const pf of playerFiles) {
    try {
      const bytes = new Uint8Array(await pf.file.arrayBuffer());
      metas.push(extractPlayerMeta(parsePlayerSav(decompressSav(bytes))));
    } catch (e) {
      console.warn('player parse failed:', pf.path, e);
    }
  }

  // Dimensional Pal Storage — per-player Players/<uid>_dps.sav companions
  const dpsFiles = files.filter(f =>
    f.path.startsWith(baseDir) &&
    new RegExp('^' + escapeRegExp(baseDir) + 'Players/[0-9A-F]+_dps\\.sav$', 'i').test(f.path));
  for (const df of dpsFiles) {
    try {
      const hex = df.path.match(/([0-9A-F]+)_dps\.sav$/i)![1].toLowerCase();
      const uid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
      const bytes = new Uint8Array(await df.file.arrayBuffer());
      world.pals.push(...extractDpsPals(parsePlayerSav(decompressSav(bytes)), uid));
    } catch (e) {
      console.warn('dps parse failed:', df.path, e);
    }
  }

  classifyPals(world, metas);
  return {
    world,
    metas,
    loadedFrom: baseDir.replace(/\/$/, '') || '(dropped files)',
    worldCount: new Set(live.map(f => f.path.replace(/Level\.sav$/i, ''))).size || 1,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
