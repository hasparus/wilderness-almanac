import * as THREE from 'three';

export function addMesh(parent, geometry, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function geometryFrom(points) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  g.computeVertexNormals();
  return g;
}

export function terrainFootingGeometry(radius, heights) {
  const vertices = [];
  const point = (index, y) => [
    Math.cos((index * Math.PI) / 6) * radius,
    y,
    Math.sin((index * Math.PI) / 6) * radius,
  ];
  for (let k = 0; k < 12; k++) {
    const next = (k + 1) % 12;
    const a = point(k, 0.004),
      b = point(next, 0.004);
    const c = point(k, heights[k]),
      d = point(next, heights[next]);
    vertices.push(0, 0.004, 0, ...b, ...a, ...a, ...b, ...c, ...b, ...d, ...c);
  }
  return geometryFrom(vertices);
}

// Geometry belongs to the map; materials are shared and disposed by their owner.
export function disposeGeometries(objects) {
  const geometries = new Set();
  for (const object of objects)
    object.traverse((child) => {
      if (child.geometry) geometries.add(child.geometry);
    });
  geometries.forEach((geometry) => geometry.dispose());
}
export function clearGeometries(root) {
  const children = [...root.children];
  root.clear();
  disposeGeometries(children);
}
