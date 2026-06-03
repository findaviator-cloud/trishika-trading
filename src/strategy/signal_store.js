// In-memory signal store — replaces disk-based signals_live/
const store = new Map();

export function setSignal(filename, payload) {
  store.set(filename, { ...payload, _updatedAt: Date.now() });
}

export function getSignal(filename) {
  return store.get(filename) ?? null;
}

export function getAllSignals() {
  return Object.fromEntries(store);
}
