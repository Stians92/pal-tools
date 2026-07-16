<script lang="ts">
  import { passiveName, passiveRank, passiveById } from './breeding';

  let { id }: { id: string } = $props();

  const rank = $derived(passiveRank(id));
  // in-game tiers: red (debuff), white (rank 1), gold (rank 2–3), prismatic (rank 4+)
  const tier = $derived(rank < 0 ? 'neg' : rank < 2 ? 'white' : rank < 4 ? 'gold' : 'prism');
  const n = $derived(Math.max(1, Math.min(Math.abs(rank), 4)));

  // stacked up-chevrons (flipped via CSS for debuffs); apex y of chevron i:
  const STEP = 3.2;
  const apexes = $derived(Array.from({ length: n }, (_, i) => 1.4 + i * STEP));
  const h = $derived((n - 1) * STEP + 5.6);
</script>

<span class="pv {tier}" title={passiveById(id)?.desc || undefined}>
  <span class="name">{passiveName(id)}</span>
  <svg class="chev" class:down={rank < 0} viewBox="0 0 9 {h}" width="9" height={h}
       role="img" aria-label="rank {rank}">
    {#if tier === 'prism'}
      <defs>
        <linearGradient id="pv-prism" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ff8a8a" /><stop offset=".35" stop-color="#ffd257" />
          <stop offset=".65" stop-color="#7ee39a" /><stop offset="1" stop-color="#7fb8ff" />
        </linearGradient>
      </defs>
    {/if}
    {#each apexes as y}
      <path d="M1.2 {y + 3} L4.5 {y} L7.8 {y + 3}" fill="none"
            stroke={tier === 'prism' ? 'url(#pv-prism)' : 'currentColor'}
            stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" />
    {/each}
  </svg>
</span>

<style>
  .pv {
    --pvc: #c9d2de;
    position: relative;
    display: inline-flex; align-items: center; gap: 6px;
    padding: 1px 7px 1px 9px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--pvc) 9%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pvc) 24%, transparent);
    font-size: 11.5px; line-height: 1.55; white-space: nowrap;
    color: var(--text);
    margin: 1px 4px 1px 0;
  }
  /* left accent bar (an element, not border-left, so prismatic can be a gradient) */
  .pv::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
    border-radius: 5px 0 0 5px; background: var(--pvc);
  }
  .pv .chev { flex: none; color: var(--pvc); display: block; }
  .pv .chev.down { transform: scaleY(-1); }

  .pv.neg { --pvc: #e5697a; }
  .pv.gold { --pvc: #f0c34c; }
  .pv.prism {
    --pvc: #b9a1e8;
    background: linear-gradient(100deg,
      rgba(255, 138, 138, 0.12), rgba(255, 210, 87, 0.12),
      rgba(126, 227, 154, 0.12), rgba(127, 184, 255, 0.14));
  }
  .pv.prism::before { background: linear-gradient(180deg, #ff8a8a, #ffd257, #7ee39a, #7fb8ff); }
  .pv.prism .name {
    background: linear-gradient(90deg, #ffb1b1, #ffe08a, #a9f0bd, #a8ccff);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    font-weight: 600;
  }

  :global([data-theme='light']) .pv { --pvc: #97a1b0; }
  :global([data-theme='light']) .pv.neg { --pvc: #c23b52; }
  :global([data-theme='light']) .pv.gold { --pvc: #a8730a; }
  :global([data-theme='light']) .pv.prism { --pvc: #7d5bbf; }
  :global([data-theme='light']) .pv.prism .name {
    background: linear-gradient(90deg, #c04747, #a8730a, #2e8540, #1a73c7);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
</style>
