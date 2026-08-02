<script lang="ts">
  import { speciesName } from './breeding';
  import SpeciesCard from './SpeciesCard.svelte';

  let { speciesId, onclose }: { speciesId: string; onclose: () => void } = $props();

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window {onkeydown} />

<div class="overlay" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}
     role="presentation">
  <div class="panel" role="dialog" aria-modal="true" aria-label={speciesName(speciesId)}>
    <button class="close" onclick={onclose} aria-label="Close">✕</button>
    <SpeciesCard {speciesId} />
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
    width: min(420px, 100%); max-height: 100%;
    overflow-y: auto;
    padding: 20px 22px;
  }
  .close {
    position: absolute; top: 12px; right: 12px;
    background: none; border: none; color: var(--muted); font-size: 15px;
    padding: 6px 9px;
  }
  .close:hover { color: var(--text); }
</style>
