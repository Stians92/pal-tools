<script lang="ts">
  import type { Pal, Player } from './paltools';
  import { speciesName, passiveName, speciesIcon } from './breeding';

  let { pals, players }: { pals: Pal[]; players: Player[] } = $props();

  let search = $state('');
  let fWhere = $state('');
  let fOwner = $state('');
  let fAlpha = $state(false);
  let fLucky = $state(false);
  let fPassive = $state('');
  let sortKey = $state('level');
  let sortDir = $state(-1);

  const souls = (p: Pal) => p.rankHp + p.rankAttack + p.rankDefence + p.rankCraftSpeed;

  function ownerName(uid: string | null): string {
    if (!uid) return '—';
    const p = players.find(pl => pl.uid === uid);
    return p?.nickname ?? uid.slice(0, 8);
  }

  const owners = $derived([...new Set(pals.map(p => p.ownerUid).filter((x): x is string => !!x))]);
  const allPassives = $derived([...new Set(pals.flatMap(p => p.passives))].sort());

  function sortVal(p: Pal, k: string): string | number {
    if (k === 'souls') return souls(p);
    if (k === 'owner') return ownerName(p.ownerUid);
    if (k === 'passives') return p.passives.length;
    const v = (p as unknown as Record<string, unknown>)[k];
    return (v ?? '') as string | number;
  }

  const rows = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const filtered = pals.filter(p =>
      (!q || p.species.toLowerCase().includes(q) || speciesName(p.species).toLowerCase().includes(q) ||
        (p.nickname ?? '').toLowerCase().includes(q) || p.characterId.toLowerCase().includes(q)) &&
      (!fWhere || p.where === fWhere) &&
      (!fOwner || p.ownerUid === fOwner) &&
      (!fAlpha || p.isAlpha) &&
      (!fLucky || p.isLucky) &&
      (!fPassive || p.passives.includes(fPassive)));
    return filtered.sort((a, b) => {
      const va = sortVal(a, sortKey), vb = sortVal(b, sortKey);
      const c = typeof va === 'string' ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
      return c * sortDir || b.level - a.level;
    });
  });

  function clickSort(k: string) {
    if (sortKey === k) sortDir = -sortDir;
    else { sortKey = k; sortDir = k === 'level' ? -1 : 1; }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ players, pals }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pals.json';
    a.click();
  }

  const cols: [string, string, boolean][] = [
    ['species', 'Species', false], ['nickname', 'Nickname', false], ['level', 'Lv', true],
    ['gender', 'Sex', false], ['where', 'Location', false], ['rank', 'Rank', true],
    ['talentHp', 'IV HP', true], ['talentShot', 'IV Atk', true], ['talentDefense', 'IV Def', true],
    ['souls', 'Souls', true], ['passives', 'Passives', false], ['owner', 'Owner', false],
  ];
</script>

<div class="controls">
  <input type="search" placeholder="Search species or nickname…" bind:value={search} />
  <select bind:value={fWhere}>
    <option value="">All locations</option>
    <option value="palbox">Palbox</option>
    <option value="party">Party</option>
    <option value="base/other">Base / other</option>
  </select>
  <select bind:value={fOwner}>
    <option value="">All owners</option>
    {#each owners as u}<option value={u}>{ownerName(u)}</option>{/each}
  </select>
  <select bind:value={fPassive}>
    <option value="">Any passive</option>
    {#each allPassives as ps}<option value={ps}>{passiveName(ps)}</option>{/each}
  </select>
  <label><input type="checkbox" bind:checked={fAlpha} /> Alpha</label>
  <label><input type="checkbox" bind:checked={fLucky} /> Lucky</label>
  <span class="muted">{rows.length} shown</span>
  <button onclick={exportJson}>Export JSON</button>
</div>

<div class="tablewrap">
  <table>
    <thead>
      <tr>
        {#each cols as [k, label, num]}
          <th class:num onclick={() => clickSort(k)}>
            {label}{sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as p (p.key.instanceId)}
        <tr>
          <td title={p.characterId} class="speciescell">
            {#if speciesIcon(p.species)}
              <img class="palicon" src={speciesIcon(p.species)} alt="" loading="lazy" />
            {/if}
            {speciesName(p.species)}
            {#if p.isAlpha}<span class="tag alpha">α</span>{/if}
            {#if p.isLucky}<span class="tag lucky">✦</span>{/if}
          </td>
          <td class="nick">{p.nickname ?? ''}</td>
          <td class="num">{p.level}</td>
          <td class={p.gender === 'Male' ? 'gender-m' : p.gender === 'Female' ? 'gender-f' : 'muted'}>
            {p.gender === 'Male' ? '♂' : p.gender === 'Female' ? '♀' : '—'}
          </td>
          <td>
            <span class="tag" class:party={p.where === 'party'} class:palbox={p.where === 'palbox'}
                  class:base={p.where === 'base/other'}>{p.where}</span>
          </td>
          <td class="num">{p.rank > 1 ? '★' + (p.rank - 1) : ''}</td>
          {#each [p.talentHp, p.talentShot, p.talentDefense] as iv}
            <td class="num ivcell">
              <span class:iv-hi={iv >= 85} class:iv-lo={iv <= 20}>{iv}</span><span
                class="meter" class:hi={iv >= 85}><i style="width:{iv}%"></i></span>
            </td>
          {/each}
          <td class="num">{souls(p) || ''}</td>
          <td class="muted" title={p.passives.join(', ')}>{p.passives.map(passiveName).join(', ')}</td>
          <td class="muted">{ownerName(p.ownerUid)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .controls {
    display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
    background: var(--panel); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 10px 12px; margin-bottom: 14px;
    flex: none;
  }
  .controls input[type='search'] { flex: 1; min-width: 220px; }
  .tablewrap {
    overflow: auto; border: 1px solid var(--border);
    border-radius: var(--radius);
    flex: 1; min-height: 0; /* fill remaining viewport; scroll inside */
  }
  .nick { color: var(--accent2); }
  .gender-m { color: var(--accent); }
  .gender-f { color: #f78ab0; }
  .ivcell { min-width: 92px; }
  .speciescell .palicon { margin-right: 8px; }
  .iv-hi { color: var(--good); font-weight: 600; }
  .iv-lo { color: var(--muted); }
</style>
