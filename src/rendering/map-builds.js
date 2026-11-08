// The renderer shows either a source layout or a layout projected from it
// (fog of war). Keep one build per role so switching between them shows the
// retained build instead of rebuilding and re-uploading it. A different source
// layout or style key releases both; a different projection of the same source
// releases only the previous projection. Layouts are never mutated after
// creation, so a layout reference identifies its build.
export function createMapBuilds({ build, show, release }) {
  let key, origin;
  let source = null,
    projection = null,
    active = null;
  function clear() {
    if (active) show(null);
    for (const slot of [source, projection]) if (slot) release(slot.record);
    source = projection = active = null;
  }
  return {
    clear,
    active: () => active?.record ?? null,
    show(layout, sourceLayout, nextKey) {
      if (nextKey !== key || sourceLayout !== origin) {
        clear();
        key = nextKey;
        origin = sourceLayout;
      }
      const isSource = layout === sourceLayout;
      let slot = isSource ? source : projection;
      const stale = slot && slot.layout !== layout ? slot : null;
      if (stale) slot = null;
      if (slot && slot === active) return false;
      if (!slot) {
        slot = { layout, record: build(layout, nextKey) };
        if (isSource) source = slot;
        else projection = slot;
      }
      show(slot.record);
      active = slot;
      if (stale) release(stale.record);
      return true;
    },
  };
}
