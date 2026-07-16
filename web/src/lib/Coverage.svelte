<script lang="ts">
  import type { Pal } from './paltools';
  import {
    allSpecies, speciesName, palSpeciesId, speciesIcon, reachabilityMap, routeFor,
    type Reachability,
  } from './breeding';

  let { pals, ongoto }: { pals: Pal[]; ongoto: (targetId: string) => void } = $props();

  let search = $state('');
  let showOwned = $state(false);
  let selected = $state('');

  const breedable = $derived(pals.filter(p => p.gender === 'Male' || p.gender === 'Female'));
  const ownedIds = $derived([...new Set(breedable.map(p => palSpeciesId(p)))]);

  const reach = $derived.by((): Reachability => reachabilityMap(ownedIds));

  interface Tier { depth: number; label: string; items: { id: string; name: string; dex: number }[] }

  const tiers = $derived.by((): Tier[] => {
    const q = search.trim().toLowerCase();
    const byDepth = new Map<number, Tier['items']>();
    const unreachable: Tier['items'] = [];
    for (const s of allSpecies) {
      if (q && !s.name.toLowerCase().includes(q) && !s.id.toLowerCase().includes(q)) continue;
      const d = reach.depth.get(s.id);
      const item = { id: s.id, name: s.name, dex: s.dex };
      if (d === undefined) unreachable.push(item);
      else {
        if (d === 0 && !showOwned) continue;
        (byDepth.get(d) ?? byDepth.set(d, []).get(d)!).push(item);
      }
    }
    const out: Tier[] = [];
    for (const d of [...byDepth.keys()].sort((a, b) => a - b)) {
      out.push({
        depth: d,
        label: d === 0 ? 'Owned' : d === 1 ? 'Breedable right away (1 breed)' : `${d} breeds needed`,
        items: byDepth.get(d)!.sort((a, b) => a.dex - b.dex),
      });
    }
    if (unreachable.length)
      out.push({ depth: -1, label: 'Not breedable from your box — catch or hatch first', items: unreachable.sort((a, b) => a.dex - b.dex) });
    return out;
  });

  const summary = $derived.by(() => {
    let owned = 0, reachable = 0, unreachable = 0;
    for (const s of allSpecies) {
      const d = reach.depth.get(s.id);
      if (d === 0) owned++;
      else if (d !== undefined) reachable++;
      else unreachable++;
    }
    return { owned, reachable, unreachable, total: allSpecies.length };
  });

  const selectedRoute = $derived(selected ? routeFor(reach, selected) : []);

  function tierColor(depth: number): string {
    if (depth === 0) return 'var(--muted)';
    if (depth < 0) return 'var(--bad)';
    return 'var(--accent)';
  }
</script>

<div class="coverage">
  <div class="head">
    <div class="bar" role="img"
         aria-label={`${summary.owned} owned, ${summary.reachable} breedable, ${summary.unreachable} not breedable of ${summary.total}`}>
      <i class="own" style="width:{(summary.owned / summary.total) * 100}%"></i>
      <i class="reach" style="width:{(summary.reachable / summary.total) * 100}%"></i>
    </div>
    <div class="legend">
      <span><i class="dot own"></i>{summary.owned} owned</span>
      <span><i class="dot reach"></i>{summary.reachable} breedable from your box</span>
      <span><i class="dot none"></i>{summary.unreachable} catch-only</span>
      <span class="muted">of {summary.total} species</span>
    </div>
    <div class="controls">
      <input type="search" placeholder="Search species…" bind:value={search} />
      <label><input type="checkbox" bind:checked={showOwned} /> Show owned</label>
    </div>
  </div>

  {#each tiers as tier (tier.depth)}
    <section>
      <h3>
        <span class="tiermark" style="background:{tierColor(tier.depth)}"></span>
        {tier.label} <span class="muted">({tier.items.length})</span>
      </h3>
      <div class="chips">
        {#each tier.items as it (it.id)}
          <button class="chip" class:sel={selected === it.id}
                  onclick={() => (selected = selected === it.id ? '' : it.id)}>
            <img class="palicon sm" src={speciesIcon(it.id)} alt="" loading="lazy" />
            <span class="dex">#{it.dex}</span>{it.name}
          </button>
        {/each}
      </div>
      {#if selected && tier.items.some(i => i.id === selected)}
        <div class="detail">
          {#if selectedRoute.length}
            <ol class="route">
              {#each selectedRoute as step, i}
                <li>
                  <span class="stepno">{i + 1}</span>
                  <img class="palicon sm" src={speciesIcon(step.parentA)} alt="" />
                  {speciesName(step.parentA)} <span class="muted">+</span>
                  <img class="palicon sm" src={speciesIcon(step.parentB)} alt="" />
                  {speciesName(step.parentB)}
                  <span class="muted">→</span>
                  <img class="palicon sm" src={speciesIcon(step.child)} alt="" />
                  <strong>{speciesName(step.child)}</strong>
                </li>
              {/each}
            </ol>
          {:else if tier.depth < 0}
            <p class="muted">No route from your current pals — this species must be caught,
              or breeds only with itself (legendaries).</p>
          {:else}
            <p class="muted">You already own {speciesName(selected)}.</p>
          {/if}
          {#if tier.depth >= 1}
            <button class="primary" onclick={() => ongoto(selected)}>
              Open in breeding planner →
            </button>
          {/if}
        </div>
      {/if}
    </section>
  {/each}
</div>

<style>
  .head {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 14px 16px; margin-bottom: 18px;
  }
  .bar {
    display: flex; height: 10px; border-radius: 5px; overflow: hidden;
    background: var(--panel2); border: 1px solid var(--border-soft);
  }
  .bar i.own { background: var(--good); }
  .bar i.reach { background: var(--accent); }
  .legend { display: flex; gap: 18px; flex-wrap: wrap; margin: 10px 0 12px; font-size: 12.5px; color: var(--text-2); }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; }
  .dot.own { background: var(--good); }
  .dot.reach { background: var(--accent); }
  .dot.none { background: var(--panel2); border: 1px solid var(--border); }
  .controls { display: flex; gap: 12px; align-items: center; }
  .controls input[type='search'] { flex: 1; max-width: 320px; }

  section { margin-bottom: 22px; }
  section h3 { display: flex; align-items: center; gap: 8px; font-size: 14px; margin: 0 0 10px; }
  .tiermark { width: 4px; height: 16px; border-radius: 2px; display: inline-block; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    padding: 4px 12px 4px 5px; border-radius: 20px; font-size: 12.5px;
    background: var(--panel); border: 1px solid var(--border); color: var(--text-2);
    display: inline-flex; align-items: center; gap: 6px;
  }
  .chip:hover { color: var(--text); border-color: var(--accent); }
  .chip.sel { background: var(--accent); color: #fff; border-color: transparent; }
  .chip.sel .dex { color: rgba(255,255,255,.7); }
  .dex { color: var(--muted); font-size: 11px; margin-right: 6px; }

  .detail {
    margin-top: 12px; background: var(--panel); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 12px 16px;
  }
  .route { list-style: none; padding: 0; margin: 0 0 10px; }
  .route li { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
  .stepno {
    flex: none; width: 20px; height: 20px; border-radius: 50%;
    background: var(--accent-soft); color: var(--accent);
    font-size: 11px; font-weight: 600;
    display: inline-flex; align-items: center; justify-content: center;
  }
</style>
