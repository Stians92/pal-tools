// Builds web/src/data/breeding-data.json from the vendored palcalc extracts
// (data/vendor/palcalc_db.json + palcalc_breeding.json, MIT, 1.0-rebalanced).
//
// The game's breeding rules: same-species → same species; gendered combos
// (2 rows); unique combos (child unreachable via formula); otherwise
// child = candidate with CombiRank closest to floor((rA+rB+1)/2), candidates
// excluding unique-combo children, ties broken by higher CombiDuplicatePriority
// then non-variant. We derive the unique-combo set by fixpoint against the
// fully-materialized 44,851-row oracle table, then verify the compact ruleset
// reproduces the oracle exactly.

'use strict';
const fs = require('fs');
const path = require('path');

const vendor = path.join(__dirname, '..', 'data', 'vendor');
const db = JSON.parse(fs.readFileSync(path.join(vendor, 'palcalc_db.json'), 'utf8'));
const breeding = JSON.parse(fs.readFileSync(path.join(vendor, 'palcalc_breeding.json'), 'utf8'));
// element types per species (palcalc's db has none) — from oMaN-Rod/palworld-save-pal (MIT)
const pspPals = JSON.parse(fs.readFileSync(path.join(vendor, 'psp_pals.json'), 'utf8'));
const pspByLower = new Map(Object.keys(pspPals).map(k => [k.toLowerCase(), pspPals[k]]));
const EL_NAME = { Normal: 'Neutral', Leaf: 'Grass', Earth: 'Ground', Electricity: 'Electric' };
function elementsOf(internalName) {
  const els = pspByLower.get(internalName.toLowerCase())?.element_types;
  if (!els || !els.length) { console.warn(`no element types for ${internalName}`); return []; }
  return els.map(e => EL_NAME[e] ?? e);
}

// --- species table ---
const species = db.Pals.map(p => ({
  id: p.InternalName,
  name: p.Name,
  dex: p.Id.PalDexNo,
  variant: p.Id.IsVariant,
  rank: p.BreedingPower,
  prio: p.BreedingPowerPriority,
  male: db.BreedingGenderProbability[p.InternalName]?.MALE ?? 0.5,
  guaranteed: p.GuaranteedPassivesInternalIds || [],
  // species stats for the detail view
  els: elementsOf(p.InternalName),
  rarity: p.Rarity,
  size: p.Size,
  nocturnal: p.Nocturnal,
  price: p.Price,
  wild: [p.MinWildLevel, p.MaxWildLevel],
  stats: {
    hp: p.Hp, atk: p.Attack, def: p.Defense,
    stamina: p.Stamina, food: p.FoodAmount,
    walk: p.WalkSpeed, run: p.RunSpeed, sprint: p.RideSprintSpeed, transport: p.TransportSpeed,
  },
  work: Object.fromEntries(Object.entries(p.WorkSuitability || {}).filter(([, v]) => v > 0)),
})).sort((a, b) => a.dex - b.dex || (a.variant ? 1 : -1));

const byId = new Map(species.map(s => [s.id, s]));

// --- oracle rows ---
const rows = breeding.Breeding;
const crossRows = rows.filter(r =>
  r.Parent1InternalName !== r.Parent2InternalName &&
  r.Parent1Gender === 'WILDCARD' && r.Parent2Gender === 'WILDCARD');
const genderedRows = rows.filter(r => r.Parent1Gender !== 'WILDCARD' || r.Parent2Gender !== 'WILDCARD');

// --- formula ---
function makeFormula(excluded) {
  const candidates = species.filter(s => !excluded.has(s.id));
  return (a, b) => {
    const target = Math.floor((byId.get(a).rank + byId.get(b).rank + 1) / 2);
    let best = null, bestDist = Infinity;
    for (const c of candidates) {
      const d = Math.abs(c.rank - target);
      if (d < bestDist) { best = c; bestDist = d; }
      else if (d === bestDist && best) {
        if (c.prio > best.prio || (c.prio === best.prio && best.variant && !c.variant)) best = c;
      }
    }
    return best.id;
  };
}

// --- derive unique-combo children (excluded from formula candidates) ---
// Unique-combo children appear as a cross-pair child at most a few times (their
// recipe rows); formula-producible species appear for a whole band of rank
// targets (dozens to thousands of pairs). Start from that split, then refine:
// a wrongly-excluded species causes many mismatches with itself as oracle
// child (remove it); a wrongly-included one causes mismatches where the
// formula picks it but the oracle disagrees (add it).
const childCounts = new Map();
for (const r of crossRows) childCounts.set(r.ChildInternalName, (childCounts.get(r.ChildInternalName) || 0) + 1);
let excluded = new Set(species.filter(s => (childCounts.get(s.id) || 0) <= 3).map(s => s.id));

for (let iter = 0; iter < 20; iter++) {
  const formula = makeFormula(excluded);
  const oracleMismatch = new Map(); // child -> count of rows where oracle says child but formula disagrees
  const formulaMismatch = new Map(); // child -> count of rows where formula says child but oracle disagrees
  for (const r of crossRows) {
    const got = formula(r.Parent1InternalName, r.Parent2InternalName);
    if (got !== r.ChildInternalName) {
      oracleMismatch.set(r.ChildInternalName, (oracleMismatch.get(r.ChildInternalName) || 0) + 1);
      formulaMismatch.set(got, (formulaMismatch.get(got) || 0) + 1);
    }
  }
  let changed = false;
  for (const [child, n] of oracleMismatch) {
    // oracle produces this child from many pairs but formula can't → it's a
    // formula child that we wrongly excluded (recipe rows are ≤3 per child)
    if (excluded.has(child) && n > 3) { excluded.delete(child); changed = true; }
  }
  for (const [child, n] of formulaMismatch) {
    // formula picks this child but the oracle never produces it from any
    // cross pair → the species must be unreachable via formula
    if (!excluded.has(child) && n > 0 && (childCounts.get(child) || 0) === 0) {
      excluded.add(child); changed = true;
    }
  }
  if (!changed) break;
}
console.log(`excluded (unique-combo + self-only children): ${excluded.size}`);

// --- unique combos = remaining mismatch rows ---
const formula = makeFormula(excluded);
const uniqueCombos = [];
for (const r of crossRows) {
  if (formula(r.Parent1InternalName, r.Parent2InternalName) !== r.ChildInternalName) {
    uniqueCombos.push({ a: r.Parent1InternalName, b: r.Parent2InternalName, child: r.ChildInternalName });
  }
}
const genderedCombos = genderedRows.map(r => ({
  a: r.Parent1InternalName, ga: r.Parent1Gender,
  b: r.Parent2InternalName, gb: r.Parent2Gender,
  child: r.ChildInternalName,
}));
console.log(`unique combos: ${uniqueCombos.length}, gendered: ${genderedCombos.length}`);

// --- full validation against the oracle ---
const comboKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
const comboMap = new Map(uniqueCombos.map(c => [comboKey(c.a, c.b), c.child]));
function predict(a, b, ga, gb) {
  if (a === b) return a;
  for (const g of genderedCombos) {
    if ((g.a === a && g.ga === ga && g.b === b && g.gb === gb) ||
        (g.a === b && g.ga === gb && g.b === a && g.gb === ga)) return g.child;
  }
  const u = comboMap.get(comboKey(a, b));
  if (u) return u;
  return formula(a, b);
}

let mismatches = 0;
for (const r of rows) {
  const got = predict(r.Parent1InternalName, r.Parent2InternalName, r.Parent1Gender, r.Parent2Gender);
  if (got !== r.ChildInternalName) {
    if (mismatches < 10)
      console.log(`MISMATCH: ${r.Parent1InternalName} + ${r.Parent2InternalName} => oracle ${r.ChildInternalName}, got ${got}`);
    mismatches++;
  }
}
console.log(`validation: ${rows.length} rows, ${mismatches} mismatches`);
if (mismatches > 0) { console.error('VALIDATION FAILED'); process.exit(1); }

// --- passives ---
const passives = db.PassiveSkills
  .filter(p => p.Name)
  .map(p => ({
    id: p.InternalName,
    name: p.Name,
    rank: p.Rank,
    std: !!p.IsStandardPassiveSkill,
    rnd: !!p.RandomInheritanceAllowed,
    w: p.RandomInheritanceWeight ?? 0,
    desc: p.IsStandardPassiveSkill ? (p.Description || '') : undefined,
  }));

// --- emit ---
const out = {
  meta: {
    source: 'tylercamp/palcalc (MIT), game data v1.0 rebalance',
    dbVersion: db.Version ?? null,
    built: new Date().toISOString(),
    oracleRows: rows.length,
  },
  species,
  excluded: [...excluded].sort(),
  uniqueCombos,
  genderedCombos,
  passives,
  inheritance: {
    // P(inherit exactly N passives from parent pool), N=1..4
    fromParents: [0.4, 0.3, 0.2, 0.1],
    // P(N random passives added), N=0..4
    random: [0.4, 0.3, 0.2, 0.1, 0],
    maxPassives: 4,
    // P(inherit exactly N IVs from parents), N=1..3
    ivs: [0.5, 0.25, 0.25],
  },
};

const outPath = path.join(__dirname, '..', 'web', 'src', 'data', 'breeding-data.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
