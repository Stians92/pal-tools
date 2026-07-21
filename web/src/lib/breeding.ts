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
  els: string[];
  /** partner gear (saddle etc.) tech unlock, null if the species has none */
  gear: { kind: string; lvl: number } | null;
  rarity: number;
  size: string;
  nocturnal: boolean;
  price: number;
  wild: number[]; // [min, max] wild level
  stats: {
    hp: number; atk: number; def: number;
    stamina: number; food: number;
    walk: number; run: number; sprint: number; transport: number;
  };
  work: Record<string, number>;
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
/** Best passives first (rank desc, then name) — for display. */
export const sortPassivesByRank = (ids: string[]): string[] =>
  [...ids].sort((a, b) => passiveRank(b) - passiveRank(a) || passiveName(a).localeCompare(passiveName(b)));
export const speciesName = (id: string): string => speciesById(id)?.name ?? id;
/** In-game rarity tier for badges. */
export const rarityInfo = (r: number): { label: string; cls: string } =>
  r >= 10 ? { label: `${r} Legendary`, cls: 'legendary' }
  : r >= 8 ? { label: `${r} Epic`, cls: 'epic' }
  : r >= 5 ? { label: `${r} Rare`, cls: 'rare' }
  : { label: `${r} Common`, cls: 'common' };
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

/** Every species this one can pair with, and the resulting child. */
export interface MateOption {
  mate: Species;
  child: string;
}
export function matesFor(speciesId: string, gender?: Gender | null): MateOption[] {
  const me = speciesById(speciesId);
  if (!me) return [];
  const otherGender: Gender | null = gender === 'Male' ? 'Female' : gender === 'Female' ? 'Male' : null;
  const out: MateOption[] = [];
  for (const s of species) {
    const child = childOf(me.id, s.id, gender ?? null, otherGender);
    if (child) out.push({ mate: s, child });
  }
  return out;
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
 * Passive-carrier chain: move a set of passives from an owned pal onto a
 * target species. Starts from every owned pal that has ALL desired passives,
 * then BFS over species — each step breeds the carrier lineage with an owned
 * species, and the child becomes the new carrier. Assumes the passives are
 * successfully inherited at every step (the per-egg odds are reported so the
 * UI can say how many eggs to expect).
 */
export interface PassiveStep extends BreedingStep {
  /** chance this step's egg inherits all desired passives, using the actual
      carrier/partner pals' passive pools */
  prob: number;
}

export interface PassivePlan {
  /** species the chain starts from */
  start: Species;
  /** owned pals of that species holding all desired passives */
  carriers: Pal[];
  steps: PassiveStep[];
  /** product of per-step probabilities */
  overall: number;
  /** expected number of eggs across the whole chain (sum of 1/p per step) */
  expectedEggs: number;
}

export interface PassiveRouteSet {
  /** every owned pal holding all desired passives (any species) */
  carriers: Pal[];
  /** fewest breeds — null when no carrier chain reaches the target */
  shortest: PassivePlan | null;
  /** fewer expected eggs via cleaner partners, when meaningfully better */
  cleanest: PassivePlan | null;
}

export function planPassiveRoutes(pals: Pal[], targetId: string, desired: string[]): PassiveRouteSet | null {
  const t = speciesById(targetId);
  if (!t || !desired.length) return null;
  const breedablePals = pals.filter(p => p.gender === 'Male' || p.gender === 'Female');
  const hasAll = (p: Pal) => desired.every(d => p.passives.some(x => x.toLowerCase() === d.toLowerCase()));
  const carriers = breedablePals.filter(hasAll);
  if (!carriers.length) return null;

  const palsBySpecies = new Map<string, Pal[]>();
  for (const p of breedablePals) {
    const id = speciesById(palSpeciesId(p))?.id;
    if (!id) continue;
    (palsBySpecies.get(id) ?? palsBySpecies.set(id, []).get(id)!).push(p);
  }
  const partnerSpecies = [...palsBySpecies.keys()];
  const carriersBySpecies = new Map<string, Pal[]>();
  for (const c of carriers) {
    const id = speciesById(palSpeciesId(c))!.id;
    (carriersBySpecies.get(id) ?? carriersBySpecies.set(id, []).get(id)!).push(c);
  }
  const startIds = [...carriersBySpecies.keys()];

  // best inherit chance for a step: pick the partner pal (of that species)
  // whose extra passives dilute the pool least
  const bestProb = (carrierPassives: string[], partnerId: string): number => {
    let best = 0;
    for (const q of palsBySpecies.get(partnerId) ?? []) {
      const pool = [...new Set([...carrierPassives, ...q.passives])];
      best = Math.max(best, passiveProbability(pool, desired));
    }
    return best;
  };
  // steps after the first assume you keep only eggs with exactly the wanted
  // passives, so the carrier pool is clean; the first step uses the actual pal
  const cleanProb = new Map<string, number>(partnerSpecies.map(o => [o, bestProb(desired, o)]));
  const startProb = (s: string, o: string): number =>
    Math.max(...carriersBySpecies.get(s)!.map(c => bestProb(c.passives, o)));
  const stepProb = (from: string, partner: string): number =>
    carriersBySpecies.has(from) ? startProb(from, partner) : cleanProb.get(partner) ?? 0;

  type Prev = Map<string, { from: string; partner: string }>;
  const makePlan = (prev: Prev): PassivePlan => {
    const raw: BreedingStep[] = [];
    let cur = t.id;
    while (prev.has(cur)) {
      const rec = prev.get(cur)!;
      raw.unshift({ parentA: rec.from, parentB: rec.partner, child: cur });
      cur = rec.from;
    }
    const start = speciesById(cur)!;
    const steps: PassiveStep[] = raw.map((s, i) => ({
      ...s,
      prob: i === 0 ? startProb(start.id, s.parentB) : cleanProb.get(s.parentB) ?? 0,
    }));
    return {
      start,
      carriers: carriersBySpecies.get(start.id) ?? [],
      steps,
      overall: steps.reduce((acc, s) => acc * s.prob, 1),
      expectedEggs: steps.reduce((acc, s) => acc + (s.prob > 0 ? 1 / s.prob : Infinity), 0),
    };
  };

  // --- fewest breeds: multi-source BFS over carrying species ---
  const dist = new Map<string, number>();
  const prevS: Prev = new Map();
  const queue: string[] = [];
  for (const s of startIds) { dist.set(s, 0); queue.push(s); }
  for (let qi = 0; qi < queue.length && !dist.has(t.id); qi++) {
    const cur = queue[qi];
    for (const o of partnerSpecies) {
      const child = childOf(cur, o);
      if (!child) continue;
      const c = speciesById(child)!.id;
      if (!dist.has(c)) {
        dist.set(c, dist.get(cur)! + 1);
        prevS.set(c, { from: cur, partner: o });
        queue.push(c);
      }
    }
  }
  if (!dist.has(t.id)) return { carriers, shortest: null, cleanest: null };
  const shortest = makePlan(prevS);

  // --- fewest expected eggs: Dijkstra, edge weight = 1 / inherit chance,
  //     choosing the cleanest partner for each step ---
  const cost = new Map<string, number>();
  const prevC: Prev = new Map();
  const done = new Set<string>();
  for (const s of startIds) cost.set(s, 0);
  for (;;) {
    let u: string | null = null;
    for (const [k, v] of cost) if (!done.has(k) && (u === null || v < cost.get(u)!)) u = k;
    if (u === null || u === t.id) break;
    done.add(u);
    for (const o of partnerSpecies) {
      const child = childOf(u, o);
      if (!child) continue;
      const c = speciesById(child)!.id;
      const p = stepProb(u, o);
      if (p <= 0) continue;
      const w = cost.get(u)! + 1 / p;
      if (w < (cost.get(c) ?? Infinity)) {
        cost.set(c, w);
        prevC.set(c, { from: u, partner: o });
      }
    }
  }
  let cleanest: PassivePlan | null = null;
  if (cost.has(t.id)) {
    const plan = makePlan(prevC);
    const differs = JSON.stringify(plan.steps.map(s => [s.parentA, s.parentB])) !==
      JSON.stringify(shortest.steps.map(s => [s.parentA, s.parentB]));
    // only worth showing when it actually saves an egg on average
    if (differs && plan.expectedEggs < shortest.expectedEggs - 0.5) cleanest = plan;
  }
  return { carriers, shortest, cleanest };
}

/**
 * Minimal-breed plan for a target from the owned set. Delegates to the same
 * cost-relaxation engine as the Coverage tab (`reachabilityMap`/`routeFor`) so
 * both views always agree on the route and its length. Returns null if the
 * target is unreachable; an empty step list means it's already owned.
 */
export function planBreeding(ownedSpeciesIds: string[], targetId: string): BreedingPlan | null {
  const s = speciesById(targetId);
  if (!s) return null;
  if (ownedSpeciesIds.some(o => o.toLowerCase() === s.id.toLowerCase()))
    return { steps: [], target: s.id };
  const reach = reachabilityMap(ownedSpeciesIds);
  if (!reach.depth.has(s.id)) return null;
  return { steps: routeFor(reach, s.id), target: s.id };
}
