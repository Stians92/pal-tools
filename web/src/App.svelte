<script lang="ts">
  import SaveLoader from './lib/SaveLoader.svelte';
  import PalTable from './lib/PalTable.svelte';
  import Breeding from './lib/Breeding.svelte';
  import Coverage from './lib/Coverage.svelte';
  import MapView from './lib/MapView.svelte';
  import type { LoadedSave } from './lib/paltools';

  type Tab = 'palbox' | 'breeding' | 'coverage' | 'map';
  const urlTab = new URLSearchParams(location.search).get('tab');
  let save = $state<LoadedSave | null>(null);
  let tab = $state<Tab>(urlTab === 'breeding' || urlTab === 'coverage' || urlTab === 'map' ? urlTab : 'palbox');
  // Tabs stay mounted once visited (hidden, not destroyed) so their local
  // state — search fields, selected passives, map position — survives
  // switching tabs. A reload still starts fresh.
  let visited = $state<Record<Tab, boolean>>({ palbox: false, breeding: false, coverage: false, map: false });
  $effect(() => { visited[tab] = true; });
  let breedTarget = $state(new URLSearchParams(location.search).get('target') ?? '');
  let ownerFilter = $state('');

  let theme = $state(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('paltools-theme', theme);
  }

  // owners present on pals, labeled with player names when known
  const owners = $derived.by(() => {
    if (!save) return [];
    const uids = [...new Set(save.world.pals.map(p => p.ownerUid).filter((x): x is string => !!x))];
    return uids.map(uid => ({
      uid,
      name: save!.world.players.find(pl => pl.uid === uid)?.nickname ?? uid.slice(0, 8),
    }));
  });

  // pals scoped to the selected owner — used by Breeding and Coverage, where
  // "what can I breed" depends on whose pals count as available
  const scopedPals = $derived.by(() => {
    if (!save) return [];
    if (!ownerFilter) return save.world.pals;
    return save.world.pals.filter(p => p.ownerUid === ownerFilter);
  });

  const stats = $derived.by(() => {
    if (!save) return [];
    const pals = save.world.pals;
    const count = (w: string) => pals.filter(p => p.where === w).length;
    const dps = count('dps');
    return [
      ['Total pals', pals.length],
      ['In palbox', count('palbox')],
      ['In parties', count('party')],
      ['At bases', count('base/other')],
      ...(dps ? [['Dim. storage', dps] as [string, number]] : []),
      ['Species', new Set(pals.map(p => p.species)).size],
      ['Alphas', pals.filter(p => p.isAlpha).length],
      ['Lucky', pals.filter(p => p.isLucky).length],
      ['Players', save.world.players.length],
    ] as [string, number][];
  });
</script>

<header>
  <div class="brand">
    <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2C8 2 4.5 7.5 4.5 13a7.5 7.5 0 0 0 15 0C19.5 7.5 16 2 12 2Z"
            fill="none" stroke="currentColor" stroke-width="1.8"/>
      <path d="M8.2 12.2l2.4 2.2 5.2-4.8" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <div>
      <h1>Pal Tools</h1>
      <span class="sub">Palbox &amp; breeding calculator · everything stays on your machine</span>
    </div>
  </div>
  <nav>
    {#if save}
      <button class:active={tab === 'palbox'} onclick={() => (tab = 'palbox')}>Palbox</button>
      <button class:active={tab === 'breeding'} onclick={() => (tab = 'breeding')}>Breeding</button>
      <button class:active={tab === 'coverage'} onclick={() => (tab = 'coverage')}>Coverage</button>
      <button class:active={tab === 'map'} onclick={() => (tab = 'map')}>Map</button>
      <button class="ghost" onclick={() => (save = null)}>Load another save</button>
    {/if}
    <button class="themebtn" onclick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
      {#if theme === 'dark'}
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      {:else}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
      {/if}
    </button>
  </nav>
</header>

<main>
  {#if !save}
    <SaveLoader onloaded={(s) => (save = s)} />
  {:else}
    <div class="summary">
      {#each stats as [label, n]}
        <div class="stat"><div class="n">{n}</div><div class="l">{label}</div></div>
      {/each}
      {#if (tab === 'breeding' || tab === 'coverage') && owners.length > 1}
        <div class="stat ownerpick">
          <label for="ownersel" class="l">Breed with pals of</label>
          <select id="ownersel" bind:value={ownerFilter}>
            <option value="">Everyone (shared box)</option>
            {#each owners as o (o.uid)}
              <option value={o.uid}>{o.name}</option>
            {/each}
          </select>
        </div>
      {/if}
    </div>
    {#if visited.palbox}
      <div class="pane" style:display={tab === 'palbox' ? 'contents' : 'none'}>
        <PalTable pals={save.world.pals} players={save.world.players}
                  ongoto={(id) => { breedTarget = id; tab = 'breeding'; }} />
      </div>
    {/if}
    {#if visited.breeding}
      <div class="pane" style:display={tab === 'breeding' ? 'contents' : 'none'}>
        <Breeding pals={scopedPals} players={save.world.players} bind:targetId={breedTarget} />
      </div>
    {/if}
    {#if visited.coverage}
      <div class="pane" style:display={tab === 'coverage' ? 'contents' : 'none'}>
        <Coverage pals={scopedPals} ongoto={(id) => { breedTarget = id; tab = 'breeding'; }} />
      </div>
    {/if}
    {#if visited.map}
      <div class="pane" style:display={tab === 'map' ? 'contents' : 'none'}>
        <MapView players={save.world.players} metas={save.metas} />
      </div>
    {/if}
  {/if}
</main>

<style>
  header {
    padding: 12px 24px; border-bottom: 1px solid var(--border);
    background: var(--panel);
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    flex: none; z-index: 10;
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .mark { width: 30px; height: 30px; color: var(--accent); flex: none; }
  header h1 { font-size: 16px; margin: 0; line-height: 1.2; }
  header .sub { color: var(--muted); font-size: 12px; }
  nav { margin-left: auto; display: flex; gap: 8px; }
  nav button { border-color: transparent; background: transparent; color: var(--text-2); }
  nav button:hover { background: var(--panel2); color: var(--text); }
  nav button.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  nav button.ghost { border-color: var(--border); }
  nav button.themebtn { padding: 6px 8px; line-height: 0; }
  nav button.themebtn svg { width: 18px; height: 18px; }
  main {
    padding: 20px 24px; max-width: 1840px; margin: 0 auto; width: 100%;
    flex: 1; min-height: 0;
    display: flex; flex-direction: column;
    overflow-y: auto; /* single scroll surface for tall tabs */
  }
  .summary { flex: none; }
  .summary { display: flex; gap: 10px; flex-wrap: wrap; margin: 0 0 20px; }
  .stat {
    background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 12px 18px; min-width: 118px; flex: 1 1 auto; max-width: 180px;
  }
  .stat .n { font-size: 24px; font-weight: 600; line-height: 1.2; }
  .stat .l { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .ownerpick { display: flex; flex-direction: column; gap: 6px; justify-content: center; max-width: 240px; }
  .ownerpick .l { margin: 0; }
  .ownerpick select { width: 100%; }
</style>
