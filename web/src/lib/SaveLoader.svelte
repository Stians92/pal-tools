<script lang="ts">
  import { loadSaveFiles, type LoadedSave } from './paltools';

  let { onloaded }: { onloaded: (save: LoadedSave) => void } = $props();

  let status = $state('');
  let error = $state(false);
  let hover = $state(false);
  let dirInput: HTMLInputElement;
  let fileInput: HTMLInputElement;

  type Entry = { path: string; file: File };

  async function load(entries: Entry[]) {
    if (!entries.length) return;
    error = false;
    status = 'Parsing save…';
    try {
      const t0 = performance.now();
      const save = await loadSaveFiles(entries);
      const extra = save.worldCount > 1 ? ` (newest of ${save.worldCount} worlds: ${save.loadedFrom})` : '';
      status = `Loaded ${save.world.pals.length} pals, ${save.world.players.length} players in ${Math.round(performance.now() - t0)} ms${extra}.`;
      onloaded(save);
    } catch (e) {
      error = true;
      status = `Failed to load save: ${(e as Error).message}`;
      console.error(e);
    }
  }

  function fromFileList(list: FileList | null): Entry[] {
    if (!list) return [];
    return Array.from(list).map(f => ({ path: (f as any).webkitRelativePath || f.name, file: f }));
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    hover = false;
    // Grab all entry handles SYNCHRONOUSLY — DataTransferItemList is
    // invalidated as soon as the handler yields to the event loop.
    const fsEntries = Array.from(e.dataTransfer?.items ?? [])
      .map(it => (it as any).webkitGetAsEntry?.())
      .filter(Boolean);
    const plainFiles = fromFileList(e.dataTransfer?.files ?? null);

    if (!fsEntries.length) {
      if (plainFiles.length) load(plainFiles);
      else { error = true; status = 'Nothing droppable received — use the folder picker instead.'; }
      return;
    }

    try {
      const entries: Entry[] = [];
      async function walk(entry: any, prefix: string) {
        if (entry.isFile) {
          const f: File = await new Promise((res, rej) => entry.file(res, rej));
          entries.push({ path: prefix + entry.name, file: f });
        } else if (entry.isDirectory) {
          const rd = entry.createReader();
          for (;;) {
            const batch: any[] = await new Promise((res, rej) => rd.readEntries(res, rej));
            if (!batch.length) break;
            for (const c of batch) await walk(c, prefix + entry.name + '/');
          }
        }
      }
      for (const entry of fsEntries) await walk(entry, '');
      if (entries.length) load(entries);
      else if (plainFiles.length) load(plainFiles);
      else { error = true; status = 'Dropped folder appears to be empty.'; }
    } catch (err) {
      // Directory traversal can fail (permissions, browser quirks) — fall back
      // to whatever plain File objects the drop carried.
      console.warn('drop traversal failed', err);
      if (plainFiles.length) load(plainFiles);
      else { error = true; status = `Drop failed: ${(err as Error).message}. Use the folder picker instead.`; }
    }
  }

  // Prevent the browser from navigating to the file when a drop misses the
  // dropzone, and accept the drop anywhere on the page.
  function windowDragOver(e: DragEvent) { e.preventDefault(); }
  function windowDrop(e: DragEvent) { onDrop(e); }

  // Dev-only: `?demo` auto-loads /testsave/* (served from web/public) so the
  // loaded views can be screenshot-tested without a file picker.
  $effect(() => {
    if (!import.meta.env.DEV || !new URLSearchParams(location.search).has('demo')) return;
    (async () => {
      const manifest: string[] = await (await fetch('/testsave/manifest.json')).json();
      const entries: Entry[] = [];
      for (const p of manifest) {
        const blob = await (await fetch('/testsave/' + p)).blob();
        entries.push({ path: p, file: new File([blob], p.split('/').pop()!) });
      }
      load(entries);
    })().catch(e => { error = true; status = 'demo load failed: ' + (e as Error).message; });
  });
</script>

<svelte:window ondragover={windowDragOver} ondrop={windowDrop} />

<div
  class="dropzone"
  class:hover
  role="button"
  tabindex="0"
  ondragover={(e) => { e.preventDefault(); hover = true; }}
  ondragleave={() => (hover = false)}
>
  <svg class="egg" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2C8 2 4.5 7.5 4.5 13a7.5 7.5 0 0 0 15 0C19.5 7.5 16 2 12 2Z"
          fill="none" stroke="currentColor" stroke-width="1.5"/>
    <path d="M12 9v6M9 12h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>
  <p class="lead"><strong>Drop your Palworld save folder anywhere on this page</strong></p>
  <p class="muted">or the <code>Level.sav</code> plus <code>Players/*.sav</code> files —
    typically <code>%LOCALAPPDATA%\Pal\Saved\SaveGames\&lt;steamid&gt;\&lt;worldid&gt;\</code></p>
  <button class="primary" onclick={() => dirInput.click()}>Choose save folder</button>
  <button onclick={() => fileInput.click()}>Choose files</button>
  <p class="muted small">Everything runs locally in your browser — nothing is uploaded.</p>
  <input type="file" bind:this={dirInput} webkitdirectory style="display:none"
         onchange={(e) => load(fromFileList((e.target as HTMLInputElement).files))} />
  <input type="file" bind:this={fileInput} multiple style="display:none"
         onchange={(e) => load(fromFileList((e.target as HTMLInputElement).files))} />
</div>
{#if status}
  <p class="status" class:error>{status}</p>
{/if}

<style>
  .dropzone {
    border: 2px dashed var(--border); border-radius: 14px; padding: 48px 40px;
    text-align: center; color: var(--muted); margin: 48px auto 16px; max-width: 640px;
    background: var(--panel);
    transition: border-color .15s, background .15s, transform .15s;
  }
  .dropzone.hover { border-color: var(--accent); background: var(--accent-soft); transform: scale(1.01); }
  .dropzone strong { color: var(--text); }
  .dropzone .egg { width: 44px; height: 44px; color: var(--accent); margin-bottom: 6px; }
  .dropzone .lead { font-size: 16px; margin: 0 0 6px; }
  .dropzone p { margin: 6px 0; }
  .dropzone button { margin: 14px 5px 0; }
  .dropzone .small { font-size: 12px; margin-top: 16px; }
  .status { font-size: 12px; color: var(--muted); text-align: center; }
  .status.error { color: var(--bad); }
</style>
