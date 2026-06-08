// Tiny event bus bridging the React HUD and the Phaser scene.
// React → scene: 'load', 'buildMode', 'brush', 'lineMode', 'runState', …
// scene → React: 'selectHouse', 'placeDecor', 'moveNode', 'deleteDecor', 'connect', 'error', …
function createBus() {
  const handlers = new Map();
  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
    off(type, fn) { handlers.get(type)?.delete(fn); },
    emit(type, payload) { handlers.get(type)?.forEach((fn) => fn(payload)); },
  };
}

export const bus = createBus();
