<script lang="ts">
  import { passiveName, passiveTier, passiveById } from './breeding';

  let { id }: { id: string } = $props();
</script>

<span class="pv {passiveTier(id)}" title={passiveById(id)?.desc || undefined}>{passiveName(id)}</span>
