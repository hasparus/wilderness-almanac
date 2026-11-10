import { BufferAttribute, BufferGeometry } from 'three';

const crownTemplates = new WeakMap();

// Merge exposed geometry independently of pixel colour boundaries.
export function voxelFaces({ dims, step, origin, data, shade }) {
  const faces = [];
  const at = ([x, y, z]) =>
    x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2]
      ? 0
      : data[(y * dims[2] + z) * dims[0] + x];
  // Merge adjacent exposed voxel faces into rectangles, including hidden undersides.
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3,
      v = (axis + 2) % 3;
    const width = dims[u],
      depth = dims[v];
    for (const sign of [-1, 1]) {
      for (let slice = 0; slice < dims[axis]; slice++) {
        const mask = new Uint8Array(width * depth);
        for (let j = 0; j < depth; j++) {
          for (let i = 0; i < width; i++) {
            const coords = [];
            coords[axis] = slice;
            coords[u] = i;
            coords[v] = j;
            if (!at(coords)) continue;
            const next = coords.slice();
            next[axis] += sign;
            if (!at(next)) mask[j * width + i] = 1;
          }
        }
        for (let j = 0; j < depth; j++) {
          for (let i = 0; i < width;) {
            const tone = mask[j * width + i];
            if (!tone) {
              i++;
              continue;
            }
            let w = 1,
              h = 1;
            while (i + w < width && mask[j * width + i + w] === tone) w++;
            row: while (j + h < depth) {
              for (let k = 0; k < w; k++) if (mask[(j + h) * width + i + k] !== tone) break row;
              h++;
            }
            const p = origin.slice();
            p[axis] += (slice + (sign > 0 ? 1 : 0)) * step[axis];
            p[u] += i * step[u];
            p[v] += j * step[v];
            const a = p.slice(),
              b = p.slice(),
              c = p.slice();
            a[u] += w * step[u];
            b[u] += w * step[u];
            b[v] += h * step[v];
            c[v] += h * step[v];
            const texels = [];
            for (let row = 0; row < h; row++)
              for (let col = 0; col < w; col++) {
                const coords = [];
                coords[axis] = slice;
                coords[u] = i + col;
                coords[v] = j + row;
                texels.push(shade(coords, axis, sign));
              }
            faces.push({
              points: [...p, ...a, ...b, ...c],
              width: w,
              height: h,
              sign,
              normal: [0, 1, 2].map((direction) => (direction === axis ? sign : 0)),
              texels,
            });
            for (let row = 0; row < h; row++)
              mask.fill(0, (j + row) * width + i, (j + row) * width + i + w);
            i += w;
          }
        }
      }
    }
  }
  return faces;
}

// Coarse crowns keep the same seeded volume and sample its original colour
// pattern. They are only shown once the original voxel is smaller than a pixel.
export function foliageVoxelLevels(options) {
  const { dims, step, origin, data, shade } = options;
  const coarseDims = dims.map((size, axis) =>
    axis === 1 ? Math.ceil(size / 2) : Math.ceil(size / 4) * 2 - 1,
  );
  const ratio = dims.map((size, axis) => size / coarseDims[axis]);
  const coarse = new Uint8Array(coarseDims[0] * coarseDims[1] * coarseDims[2]);
  const source = (coords) =>
    coords.map((value, axis) => Math.min(dims[axis] - 1, Math.floor((value + 0.5) * ratio[axis])));
  for (let y = 0; y < coarseDims[1]; y++)
    for (let z = 0; z < coarseDims[2]; z++)
      for (let x = 0; x < coarseDims[0]; x++) {
        const [sx, sy, sz] = source([x, y, z]);
        coarse[(y * coarseDims[2] + z) * coarseDims[0] + x] =
          data[(sy * dims[2] + sz) * dims[0] + sx];
      }
  return {
    near: voxelFaces(options),
    far: voxelFaces({
      dims: coarseDims,
      step: step.map((size, axis) => size * ratio[axis]),
      origin,
      data: coarse,
      shade: (coords, axis, sign) => shade(source(coords), axis, sign),
    }),
  };
}

export function packFoliageAtlas(forms, { compact = false } = {}) {
  const width = 256;
  let x = 0,
    y = 0,
    rowHeight = 0;
  const crowns = new Map(
    [...forms].map(([key, faces]) => [
      key,
      {
        faces,
        points: [],
        normals: [],
        uvs: [],
        indices: [],
      },
    ]),
  );
  const patches = [...crowns.values()]
    .flatMap((crown) => crown.faces)
    .sort((a, b) => b.height - a.height || b.width - a.width);
  for (const face of patches) {
    if (x + face.width + 2 > width) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    face.x = x + 1;
    face.y = y + 1;
    x += face.width + 2;
    rowHeight = Math.max(rowHeight, face.height + 2);
  }
  // Nearest-filtered, clamped textures need neither mipmaps nor power-of-two
  // padding. Other prop atlases retain their existing layout by default.
  const height = compact ? y + rowHeight : 2 ** Math.ceil(Math.log2(y + rowHeight));
  const indices = new Uint8Array(width * height);
  for (const crown of crowns.values()) {
    for (const face of crown.faces) {
      // A one-texel gutter protects adjacent atlas patches at their edges.
      for (let row = -1; row <= face.height; row++)
        for (let col = -1; col <= face.width; col++) {
          const u = Math.max(0, Math.min(face.width - 1, col));
          const v = Math.max(0, Math.min(face.height - 1, row));
          indices[(face.y + row) * width + face.x + col] = face.texels[v * face.width + u];
        }
      const p = [face.x / width, face.y / height];
      const a = [(face.x + face.width) / width, p[1]];
      const b = [a[0], (face.y + face.height) / height];
      const c = [p[0], b[1]];
      const start = crown.points.length / 3;
      crown.points.push(...face.points);
      for (let corner = 0; corner < 4; corner++) crown.normals.push(...face.normal);
      crown.uvs.push(...p, ...a, ...b, ...c);
      const order = face.sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      crown.indices.push(...order.map((index) => start + index));
    }
    delete crown.faces;
  }
  return { width, height, indices, crowns };
}

export function crownTemplate(crown) {
  let template = crownTemplates.get(crown);
  if (!template) {
    const IndexArray = crown.indices.some((index) => index >= 65535) ? Uint32Array : Uint16Array;
    template = Object.freeze({
      position: new Float32Array(crown.points),
      normal: new Float32Array(crown.normals),
      uv: new Float32Array(crown.uvs),
      index: new IndexArray(crown.indices),
    });
    crownTemplates.set(crown, template);
  }
  return template;
}

export function crownGeometry(crown) {
  const template = crownTemplate(crown);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(template.position, 3));
  geometry.setAttribute('normal', new BufferAttribute(template.normal, 3));
  geometry.setAttribute('uv', new BufferAttribute(template.uv, 2));
  geometry.setIndex(new BufferAttribute(template.index, 1));
  return geometry;
}
