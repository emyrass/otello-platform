import { STORAGE_KEY, type AppState } from "./types.ts";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadState(store: KeyValueStore): AppState | null {
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AppState;
    if (parsed.version !== 1 || !Array.isArray(parsed.leases) || !Array.isArray(parsed.audit) || !parsed.keystore) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveState(store: KeyValueStore, state: AppState): void {
  store.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearState(store: KeyValueStore): void {
  store.removeItem(STORAGE_KEY);
}
