<script lang="ts" module>
  import { allSpecies } from './breeding';

  // bar scaling: max of each stat across all species (computed once per app)
  const statMax: Record<string, number> = {};
  for (const s of allSpecies) {
    for (const [k, v] of Object.entries(s.stats)) statMax[k] = Math.max(statMax[k] ?? 0, v);
  }
  statMax.price = Math.max(...allSpecies.map(s => s.price));

  const STAT_ROWS: [string, string][] = [
    ['hp', 'HP'], ['atk', 'Attack'], ['def', 'Defense'],
    ['stamina', 'Stamina'], ['run', 'Running speed'], ['sprint', 'Sprinting speed'],
  ];
  const WORK_ICON: Record<string, string> = {
    Kindling: '🔥', Watering: '💧', Planting: '🌱', GenerateElectricity: '⚡',
    Handiwork: '🛠️', Gathering: '🧺', Lumbering: '🪓', Mining: '⛏️',
    MedicineProduction: '💊', Cooling: '❄️', Transporting: '📦', Farming: '🧑‍🌾',
  };
  const WORK_LABEL: Record<string, string> = {
    GenerateElectricity: 'Electricity', MedicineProduction: 'Medicine',
  };
  import { EL_COLOR, EL_ICON } from './elements';

  const GEAR_ICON: Record<string, string> = {
    Saddle: '🐎', Harness: '🪂', Gloves: '🧤', Choker: '📿', Headband: '🎽',
    SMG: '🔫', Shotgun: '🔫', Minigun: '🔫', 'Assault rifle': '🔫',
    'Grenade launcher': '💣', 'Missile launcher': '🚀', Launcher: '🚀', Hammer: '🔨',
  };
</script>

<script lang="ts">
  import { speciesById, speciesIcon, rarityInfo, sortPassivesByRank } from './breeding';
  import Passive from './Passive.svelte';

  let { speciesId, header = true }: { speciesId: string; header?: boolean } = $props();

  const sp = $derived(speciesById(speciesId));
  const rarity = $derived(rarityInfo(sp?.rarity ?? 0));
  const statVal = (k: string): number => (sp?.stats as unknown as Record<string, number>)?.[k] ?? 0;
</script>

{#if sp}
  <div class="card">
    {#if header}
      <div class="chead">
        <img class="cicon" src={speciesIcon(sp.id)} alt="" />
        <div>
          <div class="cname"><span class="dexno">No.{sp.dex}</span> {sp.name}</div>
          <div class="badges">
            <span class="badge {rarity.cls}">{rarity.label}</span>
            {#if sp.nocturnal}<span class="badge">🌙 Nocturnal</span>{/if}
            <span class="badge">Size {sp.size}</span>
            {#if sp.wild[1] > 0}<span class="badge">Wild Lv {sp.wild[0]}–{sp.wild[1]}</span>{/if}
            <span class="badge">♂ {Math.round(sp.male * 100)}%</span>
          </div>
        </div>
      </div>
    {/if}

    <div class="els">
      {#each sp.els as el}
        <span class="el" style="--elc:{EL_COLOR[el] ?? 'var(--muted)'}">{EL_ICON[el] ?? ''} {el}</span>
      {/each}
      {#if sp.gear}
        <span class="gear" title="Partner gear technology unlock">
          {GEAR_ICON[sp.gear.kind] ?? '🛠'} {sp.gear.kind} <b>Lv {sp.gear.lvl}</b>
        </span>
      {/if}
    </div>

    <h4>Species stats</h4>
    <div class="stats">
      {#each STAT_ROWS as [k, label]}
        <div class="srow">
          <span class="sl">{label}</span>
          <span class="sbar"><i style="width:{Math.round(statVal(k) / (statMax[k] || 1) * 100)}%"></i></span>
          <span class="sv">{statVal(k)}</span>
        </div>
      {/each}
      <div class="srow">
        <span class="sl">Price</span>
        <span class="sbar"><i style="width:{Math.round(sp.price / statMax.price * 100)}%"></i></span>
        <span class="sv">{sp.price}</span>
      </div>
      <div class="srow">
        <span class="sl">Food</span>
        <span class="sbar food">{'🍗'.repeat(Math.min(sp.stats.food, 9))}</span>
        <span class="sv">{sp.stats.food}</span>
      </div>
    </div>

    {#if Object.keys(sp.work).length}
      <h4>Work suitability</h4>
      <div class="work">
        {#each Object.entries(sp.work) as [w, lv]}
          <span class="wchip">{WORK_ICON[w] ?? ''} {WORK_LABEL[w] ?? w} <b>Lv {lv}</b></span>
        {/each}
      </div>
    {/if}

    {#if sp.guaranteed.length}
      <h4>Guaranteed passives</h4>
      <div class="pvrow">
        {#each sortPassivesByRank(sp.guaranteed) as ps (ps)}<Passive id={ps} />{/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .chead { display: flex; gap: 12px; align-items: center; margin-bottom: 4px; }
  .cicon {
    width: 46px; height: 46px; border-radius: 50%; object-fit: cover;
    background: var(--panel2); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    flex: none;
  }
  .cname { font-weight: 600; margin-bottom: 4px; }
  .dexno { color: var(--muted); font-weight: 400; font-size: 12px; }
  .badges { display: flex; flex-wrap: wrap; gap: 5px; }
  .badge {
    background: var(--panel2); border: 1px solid var(--border-soft);
    border-radius: 20px; padding: 0 9px; font-size: 11px; color: var(--text-2);
  }
  .badge.rare { color: #6db9ff; border-color: #2c5b86; }
  .badge.epic { color: #c49bff; border-color: #5d3f8f; }
  .badge.legendary { color: #ffd257; border-color: #8a6510; }
  :global([data-theme='light']) .badge.rare { color: #1a73c7; border-color: #9cc4e8; }
  :global([data-theme='light']) .badge.epic { color: #7d5bbf; border-color: #c9b5ee; }
  :global([data-theme='light']) .badge.legendary { color: #a8730a; border-color: #dcc189; }

  .els { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .el {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 2px 11px; border-radius: 20px; font-size: 12px; font-weight: 600;
    color: var(--elc);
    background: color-mix(in srgb, var(--elc) 13%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--elc) 40%, transparent);
  }

  .gear {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 2px 11px; border-radius: 20px; font-size: 12px;
    color: var(--text-2);
    background: var(--panel2);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .gear b { color: var(--text); font-weight: 600; }

  h4 { font-size: 12.5px; margin: 12px 0 7px; color: var(--text); }
  .stats { display: flex; flex-direction: column; gap: 5px; }
  .srow { display: grid; grid-template-columns: 105px 1fr 48px; align-items: center; gap: 8px; font-size: 12.5px; }
  .sl { color: var(--text-2); }
  .sv { text-align: right; font-variant-numeric: tabular-nums; }
  .sbar { height: 6px; border-radius: 3px; background: var(--meter-track); overflow: hidden; }
  .sbar > i { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
  .sbar.food { background: none; height: auto; font-size: 11px; letter-spacing: 1px; }

  .work { display: flex; flex-wrap: wrap; gap: 6px; }
  .wchip {
    background: var(--panel2); border: 1px solid var(--border-soft); border-radius: 8px;
    padding: 3px 10px; font-size: 12px; color: var(--text-2);
  }
  .wchip b { color: var(--text); font-weight: 600; }
  .pvrow { display: flex; flex-wrap: wrap; }
</style>
