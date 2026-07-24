// UI-state persistence across page refreshes, keyed by world identity.
// Re-dropping the same world restores tab state; loading a different world
// (or a first visit) starts clean. Only UI choices are stored — never save data.

const LS_KEY = 'paltools-uistate';

type Bag = Record<string, unknown> & { __world?: string };

let bag: Bag = {};
try {
  bag = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Bag;
} catch {
  bag = {};
}

let timer: ReturnType<typeof setTimeout> | undefined;
function flush() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(bag));
  } catch {
    /* quota/privacy mode — persistence is best-effort */
  }
}

/** Call when a save is loaded, BEFORE the tab components mount. A different
    world than last time discards all stored sections. */
export function initWorld(key: string): void {
  if (bag.__world !== key) bag = { __world: key };
  flush();
}

/** Restore a section's state saved for the current world (undefined if none). */
export function restore<T>(section: string): T | undefined {
  return bag[section] as T | undefined;
}

/** Persist a section's state (debounced write). */
export function persist(section: string, value: unknown): void {
  bag[section] = value;
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}
