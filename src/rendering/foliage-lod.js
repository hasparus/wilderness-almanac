// A single batch and index buffer hold both levels. Switching draw ranges adds
// no objects, draw calls, per-frame allocations or geometry uploads.
export function installFoliageLOD(mesh, nearCount, farCount, pixelSize) {
  const geometry = mesh.geometry;
  const near = { start: 0, count: nearCount };
  const far = { start: nearCount, count: farCount };
  let distant = false;
  let savedStart = 0,
    savedCount = nearCount;
  mesh.userData.foliageLOD = { near, far, pixelSize };
  geometry.setDrawRange(near.start, near.count);
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    if (camera.isOrthographicCamera) {
      const pixels =
        (pixelSize * renderer.domElement.width * camera.zoom) / (camera.right - camera.left);
      // Hysteresis prevents a crown from flickering between models near a zoom
      // threshold. Inspector close-ups always retain the original geometry.
      if (pixels < 0.95) distant = true;
      else if (pixels > 1.25) distant = false;
    } else distant = false;
    const range = distant ? far : near;
    geometry.setDrawRange(range.start, range.count);
  };
  // Shadows use the same coarse volume, seed and wind weights. Restoring the
  // range also keeps picking correct between shadow and colour passes.
  mesh.onBeforeShadow = () => {
    savedStart = geometry.drawRange.start;
    savedCount = geometry.drawRange.count;
    geometry.setDrawRange(far.start, far.count);
  };
  mesh.onAfterShadow = () => geometry.setDrawRange(savedStart, savedCount);
}
