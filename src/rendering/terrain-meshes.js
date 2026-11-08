import * as THREE from 'three';
import { resolveRiverSurface } from '../generation/river-surface-cache.js';
import { addMesh, geometryFrom } from './geometry.js';
import { surfaceHeight, TOP_RADIUS } from '../generation/math.js';
import { pixelUV } from './pixel-model-geometry.js';
import {
  riverBankValue,
  riverIslandValue,
  riverLandValue,
  riverBankHeight,
  riverTopHeight,
} from '../generation/river-surfaces.js';

export function createTerrainBuilder({
  materials,
  makeCrossing,
  pixelModelMaterial,
  pixelTerrainMaterial,
}) {
  const modelMaterial = pixelModelMaterial ?? ((role) => materials[role]);
  const terrainMaterial = pixelTerrainMaterial ?? ((role) => materials[role]);
  const textured = (geometry, data, horizontal = false, verticalOffset = data.top) =>
    pixelTerrainMaterial
      ? pixelUV(geometry, {
          repeat: 0.64,
          offset: [data.wx, verticalOffset, data.wz],
          horizontal,
          indexed: false,
        })
      : geometry;
  function groundMaterial(data) {
    if (!pixelTerrainMaterial) return data.tone ? materials.groundLight : materials.ground;
    const forest = data.terrain?.includes('forest') || data.terrain === 'taiga';
    // Match existing dressing modifiers without changing saved/generated data.
    const temperature =
      data.pointOfLight || data.terrain === 'farmlands'
        ? 2 / 3
        : data.terrain === 'wetlands'
          ? -2 / 3
          : forest
            ? data.treeVariant === 1
              ? 2 / 3
              : -2 / 3
            : 0;
    return pixelTerrainMaterial(
      forest || data.terrain === 'meadow' ? 'foliage' : 'ground',
      temperature,
      !!data.tone,
    );
  }
  function waterGeometry(geometry, data) {
    if (!pixelTerrainMaterial) return geometry;
    textured(geometry, data, true);
    const positions = geometry.attributes.position,
      colors = [];
    for (let i = 0; i < positions.count; i++) {
      const depth = data.waterDepth
        ? surfaceHeight(data.waterDepth, positions.getX(i), positions.getZ(i))
        : 0;
      const shade = 1 - depth * 0.32;
      colors.push(shade, shade, shade);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geometry;
  }
  function bevelTile(height, isWater, corners = null, shared = null) {
    const rings = isWater
      ? [
          [0.97, 0],
          [1, 0.025],
          [1, height - 0.025],
          [0.976, height],
        ]
      : [
          [0.955, 0],
          [1, 0.045],
          [1, height - 0.075],
          [TOP_RADIUS, height],
        ];
    const points = [],
      groups = [];
    const p = (radius, y, k, top = false) =>
      top && corners
        ? [corners[k % 6][0], y, corners[k % 6][1]]
        : [Math.sin((k * Math.PI) / 3) * radius, y, Math.cos((k * Math.PI) / 3) * radius];
    for (let j = 0; j < rings.length - 1; j++) {
      const start = points.length / 3;
      for (let k = 0; k < 6; k++) {
        if (shared && shared[(7 - k) % 6]) continue;
        const a = p(...rings[j], k),
          b = p(...rings[j], k + 1),
          c = p(...rings[j + 1], k, j === 2),
          d = p(...rings[j + 1], k + 1, j === 2);
        points.push(...a, ...b, ...c, ...b, ...d, ...c);
      }
      groups.push({ start, count: points.length / 3 - start, materialIndex: j === 2 ? 1 : 0 });
    }
    if (!corners) {
      const start = points.length / 3;
      for (let k = 0; k < 6; k++)
        points.push(0, height, 0, ...p(...rings[3], k), ...p(...rings[3], k + 1));
      groups.push({ start, count: 18, materialIndex: 2 });
    }
    const geo = geometryFrom(points);
    groups.forEach((g) => geo.addGroup(g.start, g.count, g.materialIndex));
    return geo;
  }
  function makeRidge(parent, surface, data) {
    const points = [],
      groups = [],
      buckets = [[], [], [], []];
    for (const face of surface.triangles) {
      const [a, b, c] = face.map((i) => surface.vertices[i]),
        ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const normal = [
          ab[1] * ac[2] - ab[2] * ac[1],
          ab[2] * ac[0] - ab[0] * ac[2],
          ab[0] * ac[1] - ab[1] * ac[0],
        ],
        up = normal[1] / Math.hypot(...normal),
        height = (a[1] + b[1] + c[1]) / 3;
      const materialIndex = height < 0.14 ? 3 : up < 0.67 ? 2 : height > 0.48 ? 1 : 0;
      buckets[materialIndex].push(...a, ...b, ...c);
    }
    buckets.forEach((bucket, materialIndex) => {
      if (bucket.length) {
        groups.push({ start: points.length / 3, count: bucket.length / 3, materialIndex });
        points.push(...bucket);
      }
    });
    const geo = geometryFrom(points);
    groups.forEach((g) => geo.addGroup(g.start, g.count, g.materialIndex));
    addMesh(parent, textured(geo, data), [
      modelMaterial('ridge'),
      modelMaterial('ridgeLight'),
      modelMaterial('ridgeDark'),
      pixelTerrainMaterial ? groundMaterial(data) : materials.ridgeMeadow,
    ]);
  }
  function smoothTerrainGeometry(surface, cell) {
    if (cell.bankBevel) {
      const groups = [[], []];
      surface.triangles.forEach((face, index) => {
        for (const vertex of face)
          groups[surface.materialIndices[index]].push(...surface.vertices[vertex]);
      });
      // Separate faces retain the exact sharp normals and material of the
      // ordinary land bevel; sharing/averaging normals rounds the tile edge.
      const geometry = geometryFrom([...groups[0], ...groups[1]]);
      geometry.addGroup(0, groups[0].length / 3, 0);
      geometry.addGroup(groups[0].length / 3, groups[1].length / 3, 1);
      return geometry;
    }
    const geometry = new THREE.BufferGeometry(),
      points = surface.vertices.flat(),
      normals = [];
    for (const [x, , z] of surface.vertices) {
      const wx = x + cell.wx,
        wz = z + cell.wz;
      if (riverIslandValue(cell.river, wx, wz) > riverBankValue(cell.river, wx, wz)) {
        normals.push(0, 1, 0);
        continue;
      }
      const e = 0.002,
        dx =
          (riverBankHeight(cell.river, wx + e, wz) - riverBankHeight(cell.river, wx - e, wz)) /
          (2 * e),
        dz =
          (riverBankHeight(cell.river, wx, wz + e) - riverBankHeight(cell.river, wx, wz - e)) /
          (2 * e),
        length = Math.hypot(dx, 1, dz);
      normals.push(-dx / length, 1 / length, -dz / length);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(surface.triangles.flat());
    return geometry;
  }
  function makeLandBankJoin(parent, data) {
    if (!data.shoreCornerHeights) return;
    const points = [];
    for (let sector = 0; sector < 6; sector++)
      if (data.shoreLinks[(7 - sector) % 6]) {
        const corner = (k, outer) => {
          k %= 6;
          const a = (k * Math.PI) / 3,
            x = outer ? Math.sin(a) : data.corners ? data.corners[k][0] : Math.sin(a) * TOP_RADIUS,
            z = outer ? Math.cos(a) : data.corners ? data.corners[k][1] : Math.cos(a) * TOP_RADIUS,
            y = outer
              ? data.shoreCornerHeights[k] - data.top
              : data.surface
                ? surfaceHeight(data.surface, x, z)
                : 0;
          return [x, y, z];
        };
        const a = corner(sector, false),
          b = corner(sector + 1, false),
          c = corner(sector, true),
          d = corner(sector + 1, true);
        points.push(...a, ...c, ...d, ...a, ...d, ...b);
      }
    if (points.length)
      addMesh(parent, textured(geometryFrom(points), data, true), modelMaterial('riverGround'));
  }
  function makeRiver(parent, data) {
    const surface = resolveRiverSurface(data.riverSurface),
      water = [],
      cliffs = [],
      normals = [];
    if (surface.triangles.length)
      addMesh(
        parent,
        textured(smoothTerrainGeometry(surface, data), data, true),
        data.bankBevel
          ? [modelMaterial('riverGround'), terrainMaterial('bevel')]
          : modelMaterial('riverGround'),
      );
    if (surface.water) {
      for (const face of surface.water.triangles)
        for (const index of face) water.push(...surface.water.vertices[index]);
    } else
      for (let k = 0; k < 6; k++) {
        const a = data.riverCorners[k],
          b = data.riverCorners[(k + 1) % 6];
        water.push(0, 0, 0, a[0], 0, a[1], b[0], 0, b[1]);
      }
    const waterMesh = addMesh(
      parent,
      waterGeometry(geometryFrom(water), data),
      terrainMaterial('water'),
    );
    waterMesh.castShadow = false;
    function normal(p) {
      const x = data.wx + p[0],
        z = data.wz + p[2],
        e = 0.002,
        dx = riverLandValue(data.river, x + e, z) - riverLandValue(data.river, x - e, z),
        dz = riverLandValue(data.river, x, z + e) - riverLandValue(data.river, x, z - e),
        length = Math.hypot(dx, dz) || 1;
      return [-dx / length, 0, -dz / length];
    }
    function wall(a, b, na = normal(a), nb = normal(b)) {
      if ((b[2] - a[2]) * na[0] - (b[0] - a[0]) * na[2] < 0) {
        [a, b] = [b, a];
        [na, nb] = [nb, na];
      }
      const c = [a[0], -0.008, a[2]],
        d = [b[0], -0.008, b[2]];
      cliffs.push(...a, ...b, ...c, ...b, ...d, ...c);
      normals.push(...na, ...nb, ...na, ...nb, ...nb, ...na);
    }
    for (const [a, b] of surface.shore) wall(a, b);
    // At the map edge, close exposed land. At neighbouring land, only close a
    // water-reaching section; otherwise the matching bank and land form one top.
    for (let k = 0; k < 6; k++)
      if (!data.riverShared[(7 - k) % 6]) {
        const a = data.riverCorners[k],
          b = data.riverCorners[(k + 1) % 6],
          land = data.riverLandSides[(7 - k) % 6],
          at = (t) => {
            const x = a[0] + (b[0] - a[0]) * t,
              z = a[1] + (b[1] - a[1]) * t;
            return { x, z, v: riverLandValue(data.river, data.wx + x, data.wz + z) };
          };
        for (let j = 0; j < 28; j++) {
          let p = at(j / 28),
            q = at((j + 1) / 28);
          const keep = (v) => (land ? v < 0 : v >= 0);
          if (!keep(p.v) && !keep(q.v)) continue;
          if (keep(p.v) !== keep(q.v)) {
            const t = p.v / (p.v - q.v),
              m = { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, v: 0 };
            if (keep(p.v)) q = m;
            else p = m;
          }
          const point = (p) => [p.x, riverTopHeight(data, p.x, p.z), p.z],
            dx = b[0] - a[0],
            dz = b[1] - a[1],
            length = Math.hypot(dx, dz),
            n = land ? [-dz / length, 0, dx / length] : [dz / length, 0, -dx / length];
          wall(point(p), point(q), n, n);
        }
      }
    if (cliffs.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(cliffs, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      addMesh(parent, textured(g, data), modelMaterial('riverCliff'));
    }
    if (data.crossing && makeCrossing) makeCrossing(parent, data.crossing);
  }
  return function makeTerrain(data) {
    const g = new THREE.Group();
    g.position.set(Math.sqrt(3) * (data.q + data.r / 2), 0, 1.5 * data.r);
    const river = !!data.riverSurface;
    const openWater = data.type === 'Open water';
    const water = river || openWater;
    addMesh(
      g,
      textured(
        data.roadSurface
          ? roadTerrainGeometry(data.roadSurface)
          : bevelTile(
              data.top,
              water,
              river
                ? data.riverCorners
                : openWater
                  ? Array.from({ length: 6 }, (_, k) => [
                      Math.sin((k * Math.PI) / 3),
                      Math.cos((k * Math.PI) / 3),
                    ])
                  : data.corners,
              water
                ? (data.riverShared ?? data.openWaterShared)
                : data.surface
                  ? data.shared
                  : null,
            ),
        data,
        false,
        0,
      ),
      [
        terrainMaterial('side'),
        water && !(data.water === 'river' && data.clipWater)
          ? terrainMaterial('waterDeep')
          : terrainMaterial('bevel'),
        water ? materials.water : groundMaterial(data),
      ],
    );
    const content = new THREE.Group();
    content.position.y = data.top;
    g.add(content);
    if (data.surface) makeRidge(content, data.surface, data);
    if (river) makeRiver(content, data);
    else if (openWater) {
      const vertices = [];
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3,
          b = ((k + 1) * Math.PI) / 3;
        vertices.push(0, 0, 0, Math.sin(a), 0, Math.cos(a), Math.sin(b), 0, Math.cos(b));
      }
      const surface = addMesh(
        content,
        waterGeometry(geometryFrom(vertices), data),
        terrainMaterial('water'),
      );
      surface.castShadow = false;
    } else makeLandBankJoin(content, data);
    return { g, content };
  };
}

function roadTerrainGeometry(surface) {
  const buckets = [[], [], []];
  surface.triangles.forEach((face, i) =>
    face.forEach((vertex) => buckets[surface.materialIndices[i]].push(...surface.vertices[vertex])),
  );
  const geometry = geometryFrom(buckets.flat());
  let start = 0;
  buckets.forEach((vertices, materialIndex) => {
    geometry.addGroup(start, vertices.length / 3, materialIndex);
    start += vertices.length / 3;
  });
  return geometry;
}
