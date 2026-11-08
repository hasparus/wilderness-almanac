import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addMesh, disposeGeometries } from './geometry.js';
import { windWeight } from './ambient-motion.js';
import { createTerrainBuilder } from './terrain-meshes.js';
import { createNatureBuilder } from './nature-props.js';
import { createNatureBuilder as createPixelNatureBuilder } from './pixel-nature-props.js';
import { mapArtStyle } from '../application/map-art-style.js';
import { createCrossingBuilder } from './crossings.js';
import { createPoiBuilder } from './poi-props.js';
import { createSettlementBuilder, roofGeometry } from './settlement-props.js';
import { createRoadBuilder } from './roads.js';
import { pixelModelMesh, steppedRoofGeometry } from './pixel-model-geometry.js';
import { crownGeometry } from './pixel-foliage-geometry.js';
import { compactFoliageGeometry, installFoliageLOD } from './foliage-lod.js';

// Own map geometry and prop batches; the material registry outlives rebuilds.
export function createMapMeshes(
  {
    materials,
    propMaterial,
    pixelMaterial,
    pixelDeciduousMaterial,
    pixelBarkMaterial,
    pixelPropMaterial,
    pixelModelMaterial,
    pixelTerrainMaterial,
    treeDepth,
    waveDirection,
    fogMaterial = (material) => material,
  },
  { artStyle = 'low-poly' } = {},
) {
  const map = new THREE.Group();
  const cells = [];
  const lightSources = [];
  let pendingLights = [];
  let lightFeature;
  const registerLight = (parent, source) =>
    pendingLights.push({ parent, feature: lightFeature, ...source });
  let style,
    makeTerrain,
    makeCrossing,
    makeTree,
    makeRock,
    makeGrass,
    makePuddle,
    makeReeds,
    makeCrops,
    makeWave,
    makeHouse,
    makeTower,
    makeHall,
    makeBarrier,
    makePoi,
    makeRoads;
  function configure(value) {
    style = mapArtStyle(value);
    const pixel = style === 'pixelart';
    const modelMesh = pixel ? pixelModelMesh : addMesh;
    const material = pixel ? pixelModelMaterial : propMaterial;
    const roof = pixel ? steppedRoofGeometry : roofGeometry;
    makeTerrain = createTerrainBuilder({
      materials,
      makeCrossing: pixel ? undefined : createCrossingBuilder(materials),
      pixelModelMaterial: pixel ? pixelModelMaterial : undefined,
      pixelTerrainMaterial: pixel ? pixelTerrainMaterial : undefined,
    });
    makeCrossing = pixel
      ? createCrossingBuilder(
          Object.fromEntries(
            ['rock', 'rockLight', 'rockMid', 'bridgeWood', 'bridgeLight', 'bridgeDark'].map(
              (role) => [role, pixelModelMaterial(role)],
            ),
          ),
          { addMesh: pixelModelMesh },
        )
      : null;
    ({ makeTree, makeRock, makeGrass, makePuddle, makeReeds, makeCrops, makeWave } = (
      pixel ? createPixelNatureBuilder : createNatureBuilder
    )({
      materials,
      propMaterial,
      pixelMaterial,
      pixelDeciduousMaterial,
      pixelBarkMaterial,
      pixelPropMaterial,
    }));
    ({ makeHouse, makeTower, makeHall, makeBarrier } = createSettlementBuilder({
      addMesh: modelMesh,
      propMaterial: material,
      roofGeometry: roof,
      registerLight,
    }));
    makePoi = createPoiBuilder({
      addMesh: modelMesh,
      propMaterial: material,
      makeHouse,
      makeTower,
      roofGeometry: roof,
      registerLight,
      pixelart: pixel,
    });
    makeRoads = createRoadBuilder({
      propMaterial,
      pixelModelMaterial: pixel ? pixelModelMaterial : undefined,
      pixelPropMaterial: pixel ? pixelPropMaterial : undefined,
    });
  }
  configure(artStyle);
  // A build is a record with its own group; show replaces whatever is shown
  // and release disposes a record. The renderer decides which records to keep
  // (see map-builds.js); setMap is the plain replace-everything path.
  let shown = null;
  function build(layout, options = {}) {
    if (options.artStyle !== undefined && mapArtStyle(options.artStyle) !== style)
      configure(options.artStyle);
    return buildMap(layout);
  }
  function show(record) {
    const previous = shown;
    if (previous) map.remove(previous.root);
    cells.length = 0;
    lightSources.length = 0;
    if (record) {
      map.add(record.root);
      cells.push(...record.cells);
      lightSources.push(...record.lightSources);
      if (record.wave) waveDirection.value.copy(record.wave);
    }
    shown = record;
    return previous;
  }
  function release(record) {
    if (record) disposeGeometries([record.root]);
  }
  const setMap = (layout, options) => release(show(build(layout, options)));
  function buildMap(layout) {
    const root = new THREE.Group();
    const record = { root, cells: [], lightSources: [], wave: null };
    const propBatches = new Map();
    const wave = layout.flatMap((cell) => cell.props).find((prop) => prop.kind === 'wave');
    if (wave) record.wave = new THREE.Vector2(Math.cos(wave.angle), Math.sin(wave.angle));
    for (const data of layout) {
      pendingLights = [];
      const { g, content } = makeTerrain(data);
      const propRoot = new THREE.Group();
      content.add(propRoot);
      makeRoads(propRoot, data);
      if (data.crossing && makeCrossing) makeCrossing(propRoot, data.crossing);
      const treeContext = {
        terrain: data.terrain,
        deciduousCount: data.props.filter((prop) => prop.kind === 'tree' && prop.variant === 1)
          .length,
      };
      for (const prop of data.props) {
        lightFeature = prop.kind === 'poi' ? prop.poiKind : data.pointOfLight?.type;
        if (prop.kind === 'tree') makeTree(propRoot, prop, data.forest, treeContext);
        else if (prop.kind === 'house') makeHouse(propRoot, prop);
        else if (prop.kind === 'tower') makeTower(propRoot, prop);
        else if (prop.kind === 'hall') makeHall(propRoot, prop);
        else if (prop.kind === 'city-wall' || prop.kind === 'fence') makeBarrier(propRoot, prop);
        else if (prop.kind === 'rock') makeRock(propRoot, prop);
        else if (prop.kind === 'grass') makeGrass(propRoot, prop);
        else if (prop.kind === 'puddle') makePuddle(propRoot, prop);
        else if (prop.kind === 'reeds') makeReeds(propRoot, prop);
        else if (prop.kind === 'crops') makeCrops(propRoot, prop, data);
        else if (prop.kind === 'wave') makeWave(propRoot, prop);
        else if (prop.kind === 'poi') makePoi(propRoot, prop);
        else {
          const mesh = addMesh(
            propRoot,
            new THREE.BoxGeometry(0.18 * prop.scale, 0.003, 0.015),
            materials.waterEdge,
            prop.x,
            0.003,
            prop.z,
          );
          mesh.rotation.y = prop.angle;
          mesh.castShadow = false;
        }
      }
      if (data.fogState)
        g.traverse((object) => {
          if (object.isMesh) object.material = fogMaterial(object.material, data.fogState);
        });
      // Keep the existing component meshes, then bake static props by material.
      // Face ranges retain hex selection after merging across the whole map.
      propRoot.updateWorldMatrix(true, true);
      if (!data.fogState || data.fogState === 'visited')
        for (const { parent, ...source } of pendingLights)
          record.lightSources.push({ ...source, matrix: parent.matrixWorld.clone(), tile: data });
      propRoot.traverse((object) => {
        if (!object.isMesh) return;
        const pixelProp = Boolean(
          object.material.userData.pixelFoliage ||
          object.material.userData.pixelDressing ||
          object.material.userData.pixelModel,
        );
        let plant = object;
        while (plant && !plant.userData.wind) plant = plant.parent;
        const base = plant ? new THREE.Vector3().setFromMatrixPosition(plant.matrixWorld).y : 0;
        const foliage = Boolean(object.userData.foliageFar);
        // Chunk the expensive crowns/fields. Tiny dressing stays in shared
        // map-wide batches rather than adding draw calls for every patch.
        const chunkSize =
          object.material.userData.pixelFoliage ||
          object.material.userData.pixelDressing?.kind === 'grain'
            ? 4
            : object.material.userData.pixelDressing?.kind === 'vine'
              ? 8
              : 0;
        const chunk = chunkSize
          ? `${Math.floor(data.q / chunkSize)},${Math.floor(data.r / chunkSize)}`
          : '';
        const batchKey = `${object.material.uuid}:${object.castShadow}:${chunk}`;
        if (!propBatches.has(batchKey))
          propBatches.set(batchKey, {
            material: object.material,
            castShadow: object.castShadow,
            geometries: [],
            farGeometries: [],
            faceRanges: [],
            farFaceRanges: [],
            faces: 0,
            farFaces: 0,
            pixelSize: 0,
          });
        const batch = propBatches.get(batchKey);
        for (const far of foliage ? [false, true] : [false]) {
          const geometry = far
            ? crownGeometry(object.userData.foliageFar)
            : object.geometry.index && !pixelProp
              ? object.geometry.toNonIndexed()
              : object.geometry.clone();
          geometry.applyMatrix4(object.matrixWorld);
          for (const name of Object.keys(geometry.attributes))
            if (name !== 'position' && name !== 'normal' && !(name === 'uv' && object.material.map))
              geometry.deleteAttribute(name);
          const positions = geometry.attributes.position;
          const sway = new Float32Array(positions.count);
          for (let i = 0; i < positions.count; i++)
            sway[i] = plant ? windWeight(positions.getY(i) - base, plant.userData.wind) : 0;
          geometry.setAttribute('swayWeight', new THREE.BufferAttribute(sway, 1));
          if (foliage) compactFoliageGeometry(geometry);
          else {
            const phase = new Float32Array(positions.count).fill(object.userData.wavePhase ?? 0);
            geometry.setAttribute('wavePhase', new THREE.BufferAttribute(phase, 1));
          }
          const faces = (geometry.index?.count ?? positions.count) / 3;
          if (far) {
            batch.farGeometries.push(geometry);
            batch.farFaces += faces;
            batch.farFaceRanges.push({ end: batch.farFaces, key: data.key });
          } else {
            batch.geometries.push(geometry);
            batch.faces += faces;
            batch.faceRanges.push({ end: batch.faces, key: data.key });
          }
        }
        if (foliage)
          batch.pixelSize = Math.max(
            batch.pixelSize,
            object.userData.foliagePixelSize * object.matrixWorld.getMaxScaleOnAxis(),
          );
        object.geometry.dispose();
      });
      propRoot.removeFromParent();
      g.traverse((o) => {
        if (o.isMesh) o.userData.key = data.key;
      });
      root.add(g);
      record.cells.push({ ...data, g });
    }
    pendingLights = [];
    for (const batch of propBatches.values()) {
      const parts = [...batch.geometries, ...batch.farGeometries];
      const geometry = mergeGeometries(parts);
      parts.forEach((part) => part.dispose());
      if (batch.material.userData.pixelFoliage || batch.material.userData.pixelDressing) {
        geometry.computeBoundingSphere();
        geometry.boundingSphere.radius += 0.35; // Include the strongest wind gust.
      }
      const mesh = addMesh(root, geometry, batch.material);
      mesh.castShadow = batch.castShadow;
      mesh.userData.faceRanges = batch.faceRanges.concat(
        batch.farFaceRanges.map(({ end, key }) => ({ end: end + batch.faces, key })),
      );
      if (batch.farFaces)
        installFoliageLOD(mesh, batch.faces * 3, batch.farFaces * 3, batch.pixelSize);
      if (batch.material.userData.treeSway) mesh.customDepthMaterial = treeDepth;
    }
    return record;
  }
  return {
    group: map,
    cells,
    lightSources,
    build,
    show,
    release,
    setMap,
    dispose() {
      release(show(null));
      pendingLights = [];
    },
  };
}
