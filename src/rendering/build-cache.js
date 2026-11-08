// Retain the full build of a layout while a fog projection of it is shown.
// Fog projections are temporary views of one layout, so toggling fog restores
// the retained build (buffers included) instead of rebuilding it, and a new full
// layout releases every projection. Builds are keyed by layout reference and a
// style key; layouts are never mutated after creation.
export function createBuildCache({ attach, detach, release }) {
  let current = null,
    spare = null;
  const isFogged = (layout) => layout.some((tile) => tile.fogState);
  function clear() {
    if (current) detach(current.build);
    for (const entry of [current, spare]) if (entry) release(entry.build);
    current = spare = null;
  }
  return {
    clear,
    current: () => current?.build ?? null,
    set(layout, key, build) {
      if (current && current.key !== key) clear();
      if (current?.layout === layout) return false;
      if (current) detach(current.build);
      if (spare?.layout === layout) {
        [current, spare] = [spare, current];
        attach(current.build);
        return true;
      }
      const stale = [current, spare].filter(Boolean);
      current = { layout, key, fogged: isFogged(layout), build: build() };
      spare = (current.fogged && stale.find((entry) => !entry.fogged)) || null;
      for (const entry of stale) if (entry !== spare) release(entry.build);
      return true;
    },
  };
}
