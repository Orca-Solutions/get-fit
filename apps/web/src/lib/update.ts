import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * A new release waits until the app is next launched, or until the person taps Update. It never
 * reloads an open screen by itself, which would lose whatever is being typed into a set.
 */
let ready = false;
const listeners = new Set<() => void>();
let updateSW: ((reload?: boolean) => Promise<void>) | undefined;

export function registerUpdates() {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      ready = true;
      listeners.forEach((l) => l());
    },
  });
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => ready,
  );
}

export function applyUpdate() {
  // The plugin only reloads for an update it found itself; the browser's own checks find most of them.
  let reloaded = false;
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  void updateSW?.(true);
}
