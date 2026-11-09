// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMountainRanges } from '../src/generation/mountain-surfaces.js';
import { prepareMap } from '../src/generation/presentation.js';
import { createCampaign, exportCampaign, importCampaign } from '../src/application/campaigns.js';
import {
  campaignWorld,
  campaignDressing,
  updateHex,
  lockHex,
} from '../src/generation/campaign-world.js';

/**
 * @typedef {import('../src/generation/mountain-surfaces.js').MountainWorld} MountainWorld
 * @typedef {import('../src/generation/mountain-surfaces.js').MountainDressing} MountainDressing
 */

/** @type {Record<string, string>} */
const baseline0be68bf = {
  '7/0': 'c5d1e55c280a5adf24a92d666bfeab2bae89c972cc83c3abbfea2c221645e97a',
  '7/3': 'd92596a800fcea659dd7e665eae24708736c8c08ba8e7554af1a86f86980f494',
  '7/profile0-revision': '3965f47b53d78db5567d305e1334ad03555322949ff3cd7edd56c6449ce013df',
  '7/0/revision': '8db3210126ce2b74d07e1e98f2d5422e13e31928b0c881c25f3735d35f785bb6',
  '7/3/revision': '2cf63faf1ef0f3b706903216b9e8f249cd6e5f4b8b01dd6980cc75b1407964b4',
  '7/edited-locked': 'dce8a9d1aa68318c20f84c3fc2faad2f4214b077aa2e7f189ff8b92a941b6127',
  '77/0': '8f8da6fbc30a37f2f32c3147cc3bc687c914b7276c529ec2a947c73239598af4',
  '77/3': 'b04c55defce6459c537d0bb4a37f8a0e7981db12aba39352a42b7164fff6e338',
  '77/profile0-revision': '38d738134608bd27da00717a90e8be4de3aabbdc8bf9b1511844abb4e0a73931',
  '77/0/revision': '2dd75e303f3b8b1feebdf3443680b666a0893a2921d4b027f69ff45d6e29ed92',
  '77/3/revision': 'a97621136ea1289156348e1e8f0fc75c70d2d4366cb60aeae32c7313cae625a4',
  '77/edited-locked': '8ef84edf77ea54b0ba813da781af35da5ef24e94a36bd4e7d8329fac134e275f',
};

/** @param {MountainWorld} world @param {MountainDressing} dressing @param {string} [baselineCase] */
function assertUncachedEqual(world, dressing, baselineCase) {
  const before = structuredClone({ world, dressing });
  const uncached = prepareMountainRanges(structuredClone(world), structuredClone(dressing));
  assert.deepEqual(prepareMountainRanges(world, dressing), uncached);
  assert.deepEqual(prepareMountainRanges(world, dressing), uncached);
  assert.deepEqual({ world, dressing }, before);
  if (baselineCase) {
    const hash = createHash('sha256')
      .update(JSON.stringify([...uncached], (_key, value) => (Object.is(value, -0) ? '-0' : value)))
      .digest('hex');
    assert.equal(hash, baseline0be68bf[baselineCase]);
  }
  return uncached;
}

for (const seed of ['7', '77']) {
  test(`seed ${seed} variants, profile-0 locks and local revisions match uncached surfaces`, () => {
    /** @type {MountainWorld} */
    const world = generateWorld(seed, { generatorVersion: 10 });
    assert.ok(world.elevation.ranges.length);
    for (const variant of [0, 3]) {
      assertUncachedEqual(world, generateDressing(world, variant), `${seed}/${variant}`);
      const mountainLocks = Object.fromEntries(
        world.elevation.ranges.map((range) => [
          range.id,
          {
            phase: 0.7,
            angle: 1.2,
            heightScale: 0.6,
          },
        ]),
      );
      const revisions = { [world.elevation.ranges[0].hexKeys[0]]: 2 };
      /** @type {MountainDressing} */
      const locked = generateDressing(world, variant, { mountainLocks, revisions });
      assert.ok(locked.mountains.every((shape) => shape.profile === 0));
      assertUncachedEqual(world, locked, `${seed}/profile0-revision`);
      assertUncachedEqual(
        world,
        generateDressing(world, variant, { revisions }),
        `${seed}/${variant}/revision`,
      );
    }
  });

  test(`seed ${seed} structural edits and locked campaign replay match uncached surfaces`, () => {
    const base = generateWorld(seed, { generatorVersion: 10 });
    const key = base.elevation.ranges[0].hexKeys[0];
    let campaign = createCampaign(base, ['#cdab8f', '#0b365e', '#11b329'], 'test');
    const locked = generateDressing(base, campaign.variant, {
      mountainLocks: {
        [base.elevation.ranges[0].id]: { phase: 0.7, angle: 1.2, heightScale: 0.6 },
      },
    });
    campaign = lockHex(campaign, key, base, locked);
    /** @type {(MountainWorld['cells'][number] & { water?: string | null, pointOfLight?: unknown })[]} */
    const baseCells = base.cells;
    const added = baseCells.find(
      (cell) => !cell.water && cell.elevation !== 4 && !cell.pointOfLight,
    );
    assert.ok(added);
    campaign = updateHex(campaign, added.key, { terrain: 'mountains', poi: null });
    const removed = base.elevation.ranges[0].hexKeys[1];
    assert.ok(removed);
    campaign = updateHex(campaign, removed, { terrain: 'meadow', poi: null });
    campaign = importCampaign(exportCampaign(campaign));
    const world = campaignWorld(campaign, base);
    /** @type {MountainDressing} */
    const dressing = campaignDressing(campaign, world);
    const surfaces = assertUncachedEqual(world, dressing, `${seed}/edited-locked`);
    assert.ok(surfaces.has(added.key));
    assert.ok(!surfaces.has(removed));
    assert.ok(dressing.mountains.some((shape) => shape.profile === 0));
    const options = { cellKeys: [...surfaces.keys()], deferRiverSurfaces: false };
    const map = prepareMap(world, dressing, options);
    for (const cell of map) assert.deepEqual(cell.surface, surfaces.get(cell.key)?.surface);
    assert.deepEqual(campaignDressing(campaign, world), dressing);
  });
}

function smallInputs() {
  /** @type {MountainWorld} */
  const world = {
    seed: '7',
    cells: [0, 1, 2].map((q) => ({
      key: `${q},0`,
      q,
      r: 0,
      wx: (q * Math.sqrt(3)) / 2,
      wz: q * 1.5,
      elevation: 4,
    })),
    elevation: { ranges: [{ id: 'range', hexKeys: ['0,0', '1,0', '2,0'] }] },
  };
  /** @type {MountainDressing & { cells: unknown[] }} */
  const dressing = {
    mountains: [{ rangeId: 'range', phase: 0.7, angle: 1.2, heightScale: 0.6, profile: 1 }],
    revisions: { '0,0': 1 },
    cells: [],
  };
  return { world, dressing };
}

test('cache hits survive dressing.cells population and return independent mutable maps and arrays', (t) => {
  const { world, dressing } = smallInputs();
  const first = prepareMountainRanges(world, dressing);
  const expected = structuredClone(first);
  dressing.cells.push({ key: '0,0', props: [] });
  const sine = t.mock.method(Math, 'sin', () => {
    throw new Error('Unexpected ridge recomputation');
  });
  const second = prepareMountainRanges(world, dressing);
  assert.deepEqual(second, expected);
  assert.notEqual(first, second);
  for (const [key, data] of first) {
    const other = second.get(key);
    assert.ok(other);
    assert.notEqual(data, other);
    assert.notEqual(data.surface, other.surface);
    for (const [a, b] of [
      [data.corners, other.corners],
      [data.surface.vertices, other.surface.vertices],
      [data.surface.triangles, other.surface.triangles],
    ]) {
      assert.notEqual(a, b);
      for (let i = 0; i < a.length; i++) assert.notEqual(a[i], b[i]);
      a[0][0] = 999;
      b[0].push(888);
      a.length = 0;
    }
    assert.notEqual(data.shared, other.shared);
    data.shared.fill(false);
    other.shared.length = 0;
    other.type = 'changed';
  }
  first.clear();
  second.delete('0,0');
  assert.deepEqual(prepareMountainRanges(world, dressing), expected);
  assert.equal(sine.mock.callCount(), 0);
});

/** @type {[string, (world: MountainWorld, dressing: MountainDressing) => void][]} */
const mutations = [
  [
    'seed',
    (w) => {
      w.seed = '77';
    },
  ],
  [
    'range id',
    (w, d) => {
      w.elevation.ranges[0].id = d.mountains[0].rangeId = 'renamed';
    },
  ],
  [
    'range key order',
    (w) => {
      w.elevation.ranges[0].hexKeys.reverse();
    },
  ],
  [
    'range membership',
    (w) => {
      w.elevation.ranges[0].hexKeys.pop();
    },
  ],
  [
    'range removal',
    (w) => {
      w.elevation.ranges.length = 0;
    },
  ],
  [
    'range addition',
    (w, d) => {
      w.elevation.ranges.push({ id: 'extra', hexKeys: ['0,0'] });
      d.mountains.push({ ...d.mountains[0], rangeId: 'extra', phase: 2 });
    },
  ],
  [
    'cell key',
    (w) => {
      w.cells[0].key = w.elevation.ranges[0].hexKeys[0] = 'renamed';
    },
  ],
  [
    'q',
    (w) => {
      w.cells[0].q += 100;
    },
  ],
  [
    'r',
    (w) => {
      w.cells[0].r += 100;
    },
  ],
  [
    'wx',
    (w) => {
      w.cells[0].wx += 0.1;
    },
  ],
  [
    'wz',
    (w) => {
      w.cells[0].wz += 0.1;
    },
  ],
  [
    'elevation',
    (w) => {
      w.cells[0].elevation = 3;
    },
  ],
  [
    'cell order',
    (w) => {
      w.cells.reverse();
    },
  ],
  [
    'duplicate cell lookup',
    (w) => {
      w.cells.push({ ...w.cells[0], wx: 0.1 });
    },
  ],
  [
    'shape range id',
    (_w, d) => {
      d.mountains[0].rangeId = 'absent';
    },
  ],
  [
    'phase',
    (_w, d) => {
      d.mountains[0].phase += 0.1;
    },
  ],
  [
    'angle',
    (_w, d) => {
      d.mountains[0].angle += 0.1;
    },
  ],
  [
    'height scale',
    (_w, d) => {
      d.mountains[0].heightScale = 0.4;
    },
  ],
  [
    'profile',
    (_w, d) => {
      d.mountains[0].profile = 0;
    },
  ],
  [
    'absent profile',
    (_w, d) => {
      delete d.mountains[0].profile;
    },
  ],
  [
    'shape removal',
    (_w, d) => {
      d.mountains.length = 0;
    },
  ],
  [
    'duplicate shape lookup',
    (_w, d) => {
      d.mountains.push({ ...d.mountains[0], phase: 2 });
    },
  ],
  [
    'revision',
    (_w, d) => {
      d.revisions = { '0,0': 2 };
    },
  ],
  [
    'nested revision',
    (_w, d) => {
      assert.ok(d.revisions);
      d.revisions['0,0']++;
    },
  ],
  [
    'revision removal',
    (_w, d) => {
      delete d.revisions;
    },
  ],
  [
    'signed zero',
    (w) => {
      w.cells[0].wx = -0;
    },
  ],
  [
    'NaN',
    (_w, d) => {
      d.mountains[0].phase = NaN;
    },
  ],
  [
    'infinity',
    (_w, d) => {
      d.mountains[0].phase = Infinity;
    },
  ],
];

for (const [name, mutate] of mutations) {
  test(`in-place ${name} mutation invalidates cached numeric data`, (t) => {
    const { world, dressing } = smallInputs();
    prepareMountainRanges(world, dressing);
    mutate(world, dressing);
    const sine = t.mock.method(Math, 'sin');
    const changed = prepareMountainRanges(world, dressing);
    if (changed.size) assert.ok(sine.mock.callCount() > 0);
    sine.mock.restore();
    assertUncachedEqual(world, dressing);
  });
}

test('missing range cells still throw after a successful cached preparation', () => {
  const { world, dressing } = smallInputs();
  prepareMountainRanges(world, dressing);
  world.cells.pop();
  assert.throws(() => prepareMountainRanges(world, dressing), TypeError);
});

test('external profile-0 ridge closures are recomputed rather than cached by identity', () => {
  const { world, dressing } = smallInputs();
  dressing.mountains[0].profile = 0;
  let relief = 0.2;
  Object.assign(dressing.mountains[0], {
    ridges: {
      main: [
        [
          [0, 0],
          [2, 3],
        ],
      ],
      branches: [],
      width: 0.7,
      ruggedness: 0.3,
      relief: () => relief,
      detail: () => 0.5,
    },
  });
  const before = prepareMountainRanges(world, dressing);
  relief = 0.8;
  assert.notDeepEqual(prepareMountainRanges(world, dressing), before);
});
