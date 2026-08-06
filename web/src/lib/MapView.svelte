<script lang="ts">
  import type { Player, PlayerMeta } from './paltools';
  import { speciesName, speciesIcon } from './breeding';
  import relicsRaw from '../data/relics.json';
  import markersData from '../data/markers.json';
  import paldbRaw from '../data/paldb-markers.json';
  import mapiconsRaw from '../data/mapicons.json';

  // in-game marker icons (paldb type name → file in public/mapicons/)
  const mapicons = mapiconsRaw as Record<string, string>;
  const gicon = (type: string): string | null =>
    mapicons[type] ? `${import.meta.env.BASE_URL}mapicons/${mapicons[type]}` : null;

  let { players, metas }: { players: Player[]; metas: PlayerMeta[] } = $props();

  // ---- static data ----
  interface RelicEntry { x: number; y: number; z: number; relic_type: string }
  const relics = Object.entries(relicsRaw as Record<string, RelicEntry>)
    .map(([id, r]) => ({ id, x: r.x, y: r.y, type: r.relic_type }));
  const md = markersData as {
    fastTravel: { id: string; x: number; y: number; name: string }[];
    alphas: { spawnerId: string; characterId: string; level: number; x: number; y: number }[];
    dungeons: { x: number; y: number }[];
  };
  interface PaldbMarker { x: number; y: number; area?: string; sub?: string; name?: string; title?: string; noteId?: string | null }
  const pd = paldbRaw as unknown as Record<string, PaldbMarker[]> & { meta: unknown };
  const materialTypes = [...new Set((pd.materials ?? []).map(m => m.sub ?? ''))].sort();

  const AREAS = {
    main: { img: `${import.meta.env.BASE_URL}map/worldmap.webp`, label: 'Palpagos Islands', min: { x: -1099400, y: -724400 }, max: { x: 349400, y: 724400 } },
    tree: { img: `${import.meta.env.BASE_URL}map/treemap.webp`, label: 'World Tree', min: { x: 347351.5, y: -818197 }, max: { x: 689148.5, y: -476400 } },
  } as const;
  type AreaKey = keyof typeof AREAS;

  function areaOf(p: { x: number; y: number }): AreaKey {
    const t = AREAS.tree;
    return (p.x >= t.min.x && p.x <= t.max.x && p.y >= t.min.y && p.y <= t.max.y) ? 'tree' : 'main';
  }
  function toFrac(a: AreaKey, p: { x: number; y: number }) {
    const A = AREAS[a];
    return { left: (p.y - A.min.y) / (A.max.y - A.min.y), top: 1 - (p.x - A.min.x) / (A.max.x - A.min.x) };
  }
  const gameCoord = (p: { x: number; y: number }) =>
    `${Math.round((p.y + 18) / 725)}, ${-Math.round((p.x + 375247) / 725)}`;

  const TYPE_LABELS: Record<string, string> = {
    capture_power: 'Capture power (Lifmunk)', jump_power: 'Jump power',
    status_ailment_resist: 'Ailment resist', stamina_reduction: 'Stamina',
    hunger_reduction: 'Hunger', glider_speed: 'Glider speed', swim_speed: 'Swim speed',
    climb_speed: 'Climb speed', food_decay_reduction: 'Food decay', exp_bonus: 'EXP bonus',
    rainbow_passive_rate: 'Rainbow passive', sphere_homing: 'Sphere homing',
  };
  const typeLabel = (t: string) => TYPE_LABELS[t] ?? t;
  const relicTypes = [...new Set(relics.map(r => r.type))].sort();

  // ---- state ----
  let playerUid = $state(metas[0]?.playerUid ?? '');
  let area = $state<AreaKey>('main');
  let showDone = $state(false);
  let relicTypeFilter = $state('');
  let materialFilter = $state('');
  let enabled = $state<Record<string, boolean>>({
    relics: true, fastTravel: true, alphas: true, dungeons: false,
    chests: false, eggs: false, skillFruits: false, journals: true,
    materials: false, npcs: false, supply: false, fishing: false,
  });

  const playerName = (uid: string | null) =>
    players.find(p => p.uid === uid)?.nickname ?? (uid ? uid.slice(0, 8) : '?');

  const meta = $derived(metas.find(m => m.playerUid === playerUid) ?? metas[0]);
  const relicsGot = $derived(new Set(meta?.collectedRelics ?? []));
  const ftGot = $derived(new Set(meta?.unlockedFastTravel ?? []));
  const bossGot = $derived(new Set(meta?.defeatedBosses ?? []));
  const notesGot = $derived(new Set(meta?.collectedNotes ?? []));

  const bossSpecies = (characterId: string) =>
    characterId.replace(/^BOSS_/i, '').replace(/^PREDATOR_/i, '').replace(/^GYM_/i, '');

  interface Marker {
    key: string; left: number; top: number; cls: string;
    done: boolean | null; // null = no save state for this kind
    /** pal-face icon (round, ringed) */
    icon?: string | null;
    /** in-game marker icon (rendered as-is) */
    gicon?: string | null;
    label: string;
  }

  const markers = $derived.by((): Marker[] => {
    const out: Marker[] = [];
    const inArea = <T extends { x: number; y: number }>(p: T) => areaOf(p) === area;

    if (enabled.relics) {
      const relicIcon = gicon('Lifmunk Effigy');
      for (const r of relics) {
        if (!inArea(r)) continue;
        if (relicTypeFilter && r.type !== relicTypeFilter) continue;
        const done = relicsGot.has(r.id);
        if (done && !showDone) continue;
        out.push({ key: 'r' + r.id, ...toFrac(area, r), cls: 'relic', done, gicon: relicIcon, label: `${typeLabel(r.type)} relic — (${gameCoord(r)})` });
      }
    }
    if (enabled.fastTravel) {
      const ftIcon = gicon('Fast Travel');
      for (const f of md.fastTravel) {
        if (!inArea(f)) continue;
        const done = ftGot.has(f.id);
        if (done && !showDone) continue;
        out.push({ key: 'f' + f.id, ...toFrac(area, f), cls: 'ft', done, gicon: ftIcon, label: `${f.name} — fast travel${done ? ' (unlocked)' : ''} — (${gameCoord(f)})` });
      }
    }
    if (enabled.alphas) {
      for (let i = 0; i < md.alphas.length; i++) {
        const b = md.alphas[i];
        if (!inArea(b)) continue;
        const done = bossGot.has(b.spawnerId.toLowerCase());
        if (done && !showDone) continue;
        const sp = bossSpecies(b.characterId);
        const icon = speciesIcon(sp);
        const name = icon ? speciesName(sp) : sp.replace(/_/g, ' '); // human bosses aren't pals
        out.push({
          // spawner ids repeat (same boss, several spots) — suffix with index
          key: `a${b.spawnerId}#${i}`, ...toFrac(area, b), cls: 'alpha', done,
          icon,
          label: `${icon ? 'Alpha' : 'Boss'}: ${name} Lv${b.level}${done ? ' (defeated)' : ''} — (${gameCoord(b)})`,
        });
      }
    }
    if (enabled.dungeons) {
      const dIcon = gicon('Dungeon');
      for (let i = 0; i < md.dungeons.length; i++) {
        const d = md.dungeons[i];
        if (!inArea(d)) continue;
        out.push({ key: 'd' + i, ...toFrac(area, d), cls: 'dungeon', done: null, gicon: dIcon, label: `Dungeon entrance — (${gameCoord(d)})` });
      }
    }
    // paldb-sourced categories (paldb.cc; tree-file markers carry area:'tree')
    const pdArea = (m: PaldbMarker) => (m.area === 'tree' ? 'tree' : areaOf(m));
    const addPd = (list: PaldbMarker[], keyPrefix: string, cls: string,
                   labelOf: (m: PaldbMarker) => string,
                   iconOf: (m: PaldbMarker) => string | null,
                   doneOf?: (m: PaldbMarker) => boolean | null,
                   filter?: (m: PaldbMarker) => boolean) => {
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (pdArea(m) !== area) continue;
        if (filter && !filter(m)) continue;
        const done = doneOf ? doneOf(m) : null;
        if (done === true && !showDone) continue;
        out.push({ key: keyPrefix + i, ...toFrac(area, m), cls, done, gicon: iconOf(m), label: `${labelOf(m)} — (${gameCoord(m)})` });
      }
    };
    const chestIcon = (m: PaldbMarker) =>
      m.sub === 'treasure element' ? gicon('Treasure Element') :
      m.sub === 'oilrig treasure' ? gicon('Oilrig Treasure') :
      m.sub === 'treasure map' ? gicon('Treasure Map') : gicon('Treasure');
    if (enabled.chests) addPd(pd.chests, 'c', 'chest', m => `Chest (${m.sub ?? '?'})`, chestIcon);
    if (enabled.eggs) addPd(pd.eggs, 'e', 'egg', m => `${m.sub ?? ''} egg`, m => gicon(`${m.sub} Egg`) ?? gicon('Grass Egg'));
    if (enabled.skillFruits) addPd(pd.skillFruits, 'sf', 'fruit', () => 'Skill fruit tree', () => gicon('Fruit Tree'));
    if (enabled.journals)
      addPd(pd.journals, 'j', 'journal',
        m => `${m.title ?? 'Journal'}${m.noteId && notesGot.has(m.noteId) ? ' (read)' : ''}`,
        m => (m.title === 'Memo Planner' ? gicon('Memo Planner') : gicon('Journals')),
        m => (m.noteId ? notesGot.has(m.noteId) : null));
    if (enabled.materials)
      addPd(pd.materials, 'm', 'material', m => m.sub ?? 'Material',
        m => gicon(m.sub ?? '') ?? gicon('Ore'),
        undefined, m => !materialFilter || m.sub === materialFilter);
    if (enabled.npcs) addPd(pd.npcs, 'n', 'npc', m => m.name ? `${m.name} (${m.sub})` : m.sub ?? 'NPC',
      m => gicon(m.sub ?? 'NPC') ?? gicon('NPC'));
    if (enabled.supply) addPd(pd.supply, 'su', 'supply', () => 'Supply drop', () => gicon('Supply'));
    if (enabled.fishing) addPd(pd.fishing, 'fi', 'fishing', m => m.sub ?? 'Fishing spot', () => gicon('Fishing Spot'));
    return out;
  });

  // per-category tallies (save-aware where applicable, across BOTH areas)
  interface Cat { key: string; label: string; glyph: string; icon?: string | null; total: number; done: number | null }
  const groups = $derived.by((): { label: string; cats: Cat[] }[] => {
    const scopedRelics = relics.filter(r => !relicTypeFilter || r.type === relicTypeFilter);
    const rGot = scopedRelics.filter(r => relicsGot.has(r.id)).length;
    const fGot = md.fastTravel.filter(f => ftGot.has(f.id)).length;
    const aGot = md.alphas.filter(b => bossGot.has(b.spawnerId.toLowerCase())).length;
    const trackableJournals = pd.journals.filter(j => j.noteId);
    const jGot = trackableJournals.filter(j => notesGot.has(j.noteId!)).length;
    const scopedMaterials = pd.materials.filter(m => !materialFilter || m.sub === materialFilter);
    return [
      {
        label: 'Locations',
        cats: [
          { key: 'fastTravel', label: 'Fast travel', glyph: 'ft', icon: gicon('Fast Travel'), total: md.fastTravel.length, done: fGot },
          { key: 'alphas', label: 'Alpha pals', glyph: 'alpha', icon: gicon('Alpha Pal'), total: md.alphas.length, done: aGot },
          { key: 'dungeons', label: 'Dungeons', glyph: 'dungeon', icon: gicon('Dungeon'), total: md.dungeons.length, done: null },
        ],
      },
      {
        label: 'Collectibles',
        cats: [
          { key: 'relics', label: 'Relics / Effigies', glyph: 'relic', icon: gicon('Lifmunk Effigy'), total: scopedRelics.length, done: rGot },
          { key: 'journals', label: 'Journals', glyph: 'journal', icon: gicon('Journals'), total: pd.journals.length, done: jGot },
          { key: 'chests', label: 'Chests', glyph: 'chest', icon: gicon('Treasure'), total: pd.chests.length, done: null },
          { key: 'eggs', label: 'Eggs', glyph: 'egg', icon: gicon('Grass Egg'), total: pd.eggs.length, done: null },
          { key: 'skillFruits', label: 'Skill fruits', glyph: 'fruit', icon: gicon('Fruit Tree'), total: pd.skillFruits.length, done: null },
        ],
      },
      {
        label: 'Materials',
        cats: [
          { key: 'materials', label: materialFilter || 'All materials', glyph: 'material', icon: gicon(materialFilter || 'Ore'), total: scopedMaterials.length, done: null },
        ],
      },
      {
        label: 'NPCs & world',
        cats: [
          { key: 'npcs', label: 'NPCs & merchants', glyph: 'npc', icon: gicon('NPC'), total: pd.npcs.length, done: null },
          { key: 'supply', label: 'Supply drops', glyph: 'supply', icon: gicon('Supply'), total: pd.supply.length, done: null },
          { key: 'fishing', label: 'Fishing / salvage', glyph: 'fishing', icon: gicon('Fishing Spot'), total: pd.fishing.length, done: null },
        ],
      },
    ];
  });

  // ---- pan/zoom ----
  let viewport: HTMLDivElement;
  let scale = $state(1);
  let tx = $state(0);
  let ty = $state(0);
  let dragging = false, lastX = 0, lastY = 0;

  function clamp() {
    const w = viewport?.clientWidth ?? 0, h = viewport?.clientHeight ?? 0;
    tx = Math.min(0, Math.max(w - w * scale, tx));
    ty = Math.min(0, Math.max(h - h * scale, ty));
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const ns = Math.min(12, Math.max(1, scale * (e.deltaY < 0 ? 1.25 : 0.8)));
    tx = px - (px - tx) * (ns / scale);
    ty = py - (py - ty) * (ns / scale);
    scale = ns;
    clamp();
  }
  function onPointerDown(e: PointerEvent) {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    tx += e.clientX - lastX; ty += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    clamp();
  }
  function onPointerUp() { dragging = false; }
  function resetView() { scale = 1; tx = 0; ty = 0; }
</script>

<div class="maplayout">
  <aside class="sidebar">
    <div class="row">
      <select bind:value={playerUid} title="Whose progress">
        {#each metas as m (m.playerUid)}
          <option value={m.playerUid}>{playerName(m.playerUid)}</option>
        {/each}
      </select>
    </div>
    <div class="areatabs">
      {#each Object.entries(AREAS) as [k, a]}
        <button class:active={area === k} onclick={() => { area = k as AreaKey; resetView(); }}>{a.label}</button>
      {/each}
    </div>

    {#each groups as g (g.label)}
      <h3>{g.label}</h3>
      {#each g.cats as c (c.key)}
        <button class="cat" class:on={enabled[c.key]} onclick={() => (enabled[c.key] = !enabled[c.key])}>
          {#if c.icon}
            <img class="caticon" src={c.icon} alt="" loading="lazy" />
          {:else}
            <span class="glyph {c.glyph}"></span>
          {/if}
          <span class="catlabel">{c.label}</span>
          <span class="count">
            {#if c.done !== null}{c.total - c.done}<span class="of"> left of {c.total}</span>
            {:else}{c.total}{/if}
          </span>
        </button>
        {#if c.key === 'relics' && enabled.relics}
          <select class="sub" bind:value={relicTypeFilter}>
            <option value="">All relic types</option>
            {#each relicTypes as t}<option value={t}>{typeLabel(t)}</option>{/each}
          </select>
        {/if}
        {#if c.key === 'materials' && enabled.materials}
          <select class="sub" bind:value={materialFilter}>
            <option value="">All materials</option>
            {#each materialTypes as t}<option value={t}>{t}</option>{/each}
          </select>
        {/if}
      {/each}
    {/each}

    <label class="showdone"><input type="checkbox" bind:checked={showDone} />
      Show collected / unlocked / defeated</label>
    {#if scale > 1}<button onclick={resetView}>Reset zoom</button>{/if}
    <p class="muted note">Chests, eggs, materials and dungeons respawn — no per-save
      state. Journal tracking covers the base-game notes; newer islands' notes are
      shown without read-state.
      Location data: paldb.cc · game data © Pocketpair.</p>
  </aside>

  <div class="viewport" bind:this={viewport}
       onwheel={onWheel} onpointerdown={onPointerDown}
       onpointermove={onPointerMove} onpointerup={onPointerUp} onpointercancel={onPointerUp}>
    <div class="world" style="transform: translate({tx}px, {ty}px) scale({scale})">
      <img class="mapimg" src={AREAS[area].img} alt={AREAS[area].label} draggable="false" />
      {#each markers as m (m.key)}
        {#if m.icon}
          <img class="marker img {m.cls}" class:done={m.done === true} src={m.icon}
               style="left:{m.left * 100}%; top:{m.top * 100}%; --s:{scale}"
               title={m.label} alt="" loading="lazy" draggable="false" />
        {:else if m.gicon}
          <img class="marker gm {m.cls}" class:done={m.done === true} src={m.gicon}
               style="left:{m.left * 100}%; top:{m.top * 100}%; --s:{scale}"
               title={m.label} alt="" loading="lazy" draggable="false" />
        {:else}
          <span class="marker {m.cls}" class:done={m.done === true}
                style="left:{m.left * 100}%; top:{m.top * 100}%; --s:{scale}"
                title={m.label}></span>
        {/if}
      {/each}
    </div>
  </div>
</div>
<p class="muted hint">Scroll to zoom, drag to pan; hover markers for details.
  Counts and hidden markers follow {playerName(playerUid)}'s progress.</p>

<style>
  .maplayout {
    display: grid; grid-template-columns: 250px 1fr; gap: 14px;
    align-items: start; flex: 1; min-height: 0;
  }
  @media (max-width: 900px) { .maplayout { grid-template-columns: 1fr; } }

  .sidebar {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 12px; display: flex;
    flex-direction: column; gap: 8px; max-height: 100%; overflow-y: auto;
  }
  .sidebar h3 { margin: 6px 0 0; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .row select { width: 100%; }
  .areatabs { display: flex; gap: 6px; }
  .areatabs button { flex: 1; padding: 6px 4px; font-size: 12.5px; border-color: var(--border); background: var(--panel2); }
  .areatabs button.active { border-color: var(--accent); color: var(--accent); font-weight: 600; }

  .cat {
    display: flex; align-items: center; gap: 9px; text-align: left;
    padding: 7px 10px; background: var(--panel2); opacity: .55;
  }
  .cat.on { opacity: 1; border-color: var(--accent); }
  .catlabel { flex: 1; }
  .count { font-variant-numeric: tabular-nums; font-weight: 600; }
  .count .of { color: var(--muted); font-weight: 400; font-size: 11px; }
  .sub { margin: -2px 0 4px 30px; font-size: 12px; }
  .showdone { font-size: 12.5px; margin-top: 4px; }
  .note { font-size: 11.5px; margin: 6px 0 0; }

  .glyph { width: 12px; height: 12px; border-radius: 50%; flex: none; }
  .glyph.relic { background: #ffd84d; }
  .glyph.ft { background: #7fd4ff; border-radius: 3px; transform: rotate(45deg); }
  .glyph.alpha { background: #ff6b81; }
  .glyph.dungeon { background: #b48cf2; border-radius: 3px; }
  .glyph.chest { background: #d9a05b; border-radius: 3px; }
  .glyph.egg { background: #9be8c8; }
  .glyph.fruit { background: #7ed957; }
  .glyph.journal { background: #f2f2f2; border-radius: 2px; }
  .glyph.material { background: #a8b6c8; border-radius: 3px; }
  .glyph.npc { background: #e8a8f0; }
  .glyph.supply { background: #6fa8ff; border-radius: 3px; }
  .glyph.fishing { background: #58c8d8; }

  .viewport {
    position: relative; overflow: hidden; border: 1px solid var(--border);
    border-radius: var(--radius); aspect-ratio: 1; max-height: calc(100vh - 220px);
    background: #060a10; cursor: grab; touch-action: none;
  }
  .viewport:active { cursor: grabbing; }
  .world { position: absolute; inset: 0; transform-origin: 0 0; }
  .mapimg { width: 100%; height: 100%; display: block; user-select: none; }

  .marker { position: absolute; }
  .marker:not(.img) {
    width: calc(10px / var(--s)); height: calc(10px / var(--s));
    margin: calc(-5px / var(--s)) 0 0 calc(-5px / var(--s));
    border-radius: 50%;
    box-shadow: 0 0 0 calc(1.5px / var(--s)) rgba(0, 0, 0, 0.75);
  }
  .marker.relic { background: #ffd84d; box-shadow: 0 0 0 calc(1.5px / var(--s)) rgba(0,0,0,.75), 0 0 calc(6px / var(--s)) rgba(255, 216, 77, 0.8); }
  .marker.ft { background: #7fd4ff; border-radius: calc(2px / var(--s)); transform: rotate(45deg); }
  .marker.dungeon { background: #b48cf2; border-radius: calc(2px / var(--s)); }
  .marker.chest { background: #d9a05b; border-radius: calc(2px / var(--s)); }
  .marker.egg { background: #9be8c8; }
  .marker.fruit { background: #7ed957; }
  .marker.journal { background: #f2f2f2; border-radius: calc(1.5px / var(--s)); box-shadow: 0 0 0 calc(1.5px / var(--s)) rgba(0,0,0,.85); }
  .marker.material { background: #a8b6c8; border-radius: calc(2px / var(--s)); }
  .marker.npc { background: #e8a8f0; }
  .marker.supply { background: #6fa8ff; border-radius: calc(2px / var(--s)); }
  .marker.fishing { background: #58c8d8; }
  .marker.img {
    width: calc(22px / var(--s)); height: calc(22px / var(--s));
    margin: calc(-11px / var(--s)) 0 0 calc(-11px / var(--s));
    border-radius: 50%; object-fit: cover; background: #101318;
  }
  .marker.img.alpha { box-shadow: 0 0 0 calc(2px / var(--s)) #ff6b81, 0 0 calc(5px / var(--s)) rgba(0,0,0,.8); }
  /* in-game marker icons: rendered as-is with a shadow for contrast */
  .marker.gm {
    width: calc(16px / var(--s)); height: calc(16px / var(--s));
    margin: calc(-8px / var(--s)) 0 0 calc(-8px / var(--s));
    object-fit: contain;
    filter: drop-shadow(0 calc(1px / var(--s)) calc(3px / var(--s)) rgba(0, 0, 0, 0.9));
  }
  .marker.gm.relic { filter: drop-shadow(0 0 calc(4px / var(--s)) rgba(120, 230, 140, 0.9)); }
  .marker.done { opacity: .45; filter: saturate(.4); }
  .marker.gm.done { opacity: .4; filter: grayscale(.7) drop-shadow(0 calc(1px / var(--s)) calc(2px / var(--s)) rgba(0, 0, 0, 0.8)); }
  .caticon { width: 20px; height: 20px; object-fit: contain; flex: none; }
  .hint { font-size: 12px; margin-top: 8px; flex: none; }
</style>
