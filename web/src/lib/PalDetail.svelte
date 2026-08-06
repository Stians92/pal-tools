<script lang="ts">
  import type { Pal, Player } from './paltools';
  import {
    speciesById, speciesName, speciesIcon, palSpeciesId, matesFor,
    sortPassivesByRank, rarityInfo, type Gender,
  } from './breeding';
  import Passive from './Passive.svelte';
  import SpeciesCard from './SpeciesCard.svelte';

  let { pal, pals, players, onclose, ongoto }: {
    pal: Pal; pals: Pal[]; players: Player[];
    onclose: () => void; ongoto?: (targetId: string) => void;
  } = $props();

  const sp = $derived(speciesById(palSpeciesId(pal)));
  const gender = $derived<Gender | null>(
    pal.gender === 'Male' || pal.gender === 'Female' ? pal.gender : null);
  const otherG = $derived<Gender | null>(
    gender === 'Male' ? 'Female' : gender === 'Female' ? 'Male' : null);

  const souls = $derived(pal.rankHp + pal.rankAttack + pal.rankDefence + pal.rankCraftSpeed);
  const ownerName = (uid: string | null) =>
    uid ? players.find(pl => pl.uid === uid)?.nickname ?? uid.slice(0, 8) : '—';

  const rarity = $derived(rarityInfo(sp?.rarity ?? 0));

  let mateQuery = $state('');
  let ownedOnly = $state(false);
  let newOnly = $state(false);

  const ownedSpecies = $derived(new Set(pals.map(p => palSpeciesId(p).toLowerCase())));
  // how many opposite-gender pals of each species the box holds
  const mateCounts = $derived.by(() => {
    const m = new Map<string, number>();
    for (const p of pals) {
      if (p.gender !== 'Male' && p.gender !== 'Female') continue;
      if (otherG && p.gender !== otherG) continue;
      const k = palSpeciesId(p).toLowerCase();
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  });

  const mates = $derived.by(() => {
    const q = mateQuery.trim().toLowerCase();
    return matesFor(palSpeciesId(pal), gender)
      .map(m => ({
        ...m,
        owned: mateCounts.get(m.mate.id.toLowerCase()) ?? 0,
        childNew: !ownedSpecies.has(m.child.toLowerCase()),
      }))
      .filter(m => !q || m.mate.name.toLowerCase().includes(q) || speciesName(m.child).toLowerCase().includes(q))
      .filter(m => !ownedOnly || m.owned > 0)
      .filter(m => !newOnly || m.childNew)
      .sort((a, b) => (b.owned > 0 ? 1 : 0) - (a.owned > 0 ? 1 : 0) || a.mate.name.localeCompare(b.mate.name));
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window {onkeydown} />

<div class="overlay" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}
     role="presentation">
  <div class="panel" role="dialog" aria-modal="true" aria-label={speciesName(pal.species)}>
    <button class="close" onclick={onclose} aria-label="Close">✕</button>

    <header>
      <img class="hero" src={speciesIcon(pal.species)} alt="" />
      <div class="title">
        <div class="dexno">No.{sp?.dex ?? '?'}</div>
        <h2>
          {speciesName(pal.species)}
          {#if pal.nickname}<span class="nick">“{pal.nickname}”</span>{/if}
        </h2>
        <div class="badges">
          <span class="badge {rarity.cls}">{rarity.label}</span>
          <span class="badge">Lv {pal.level}</span>
          <span class="badge" class:gm={gender === 'Male'} class:gf={gender === 'Female'}>
            {gender === 'Male' ? '♂ Male' : gender === 'Female' ? '♀ Female' : '— no gender'}
          </span>
          {#if pal.isAlpha}<span class="badge alpha">α Alpha</span>{/if}
          {#if pal.isLucky}<span class="badge lucky">✦ Lucky</span>{/if}
          {#if pal.isAwakened}<span class="badge awakened">❂ Awakened</span>{/if}
          {#if sp?.nocturnal}<span class="badge">🌙 Nocturnal</span>{/if}
          {#if sp}<span class="badge">Size {sp.size}</span>{/if}
          {#if sp && sp.wild[1] > 0}<span class="badge">Wild Lv {sp.wild[0]}–{sp.wild[1]}</span>{/if}
        </div>
      </div>
    </header>

    <div class="cols">
      <div class="left">
        <h3>This pal</h3>
        <div class="facts">
          <div class="fact"><span class="k">IV HP</span><span class="v">{pal.talentHp}</span></div>
          <div class="fact"><span class="k">IV Attack</span><span class="v">{pal.talentShot}</span></div>
          <div class="fact"><span class="k">IV Defense</span><span class="v">{pal.talentDefense}</span></div>
          <div class="fact"><span class="k">Souls</span><span class="v">{souls || '—'}</span></div>
          <div class="fact"><span class="k">Stars</span><span class="v">{pal.rank > 1 ? '★' + (pal.rank - 1) : '—'}</span></div>
          <div class="fact"><span class="k">Location</span><span class="v">{pal.where}</span></div>
          <div class="fact"><span class="k">Owner</span><span class="v">{ownerName(pal.ownerUid)}</span></div>
        </div>
        {#if pal.passives.length}
          <div class="pvrow">
            {#each sortPassivesByRank(pal.passives) as ps (ps)}<Passive id={ps} />{/each}
          </div>
        {/if}

        {#if sp}
          <SpeciesCard speciesId={sp.id} header={false} />
        {/if}
      </div>

      <div class="right">
        <h3>
          Potential mates <span class="muted">({mates.length})</span>
          {#if gender}<span class="muted">— pairs with {otherG === 'Male' ? '♂' : '♀'} partners</span>
          {:else}<span class="muted">— this pal has no gender and cannot breed</span>{/if}
        </h3>
        <div class="matefilters">
          <input type="search" placeholder="Filter by mate or child…" bind:value={mateQuery} />
          <label><input type="checkbox" bind:checked={ownedOnly} /> Owned mates</label>
          <label><input type="checkbox" bind:checked={newOnly} /> New children</label>
        </div>
        <div class="matelist">
          {#each mates as m (m.mate.id)}
            <div class="mate" class:unowned={m.owned === 0}>
              <span class="who">
                <img class="palicon sm" src={speciesIcon(m.mate.id)} alt="" loading="lazy" />
                <span class="mname">{m.mate.name}</span>
                {#if m.owned > 0}
                  <span class="count">{otherG === 'Male' ? '♂' : otherG === 'Female' ? '♀' : ''}×{m.owned}</span>
                {:else}
                  <span class="count none">not owned</span>
                {/if}
              </span>
              <span class="arrow">→</span>
              <button class="child" title="Open in breeding planner"
                      onclick={() => ongoto?.(m.child)}>
                <img class="palicon sm" src={speciesIcon(m.child)} alt="" loading="lazy" />
                {speciesName(m.child)}
                {#if m.childNew}<span class="new">NEW</span>{/if}
              </button>
            </div>
          {:else}
            <p class="muted">No mates match the filters.</p>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 100;
    background: rgba(0, 0, 0, 0.55);
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  .panel {
    position: relative;
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 14px; box-shadow: var(--shadow);
    width: min(1060px, 100%); max-height: min(860px, 100%);
    display: flex; flex-direction: column;
    padding: 20px 22px;
  }
  .close {
    position: absolute; top: 12px; right: 12px;
    background: none; border: none; color: var(--muted); font-size: 15px;
    padding: 6px 9px;
  }
  .close:hover { color: var(--text); }

  header { display: flex; gap: 16px; align-items: center; flex: none; margin-bottom: 6px; }
  .hero {
    width: 72px; height: 72px; border-radius: 50%; object-fit: cover;
    background: var(--panel2); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    flex: none;
  }
  .dexno { color: var(--muted); font-size: 12px; }
  h2 { margin: 0 0 6px; font-size: 20px; line-height: 1.2; }
  .nick { color: var(--accent2); font-weight: 400; font-size: 15px; }
  .badges { display: flex; flex-wrap: wrap; gap: 6px; }
  .badge {
    background: var(--panel2); border: 1px solid var(--border-soft);
    border-radius: 20px; padding: 1px 10px; font-size: 11.5px; color: var(--text-2);
  }
  .badge.gm { color: var(--accent); }
  .badge.gf { color: #f78ab0; }
  .badge.alpha { background: #7e2743; color: #ffd9e2; border-color: transparent; }
  .badge.lucky { background: #8a6510; color: #ffe9b3; border-color: transparent; }
  .badge.awakened { background: #5b3d8f; color: #e6d5ff; border-color: transparent; }
  .badge.common { color: var(--text-2); }
  .badge.rare { color: #6db9ff; border-color: #2c5b86; }
  .badge.epic { color: #c49bff; border-color: #5d3f8f; }
  .badge.legendary { color: #ffd257; border-color: #8a6510; }

  .cols {
    display: grid; grid-template-columns: 340px 1fr; gap: 22px;
    flex: 1; min-height: 0;
  }
  @media (max-width: 860px) { .cols { grid-template-columns: 1fr; overflow-y: auto; } }
  .left { overflow-y: auto; min-height: 0; padding-right: 4px; }
  .right { display: flex; flex-direction: column; min-height: 0; }
  h3 { font-size: 13px; margin: 14px 0 8px; }
  .left h3:first-child { margin-top: 8px; }

  .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; margin-bottom: 8px; }
  .fact { display: flex; justify-content: space-between; font-size: 12.5px; padding: 3px 0; border-bottom: 1px solid var(--border-soft); }
  .fact .k { color: var(--muted); }
  .pvrow { display: flex; flex-wrap: wrap; margin-top: 6px; }

  .matefilters { display: flex; gap: 12px; align-items: center; flex: none; margin-bottom: 8px; }
  .matefilters input[type='search'] { flex: 1; min-width: 120px; }
  .matefilters label { font-size: 12.5px; white-space: nowrap; }
  .matelist {
    flex: 1; min-height: 0; overflow-y: auto;
    border: 1px solid var(--border-soft); border-radius: var(--radius);
    background: var(--bg);
  }
  .mate {
    display: flex; align-items: center; gap: 10px;
    padding: 6px 12px; border-bottom: 1px solid var(--border-soft);
    font-size: 13px;
  }
  .mate .who { display: inline-flex; align-items: center; gap: 7px; flex: 1; min-width: 0; }
  .mate.unowned .mname { color: var(--muted); }
  .count { color: var(--good); font-size: 11.5px; }
  .count.none { color: var(--muted); }
  .arrow { color: var(--muted); flex: none; }
  .child {
    display: inline-flex; align-items: center; gap: 7px;
    background: none; border: none; padding: 3px 8px; border-radius: 8px;
    color: var(--text); font-size: 13px;
    flex: 1; min-width: 0; justify-content: flex-start; text-align: left;
  }
  .child:hover { background: var(--accent-soft); border-color: transparent; }
  .new {
    background: var(--good-soft); color: var(--good);
    border-radius: 5px; padding: 0 6px; font-size: 10.5px; font-weight: 700;
  }
  .muted { color: var(--muted); font-weight: 400; }
</style>
