// Breeding engine — Palworld 1.0 rules, validated against the fully
// materialized 44,851-row pairing table (see tools/build-data.js).

import data from '../data/breeding-data.json';
import type { Pal } from './paltools';

export interface Species {
  id: string;
  name: string;
  dex: number;
  variant: boolean;
  rank: number;
  prio: number;
  male: number;
  guaranteed: string[];
}

export interface PassiveInfo {
  id: string;
  name: string;
  rank: number;
  std: boolean;
  rnd: boolean;
  w: number;
  desc?: string;
}

const species = data.species as Species[];
const excluded = new Set<string>(data.excluded as string[]);
const passiveList = data.passives as PassiveInfo[];

const byIdLower = new Map<string, Species>(species.map(s => [s.id.toLowerCase(), s]));
export const speciesById = (id: string): Species | undefined => byIdLower.get(id.toLowerCase());
export const allSpecies = species;
export const allPassives = passiveList;

const passiveByIdLower = new Map<string, PassiveInfo>(passiveList.map(p => [p.id.toLowerCase(), p]));
export const passiveById = (id: string): PassiveInfo | undefined => passiveByIdLower.get(id.toLowerCase());
export const passiveName = (id: string): string => passiveById(id)?.name ?? id;
/** In-game rarity rank of a passive: negative = debuff, 1–4 = tiers (Legend = 4). */
export const passiveRank = (id: string): number => passiveById(id)?.rank ?? 1;
/** CSS tier class matching the in-game rarity colors. */
export const passiveTier = (id: string): string => {
  const r = passiveRank(id);
  return r < 0 ? 'pv-n' : r < 2 ? 'pv-1' : r < 3 ? 'pv-2' : r < 4 ? 'pv-3' : 'pv-4';
};
/** Best passives first (rank desc, then name) — for display. */
export const sortPassivesByRank = (ids: string[]): string[] =>
  [...ids].sort((a, b) => passiveRank(b) - passiveRank(a) || passiveName(a).localeCompare(passiveName(b)));
export const speciesName = (id: string): string => speciesById(id)?.name ?? id;
/** Icon URL for a species (files in web/public/pals, keyed by canonical id). */
export const speciesIcon = (id: string): string | null => {
  const s = speciesById(id);
  return s ? `${import.meta.env.BASE_URL}pals/${s.id}.png` : null;
};

// candidates for the rank formula, presorted by rank
const candidates = species.filter(s => !excluded.has(s.id));

const comboKey = (a: string, b: string) => {
  const al = a.toLowerCase(), bl = b.toLowerCase();
  return al < bl ? `${al}|${bl}` : `${bl}|${al}`;
};
const uniqueMap = new Map<string, string>(
  (data.uniqueCombos as { a: string; b: string; child: string }[])
    .map(c => [comboKey(c.a, c.b), c.child]),
);
const genderedCombos = data.genderedCombos as { a: string; ga: string; b: string; gb: string; child: string }[];

export type Gender = 'Male' | 'Female';

// memo for genderless species-level lookups (reachability BFS hits ~45k pairs)
const childMemo = new Map<string, string | null>();

/** Child species id for a parent pair (ids are save-file CharacterIDs, case-insensitive). */
export function childOf(aId: string, bId: string, ga?: Gender | null, gb?: Gender | null): string | null {
  if (ga == null && gb == null) {
    const key = comboKey(aId, bId);
    let v = childMemo.get(key);
    if (v === undefined) {
      v = childOfUncached(aId, bId, null, null);
      childMemo.set(key, v);
    }
    return v;
  }
  return childOfUncached(aId, bId, ga, gb);
}

function childOfUncached(aId: string, bId: string, ga?: Gender | null, gb?: Gender | null): string | null {
  const a = speciesById(aId), b = speciesById(bId);
  if (!a || !b) return null;
  if (a.id === b.id) return a.id;

  for (const g of genderedCombos) {
    const matches = (pid: string, pg: Gender | null | undefined, cid: string, cg: string) =>
      pid.toLowerCase() === cid.toLowerCase() && (cg === 'WILDCARD' || !pg || pg.toUpperCase() === cg);
    if ((matches(a.id, ga, g.a, g.ga) && matches(b.id, gb, g.b, g.gb)) ||
        (matches(b.id, gb, g.a, g.ga) && matches(a.id, ga, g.b, g.gb)))
      return g.child;
  }
  // gendered pals with unknown gender: fall through to unique map only if the
  // pair isn't the gendered special pair
  const u = uniqueMap.get(comboKey(a.id, b.id));
  if (u) return u;

  const target = Math.floor((a.rank + b.rank + 1) / 2);
  let best: Species | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.abs(c.rank - target);
    if (d < bestDist) { best = c; bestDist = d; }
    else if (d === bestDist && best) {
      if (c.prio > best.prio || (c.prio === best.prio && best.variant && !c.variant)) best = c;
    }
  }
  return best ? best.id : null;
}

// ---- passive inheritance probability ----------------------------------------------

const P_FROM_PARENTS: number[] = data.inheritance.fromParents; // exactly N of pool, N=1..4
const MAX_PASSIVES: number = data.inheritance.maxPassives;

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/**
 * P(child directly inherits at least the `desired` passives), given both
 * parents' combined passive pool. Ignores the small chance of desired passives
 * arriving via random rolls, so this is a slight underestimate.
 */
export function passiveProbability(parentPool: string[], desired: string[]): number {
  const pool = [...new Set(parentPool.map(p => p.toLowerCase()))];
  const want = [...new Set(desired.map(p => p.toLowerCase()))];
  if (want.length === 0) return 1;
  if (want.length > MAX_PASSIVES) return 0;
  if (!want.every(w => pool.includes(w))) return 0;

  const P = pool.length, D = want.length;
  let prob = 0;
  for (let n = 1; n <= 4; n++) {
    const pN = P_FROM_PARENTS[n - 1];
    const eff = Math.min(n, P);
    if (eff < D) continue;
    // uniform over C(P, eff) subsets; want the D desired fixed
    prob += pN * (choose(P - D, eff - D) / choose(P, eff));
  }
  return prob;
}

// ---- pair search over owned pals ---------------------------------------------------

export interface BreedingPair {
  father: Pal;
  mother: Pal;
  childId: string;
  /** union of both parents' passives */
  pool: string[];
  /** P(child has all desired passives), set by findPairs when desired given */
  probability: number;
}

/** Save CharacterID → breedable species id (strips boss/predator prefixes). */
export const palSpeciesId = (p: Pal): string =>
  p.characterId.replace(/^BOSS_/i, '').replace(/^PREDATOR_/i, '');

/** All (male, female) pairs among `pals` whose child is `targetId` (null = any). */
export function findPairs(pals: Pal[], targetId: string | null, desired: string[] = []): BreedingPair[] {
  // group by species to compute childOf once per species pair
  const bySpecies = (gender: Gender) => {
    const m = new Map<string, Pal[]>();
    for (const p of pals) {
      if (p.gender !== gender) continue;
      const sid = palSpeciesId(p);
      if (!speciesById(sid)) continue;
      const key = speciesById(sid)!.id;
      (m.get(key) ?? m.set(key, []).get(key)!).push(p);
    }
    return m;
  };
  const males = bySpecies('Male');
  const females = bySpecies('Female');
  const out: BreedingPair[] = [];
  for (const [ms, mPals] of males) {
    for (const [fs, fPals] of females) {
      const child = childOf(ms, fs, 'Male', 'Female');
      if (!child) continue;
      if (targetId && child.toLowerCase() !== targetId.toLowerCase()) continue;
      for (const m of mPals) {
        for (const f of fPals) {
          if (m.key.instanceId === f.key.instanceId) continue;
          const pool = [...new Set([...m.passives, ...f.passives])];
          const probability = desired.length ? passiveProbability(pool, desired) : 1;
          if (desired.length && probability === 0) continue;
          out.push({ father: m, mother: f, childId: child, pool, probability });
        }
      }
    }
  }
  return out.sort((a, b) => b.probability - a.probability);
}

// ---- multi-step reachability -------------------------------------------------------

export interface BreedingStep {
  parentA: string; // species id (from owned or earlier step)
  parentB: string;
  child: string;
}

export interface BreedingPlan {
  steps: BreedingStep[];
  target: string;
}

export interface Reachability {
  /** species id (canonical) → breeding generations from owned set (0 = owned) */
  depth: Map<string, number>;
  /** species id → the pair of species that first produced it */
  madeBy: Map<string, [string, string]>;
}

/**
 * Full breeding-cost map: for every species, the minimum TOTAL number of
 * breeds needed starting from the owned set (0 = owned, 1 = one breed, …).
 * When both parents must themselves be bred, their costs add up —
 * cost(child) = min over pairs of cost(a) + cost(b) + 1, computed by
 * relaxation to a fixpoint. (Shared prerequisites in the two subtrees are
 * counted twice, so this is an upper bound in rare diamond cases.)
 * Species absent from `depth` are unreachable (catch-only from your box).
 */
export function reachabilityMap(ownedSpeciesIds: string[]): Reachability {
  const depth = new Map<string, number>();
  const madeBy = new Map<string, [string, string]>();
  for (const id of ownedSpeciesIds) {
    const s = speciesById(id);
    if (s) depth.set(s.id, 0);
  }
  if (depth.size === 0) return { depth, madeBy };

  for (let iter = 0; iter < 32; iter++) {
    let changed = false;
    const reached = [...depth.keys()];
    for (let i = 0; i < reached.length; i++) {
      for (let j = i; j < reached.length; j++) {
        const a = reached[i], b = reached[j];
        const child = childOf(a, b);
        if (!child) continue;
        const cost = depth.get(a)! + depth.get(b)! + 1;
        const cur = depth.get(child);
        if (cur === undefined || cost < cur) {
          depth.set(child, cost);
          madeBy.set(child, [a, b]);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return { depth, madeBy };
}

/** Reconstruct the step list for one target from a reachability result. */
export function routeFor(reach: Reachability, targetId: string): BreedingStep[] {
  const steps: BreedingStep[] = [];
  const seen = new Set<string>();
  const build = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const rec = reach.madeBy.get(id);
    if (!rec) return;
    build(rec[0]); build(rec[1]);
    steps.push({ parentA: rec[0], parentB: rec[1], child: id });
  };
  const s = speciesById(targetId);
  if (s) build(s.id);
  return steps;
}

/**
 * Species-level BFS: starting from owned species, which species are reachable
 * by repeated breeding, and via which minimal-step plan. Assumes any bred
 * species can later be obtained in both genders.
 */
export function planBreeding(ownedSpeciesIds: string[], targetId: string, maxDepth = 6): BreedingPlan | null {
  const owned = new Set(ownedSpeciesIds.map(s => s.toLowerCase()).filter(s => byIdLower.has(s)));
  const target = targetId.toLowerCase();
  if (owned.has(target)) return { steps: [], target: speciesById(targetId)!.id };

  // BFS over "known set" frontier — track how each new species was first made
  const madeBy = new Map<string, [string, string]>();
  let frontier = [...owned];
  const known = new Set(owned);

  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    const knownArr = [...known];
    for (const a of frontier) {
      for (const b of knownArr) {
        const child = childOf(a, b);
        if (!child) continue;
        const cl = child.toLowerCase();
        if (!known.has(cl)) {
          known.add(cl);
          madeBy.set(cl, [a, b]);
          next.push(cl);
          if (cl === target) {
            // reconstruct plan
            const steps: BreedingStep[] = [];
            const build = (id: string) => {
              const rec = madeBy.get(id);
              if (!rec) return;
              build(rec[0]); build(rec[1]);
              steps.push({ parentA: byIdLower.get(rec[0])!.id, parentB: byIdLower.get(rec[1])!.id, child: byIdLower.get(id)!.id });
            };
            build(target);
            return { steps, target: byIdLower.get(target)!.id };
          }
        }
      }
    }
    frontier = next;
  }
  return null;
}
