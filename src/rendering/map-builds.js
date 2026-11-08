// The renderer shows either a source layout or a layout projected from it
// (fog of war). Keep one build per role so switching between them reattaches
// the retained build instead of rebuilding and re-uploading it. A different
// source layout or style key releases both; a different projection of the same
// source releases only the previous projection. Layouts are never mutated
// after creation, so a layout reference identifies its build.
export function createMapBuilds({ build, attach, detach, release }) {
  let key, origin;
  let source = null,
    projection = null,
    active = null;
  function drop(slot) {
    if (slot) release(slot.record);
    return null;
  }
  function clear() {
    if (active) detach(active.record);
    source = drop(source);
    projection = drop(projection);
    active = null;
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
      if (!isSource && projection && projection.layout !== layout) {
        if (active === projection) {
          detach(active.record);
          active = null;
        }
        projection = drop(projection);
      }
      let slot = isSource ? source : projection;
      if (slot && slot === active) return false;
      if (active) detach(active.record);
      if (!slot) {
        slot = { layout, record: build(layout, nextKey) };
        if (isSource) source = slot;
        else projection = slot;
      }
      attach(slot.record);
      active = slot;
      return true;
    },
  };
}
