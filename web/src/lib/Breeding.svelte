<script lang="ts">
  import type { Pal, Player } from './paltools';
  import {
    allSpecies, allPassives, speciesName, passiveName, palSpeciesId, speciesIcon,
    sortPassivesByRank,
    findPairs, planBreeding, planPassiveRoute,
    type BreedingPair, type BreedingPlan, type PassivePlan,
  } from './breeding';
  import Passive from './Passive.svelte';

  let { pals, players, targetId = $bindable(new URLSearchParams(location.search).get('target') ?? '') }:
    { pals: Pal[]; players: Player[]; targetId?: string } = $props();
  let targetQuery = $state('');
  // dev-only ?want=<id,id> preselects passives for screenshot tests
  let desired = $state<string[]>(
    import.meta.env.DEV ? new URLSearchParams(location.search).get('want')?.split(',').filter(Boolean) ?? [] : []);
  let passiveQuery = $state('');
  let maxRows = $state(100);

  const breedable = $derived(pals.filter(p => p.gender === 'Male' || p.gender === 'Female'));

  const ownedSpecies = $derived([...new Set(breedable.map(p => palSpeciesId(p)))]);

  const speciesOptions = $derived.by(() => {
    const q = targetQuery.trim().toLowerCase();
    const opts = allSpecies.filter(s => !q || s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
    return opts.slice(0, 30);
  });

  // passives present in the box are the interesting ones to plan with
  const boxPassives = $derived.by(() => {
    const present = new Set(breedable.flatMap(p => p.passives.map(x => x.toLowerCase())));
    return allPassives
      .filter(p => present.has(p.id.toLowerCase()))
      .filter(p => !passiveQuery || p.name.toLowerCase().includes(passiveQuery.toLowerCase()))
      .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
  });

  const pairs = $derived.by((): BreedingPair[] =>
    targetId ? findPairs(breedable, targetId, desired) : []);

  // with passives selected and no direct pair: chain the trait from a carrier
  const passivePlan = $derived.by((): PassivePlan | null =>
    targetId && desired.length && pairs.length === 0
      ? planPassiveRoute(breedable, targetId, desired) : null);

  const plan = $derived.by((): BreedingPlan | null =>
    targetId && !desired.length && pairs.length === 0 ? planBreeding(ownedSpecies, targetId) : null);


  function togglePassive(id: string) {
    desired = desired.includes(id)
      ? desired.filter(x => x !== id)
      : desired.length < 4 ? [...desired, id] : desired;
  }

  function ownerName(uid: string | null): string {
    if (!uid) return '—';
    return players.find(pl => pl.uid === uid)?.nickname ?? uid.slice(0, 8);
  }

  const pct = (x: number) => x >= 0.995 ? '100%' : (x * 100).toFixed(1) + '%';
  const palLabel = (p: Pal) =>
    `${speciesName(palSpeciesId(p))}${p.nickname ? ` “${p.nickname}”` : ''} Lv${p.level}`;
</script>

<div class="breeding">
  <section class="picker">
    <h3>Target pal</h3>
    <input type="search" placeholder="Search species…" bind:value={targetQuery} />
    <div class="chips">
      {#each speciesOptions as s (s.id)}
        <button class="chip" class:sel={targetId === s.id}
                class:owned={ownedSpecies.some(o => o.toLowerCase() === s.id.toLowerCase())}
                onclick={() => (targetId = targetId === s.id ? '' : s.id)}>
          <img class="palicon sm" src={speciesIcon(s.id)} alt="" loading="lazy" />
          {s.name}
        </button>
      {/each}
    </div>

    <h3>Wanted passives <span class="muted">({desired.length}/4 — from your box)</span></h3>
    <input type="search" placeholder="Filter passives…" bind:value={passiveQuery} />
    <div class="chips">
      {#each boxPassives as p (p.id)}
        <button class="pvbtn" class:sel={desired.includes(p.id)} title={p.desc ?? ''}
                onclick={() => togglePassive(p.id)}>
          <Passive id={p.id} />
        </button>
      {/each}
    </div>
    {#if desired.length}
      <p class="muted">
        Probability shown is the chance a single egg directly inherits all selected passives
        (random-roll bonuses not counted).
      </p>
    {/if}
  </section>

  <section class="results">
    {#if !targetId}
      <p class="muted">Pick a target species to see which of your {breedable.length} breedable pals can produce it.</p>
    {:else if pairs.length}
      <h3>
        {pairs.length} direct pairs →
        <img class="palicon" src={speciesIcon(targetId)} alt="" />
        {speciesName(targetId)}
      </h3>
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Father ♂</th><th>Mother ♀</th>
              <th>Combined passives</th>
              <th class="num">P(passives)</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {#each pairs.slice(0, maxRows) as pair}
              <tr>
                <td title={pair.father.passives.map(passiveName).join(', ')}>
                  <img class="palicon sm" src={speciesIcon(palSpeciesId(pair.father))} alt="" loading="lazy" />
                  {palLabel(pair.father)}
                </td>
                <td title={pair.mother.passives.map(passiveName).join(', ')}>
                  <img class="palicon sm" src={speciesIcon(palSpeciesId(pair.mother))} alt="" loading="lazy" />
                  {palLabel(pair.mother)}
                </td>
                <td class="small">
                  {#each sortPassivesByRank(pair.pool) as ps (ps)}<Passive id={ps} />{/each}
                  {#if !pair.pool.length}<span class="muted">—</span>{/if}
                </td>
                <td class="num">
                  {#if desired.length}
                    <span class:good={pair.probability >= 0.2}>{pct(pair.probability)}</span><span
                      class="meter" class:hi={pair.probability >= 0.2}><i style="width:{Math.round(pair.probability * 100)}%"></i></span>
                  {:else}—{/if}
                </td>
                <td class="muted">{ownerName(pair.father.ownerUid)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if pairs.length > maxRows}
        <button onclick={() => (maxRows += 200)}>Show more ({pairs.length - maxRows} hidden)</button>
      {/if}
    {:else if desired.length}
      {#if passivePlan && passivePlan.steps.length}
        <h3>
          Carry {desired.map(passiveName).join(' + ')} to
          <img class="palicon" src={speciesIcon(targetId)} alt="" />
          {speciesName(targetId)} — {passivePlan.steps.length} breeds
        </h3>
        <p class="carrier">
          Start from your
          <img class="palicon sm" src={speciesIcon(passivePlan.start.id)} alt="" />
          <strong>{passivePlan.start.name}</strong> with the passives:
          {passivePlan.carriers.map(palLabel).join(', ')}
        </p>
        <ol class="plan">
          {#each passivePlan.steps as step, i}
            <li>
              <span class="stepno">{i + 1}</span>
              <span class="pair">
                <img class="palicon sm" src={speciesIcon(step.parentA)} alt="" />
                {speciesName(step.parentA)} <span class="tagx">carrier</span>
                <span class="muted">+</span>
                <img class="palicon sm" src={speciesIcon(step.parentB)} alt="" />
                {speciesName(step.parentB)}
              </span>
              <span class="arrow">→</span>
              <img class="palicon sm" src={speciesIcon(step.child)} alt="" />
              <strong>{speciesName(step.child)}</strong>
              <span class="stepprob" class:good={step.prob >= 0.3}>{pct(step.prob)}</span>
            </li>
          {/each}
        </ol>
        <p class="muted">
          Per-step odds use your actual pals' passive pools (best partner of each species);
          keep only eggs that inherit {desired.length === 1 ? 'the passive' : 'all wanted passives'}
          before the next step. Whole chain ≈ <strong>{pct(passivePlan.overall)}</strong> straight
          through, or expect around <strong>{Math.ceil(passivePlan.expectedEggs)} eggs</strong> total
          when re-rolling each step. Each step assumes you can get the needed gender.
        </p>
      {:else if passivePlan}
        <h3>You already have it</h3>
        <p class="muted">
          You own {speciesName(targetId)} with
          {desired.map(passiveName).join(' + ')}: {passivePlan.carriers.map(palLabel).join(', ')}.
        </p>
      {:else}
        <h3>No carrier</h3>
        <p class="muted">
          None of your breedable pals has
          {desired.length === 1 ? '' : 'all of'} {desired.map(passiveName).join(' + ')}
          {desired.length === 1 ? '' : ' together'} — catch or breed one first
          {#if desired.length > 1}(or plan one passive at a time and combine){/if},
          or deselect the passive to see the species-level route.
        </p>
      {/if}
    {:else if plan && plan.steps.length === 0}
      <h3>Already owned</h3>
      <p class="muted">You already own {speciesName(targetId)} — select passives to plan
        moving a trait onto it, or check your pairs in the palbox.</p>
    {:else if plan}
      <h3>No direct pair — multi-step route ({plan.steps.length} steps)</h3>
      <ol class="plan">
        {#each plan.steps as step, i}
          <li>
            <span class="stepno">{i + 1}</span>
            <span class="pair">
              <img class="palicon sm" src={speciesIcon(step.parentA)} alt="" />
              {speciesName(step.parentA)} <span class="muted">+</span>
              <img class="palicon sm" src={speciesIcon(step.parentB)} alt="" />
              {speciesName(step.parentB)}
            </span>
            <span class="arrow">→</span>
            <img class="palicon sm" src={speciesIcon(step.child)} alt="" />
            <strong>{speciesName(step.child)}</strong>
          </li>
        {/each}
      </ol>
      <p class="muted">Species-level route from what you own; each step assumes you can get the bred pal in the needed gender.</p>
    {:else}
      <h3>Not reachable</h3>
      <p class="muted">
        {speciesName(targetId)} can't be bred from your current pals
        {#if desired.length}with those passives{/if}.
        It may be a self-pair-only species (legendaries breed only with themselves) — catch one first.
      </p>
    {/if}
  </section>
</div>

<style>
  .breeding { display: grid; grid-template-columns: 340px 1fr; gap: 20px; align-items: start; }
  @media (max-width: 900px) { .breeding { grid-template-columns: 1fr; } }
  .picker {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 16px;
    position: sticky; top: 0;
  }
  .picker h3 { margin: 14px 0 8px; font-size: 13px; }
  .picker h3:first-child { margin-top: 0; }
  .picker input { width: 100%; margin-bottom: 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; max-height: 220px; overflow-y: auto; }
  .chip {
    padding: 3px 11px 3px 5px; border-radius: 20px; font-size: 12px;
    background: var(--panel2); border: 1px solid var(--border);
    color: var(--text-2);
    display: inline-flex; align-items: center; gap: 6px;
  }
  .pair { display: inline-flex; align-items: center; gap: 6px; }
  .chip:hover { color: var(--text); }
  .chip.owned { border-color: var(--good); }
  .chip.sel { background: var(--accent); color: #fff; border-color: transparent; }
  .pvbtn { background: none; border: none; padding: 0; border-radius: 6px; }
  .pvbtn :global(.pv) { margin: 0; cursor: pointer; }
  .pvbtn:hover :global(.pv) { filter: brightness(1.18); }
  .pvbtn.sel { outline: 2px solid var(--accent); outline-offset: 1px; }
  .results h3 { margin-top: 0; }
  .tablewrap {
    overflow: auto; border: 1px solid var(--border);
    border-radius: var(--radius); max-height: 70vh;
  }
  .small { font-size: 12px; white-space: normal; max-width: 380px; }
  .good { color: var(--good); font-weight: 600; }
  .plan { list-style: none; padding: 0; margin: 0 0 12px; }
  .plan li {
    display: flex; align-items: center; gap: 10px;
    background: var(--panel); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 10px 14px; margin: 8px 0;
  }
  .stepno {
    flex: none; width: 22px; height: 22px; border-radius: 50%;
    background: var(--accent-soft); color: var(--accent);
    font-size: 12px; font-weight: 600;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .arrow { color: var(--muted); }
  .carrier { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .tagx {
    background: var(--accent-soft); color: var(--accent);
    border-radius: 5px; padding: 0 6px; font-size: 10.5px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .03em;
  }
  .stepprob { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
  .stepprob.good { color: var(--good); font-weight: 600; }
</style>
