# Development guide

Wilderness Almanac uses JavaScript ES modules, Vite and pinned Three.js 0.160.1.
The DOM UI stays framework-free; campaign maps use React 19.3.1 and React Three
Fiber 9.8.2 for retained chunk ownership. Generation and campaign data are
independent of the DOM and Three.js.
IndexedDB stores browser campaigns; an optional Node/SQLite API stores explicit
account copies. See [project state](PROJECT_STATE.md), [repository instructions](../AGENTS.md),
and the [user guide](USER_GUIDE.md).

## Setup and verification

Use Node.js 24 or later. Install frontend dependencies with `npm ci`; start Vite
with `npm run dev`. The browser-only app needs no environment variables. Backend
work additionally needs `npm ci --prefix server`; see [self-hosting](SELF_HOSTING.md).

| Command                         | Purpose                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run lint`                  | ESLint correctness and unused-variable checks across application, backend, tests and tooling |
| `npm run typecheck:incremental` | Scoped JSDoc/`@ts-check` verification for the incremental renderer and its integration tests |
| `npm run format:check`          | Check Prettier formatting                                                                    |
| `npm test`                      | Frontend Node tests                                                                          |
| `npm run test:server`           | Backend auth, SQLite, proxy and backup tests                                                 |
| `npm run build`                 | Build application and website map embeds                                                     |
| `npm run preview`               | Serve the production build                                                                   |
| `npm run test:e2e`              | Production-build desktop and mobile browser tests; build first                               |
| `npm run test:account`          | Source-served account dialog tests with mocked HTTP                                          |
| `npm run test:storage`          | Source-served real IndexedDB tests                                                           |
| `npm run test:workspace`        | Source-served journal pagination, panel and workspace checks                                 |
| `npm run check`                 | Frontend lint, formatting, Node tests, build and desktop/mobile browser tests                |

Install browser binaries with `npx playwright install chromium`. For a focused
Node check use `node --test tests/NAME.test.js`; for a browser subset pass a spec
and `--project=desktop` or `--project=mobile` to `npm run test:e2e --`.
`check` does not include backend, account or storage suites; run those separately.
`npm run format` rewrites formatting across the repository; prefer formatting only
touched files during focused work.

Prefer focused checks while editing. Broad suites and builds are appropriate for
explicit requests or substantial risk, once changes settle. Report actual checks
and limitations. Browser viewport emulation does not verify physical-phone touch
behavior or hardware performance.

The manually dispatched workflow in `.github/workflows/checks.yml` runs lint,
formatting, frontend/backend Node tests, build, account checks and desktop browser
tests. Automatic push/PR triggers and mobile CI runs are paused. Storage checks
are available separately and are not part of that workflow. Browser suites use one
worker; map tests use software WebGL, a 20-minute overall limit, and ignored trace,
screenshot and HTML-report directories. Map checks request reduced motion by default; renderer and navigation suites explicitly exercise motion and transitions. Do not poll Actions after pushing.

## Architecture

| Area                                                              | Responsibility                                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/generation.js`                                               | Public generation and campaign-editing API                                                              |
| `src/map-data.js`, `src/generation/`                              | Topology, deterministic world pipeline, placement, dressing and numeric geometry                        |
| `src/application/`                                                | Campaign validation, session actions/history, fog, party, journal, palettes and account synchronization |
| `src/persistence/`                                                | IndexedDB transactions, revisions, recovery and account HTTP client                                     |
| `src/rendering/`                                                  | Three.js meshes, materials, lighting, picking, controls and motion                                      |
| `src/ui/`                                                         | DOM tools, dialogs, preferences, navigation, thumbnails and lazy map entry                              |
| `src/main.js`                                                     | UI coordination and application boot                                                                    |
| `server/`, `functions/api/`, `compose.yaml`                       | Optional SQLite API, Cloudflare proxy and container deployment                                          |
| `src/hero-embed.js`, `embed/hero/`, `tools/hero-scene-plugin.mjs` | Website hero embed and build-time scene data                                                            |
| `tests/`, `e2e/`                                                  | Numeric/unit regressions and browser behavior                                                           |

Keep Three.js behind the lazy `src/ui/map-view.js` entry. The menu and Inspector
share a still-preview renderer; do not introduce per-hex WebGL contexts. Mesh
builders stay independent of browser lifecycle. `prop-batches.js` writes component
transforms, index expansion and packed foliage directly into final batch buffers;
source arrays stay unchanged and component geometries are disposed once. Packing
also accumulates bounds from the final Float32 positions and computes the exact
bounding sphere with one radius pass. Pixel crown/dressing templates share read-only
typed arrays, not geometries or attributes; far crowns feed those arrays directly
to the batch writer. Transform meshes or owned output buffers, never template-backed
geometry in place.
Scene, controls, geometry, materials, textures, preview jobs and listeners each have
explicit disposal owners.

`generateWorld(seed, { preferences, generatorVersion })` creates plain world data;
`generateDressing(world, variant)` creates cosmetic descriptors; `prepareMap(world,
dressing)` creates numeric renderer data. `campaignWorld` and `campaignDressing`
resolve edits and locks over the generated base. Use named random streams.

`prepareMap` remains eager by default. Campaigns opt into `deferRiverSurfaces`:
river/mouth tiles carry plain, cloneable descriptors with owned numeric inputs.
`generation/river-surface-cache.js` resolves the exact triangulation once per
descriptor through a WeakMap. Shallow source/fog copies share it; undiscovered
fog tiles omit it. Terrain, ground/beam lighting, selection rings and party height
resolve surfaces when needed, including required neighbouring surfaces. Snapshots
flush all queued chunks. This moves work, not geometry detail: shared boundaries,
triangle order, bevels and clipped water remain unchanged. River triangulation
reuses sector lattice samples and skips island-bank comparisons for empty island
fields; it retains the cross-sector lookup and first-encounter ordering.

Only generator **10** is supported. The number remains explicit in campaigns and
shared URLs; unsupported versions are rejected. Refactors must preserve current
world/dressing hashes and visuals. Future intentional generation changes require
a version decision. There is no runtime spreadsheet dependency: rules and names
come from `src/data/world-rules.json`.

The session owns campaign actions, selection and at most 20 Undo states. Derive and
validate complete edits before one commit/save; multi-edit remains atomic. Failed
persistence keeps live edits and history available for retry/download. Palette
changes survive hex Undo; navigation guards unsaved form drafts.

## Campaign entry

Campaign entry commits the workspace loading shell before importing the renderer
or generating the world. The shell restores panel sizing and the campaign title,
conceals retained canvas/details without collapsing their boxes, and paints before
synchronous preparation starts. Only one view participates in layout. Navigation
remains queued; failed imports or WebGL setup return to the menu with controls
restored. The shell ends after `setMap` schedules rendering, not after all chunks
finish. Direct campaign URLs suppress the library before the app module starts
and open the shell before storage initialization; startup does not render library
cards or animate from the library. Invalid routes/replays and failed loads restore
the library. New-campaign creation retains its separate preview/loading flow.

`ui/deferred-map-work.js` schedules optional campaign previews only while the
workspace is visible, its loading shell is gone, and the main canvas is `ready`.
A mutation observer opens/closes this gate; there is no loading-time polling.
The keyed queue runs one synchronous job per idle opportunity, replaces stale
Inspector/party requests, and gates each gallery tile. Cancellation settles
waiting callers; entry, Back and disposal clear pending work. Existing images
are reused only for matching inputs; otherwise the party button keeps its SVG
fallback and stale Inspector images stay hidden. Preview rendering APIs remain
synchronous for creation, embeds and callers outside campaign scheduling.

## Incremental campaign rendering

`src/ui/map-view.js` exposes `createCampaignMapRenderer` for the campaign and the
synchronous `createMapRenderer` for creation previews. Inspector thumbnails, party
previews and website embeds retain the synchronous renderer. React/Fiber stay
behind this lazy entry; there is one WebGL context per renderer, not one per chunk.

`incremental-builds.js` owns axial 4×4 chunks, with a source and latest fog record
per chunk. New geometry is built outside React in roughly 8 ms RAF slices (one
chunk can exceed that budget). Fog signatures include neighboring visibility for
river banks, shorelines and shared edges. Restrictive updates detach stale chunks
and picking targets synchronously; newer requests cancel queued work. Source or
art-style changes release both caches. Explicit snapshots flush pending work.
Before each slice, camera matrices refresh and pending chunks are scored once
against conservative projected footprint/height bounds. Viewport intersections
rank first, then distance to the centre, with deterministic chunk-ID ties. This
follows initial party focus and subsequent pan/zoom; it is scheduling, not culling.
All chunks still build, including offscreen shadow/light dependencies.

`retained-chunk-scene.js` mounts memoized chunk primitives through an R3F portal.
Primitives use record-identity keys so an outgoing fog record can remain mounted
under its arriving replacement. The build cache owns geometry disposal; React owns attachments. The existing
renderer still owns controls, camera framing, ambient motion, shadows and the party
overlay. `incremental-map-builds.js` supplies complete projected cell metadata
immediately, caches pickers per chunk, and updates feature lights during partial
reveals using the full target layout for clipping. Partial commits refresh picking
without cancelling gestures or changing camera framing. The canvas exposes
`data-renderer="fiber-retained"`, `data-render-state` and `aria-busy` for inspection.
The state distinguishes geometry `building`, presentation `settling`, and `ready`.

`chunk-transitions.js` reveals individual hexes with a 120 ms quartic ease-out rise
and fade, starting about six CSS pixels below their resting position. Geometry and
4×4 batches remain intact. Within each ready chunk, the closest hexes start first,
8 ms apart: at most 120 ms of stagger, not a whole-map queue. Cached reveals replay
the same motion without rebuilding geometry; concealment stays instantaneous.
Movement off and reduced motion skip arrivals, and disabling motion settles an
active arrival on the next frame.

Batched geometry retains one byte per vertex for stable hex ownership. Per-hex
delay uniforms drive color, rise and depth shaders; no per-hex draw calls or
per-frame vertex uploads are added. Temporary materials restore after arrival,
but their compiled programs remain cached with the build record for warm replay.
Record release disposes those wrappers. Wind/wave hooks and original geometry
buffers remain intact. Per-mesh bounding spheres cover the shader displacement;
picking follows each hex's offset and skips hexes that have not appeared yet.
Light meshes retain source-hex ranges and native light intensity follows the fade.
The existing render loop drives arrivals and refreshes shadows.

A previous, no-more-revealing cached record can remain underneath the arrival.
Its temporary shader biases depth behind incoming geometry and removes each hex
as its replacement finishes. Underlays never participate in picking, and detach
immediately on concealment; retiring one settles its arrival before release.
Palette/lighting changes settle active arrivals first. Snapshots flush both queued
geometry and transitions, restoring original materials and bounds.

The standalone comparison tool has its own pinned dependencies and compares
monolithic, native incremental, declarative Fiber and retained Fiber modes:

```sh
npm ci --prefix tools/incremental-renderer
npm run check --prefix tools/incremental-renderer
npm run build --prefix tools/incremental-renderer
npm run preview --prefix tools/incremental-renderer  # http://127.0.0.1:4187
# In another terminal; Chrome must be installed:
SIZES=4 ROUNDS=3 WARMUPS=1 npm run compare --prefix tools/incremental-renderer
```

Set `CHROME_EXECUTABLE` for a specific Chrome binary. `VERIFY=1 ROUNDS=1` captures
verification images separately from timing runs. Results go to ignored
`test-results/incremental-renderer/`. The tool does not exercise campaign controls
or the integrated lighting/picking adapter; use the application and
`e2e/incremental-renderer.spec.js` for that boundary. Detailed measurements and
trade-offs belong in the PR description, not a separate performance document.

## Focused references

- [Browser storage](BROWSER_STORAGE.md): initialization, transactions, conflicts, recovery and transfers.
- [World preferences](WORLD_PREFERENCES.md): bounded inputs, terrain rules and composition.
- [Fog of war](FOG_OF_WAR.md): visibility, water sight, masking and editing restrictions.
- [Design system](DESIGN_SYSTEM.md): UI tokens, theme, settings and responsive ownership.
- [Art styles](ART_STYLES.md): Low poly/Pixelart models, batching, lighting and disposal.
- [Self-hosting](SELF_HOSTING.md): accounts, proxy configuration, SQL migrations and backups.

## Fixtures and maintenance tools

`tests/fixtures/generation-v10.json` records world/dressing hashes for ordinary,
custom-preference and seven-hex worlds. `tests/fixtures/rendering.json` records
version-10 Low poly mesh buffers, materials, transforms and picking metadata.
These baselines were captured before removing historical generators. Do not
regenerate fixtures merely to hide failures. Preserve distinct Pixelart checks.
`tests/fixtures/river-surfaces-v10.json` records baseline numeric surface digests,
including signed zero and ordering, for generated, edited and locked river replay.

Browser fixtures seed current IndexedDB records directly through `e2e/data.js`.
They do not depend on localStorage campaign migration. The journal pagination component check imports source modules and runs through `test:workspace`, separately from production-build tests. Simulated failures stay in
test setup and browser contexts are isolated. Campaign preview scheduling is
covered by `e2e/deferred-previews.spec.js` in the source-served workspace suite,
with asserted test-only instrumentation; production-bundle suites exclude it.

`node tools/render-default-icon.mjs /tmp/default-icon.svg` renders the bundled
fallback from shared mesh builders without WebGL; rasterize at 384px with
`rsvg-convert`. `python3 tools/render-brand-icons.py` regenerates favicons from the
active antler mark and requires librsvg and Pillow. See [branding](../public/brand/README.md).

Vite's scene plugin prepares the seven-hex hero and 14-hex footer trail in Node,
keeping generation out of the embed bundles. `website-path-world.js` builds an
embed-only path through a coastal village, farmland, two-hex walled city, rising forests and
mountains with an abbey and watchtower; it does not reserve a campaign seed or
change generator replay. Roads use reciprocal exits and ordinary dressing.
The path bends north and south, widening to paired hexes around landmarks,
between a southwest coast and northeastern mountain range.
`/embed/hero/` and `/embed/footer/` have separate scene entries and share
`map-embed.js`, styling, keyboard selection and the lazy renderer boundary.
Both use Pixelart/Thronefall, ambient motion and fixed cameras without a party.
The hero initially selects the abbey; the footer waits for a selection.
URL parameters supply initial background/time, with parent-window messages
guarded by source, origin and separate `twa-hero`/`twa-footer` prefixes. The parent
can update TOD, color and visibility; visibility pauses ambient rendering while
the footer is offscreen. Reduced motion remains owned by the renderer.
Keep both embeds working when changing shared renderer or scene-generation modules.

## Licensing

Keep the application AGPLv3 license and bundled font/icon licenses and attribution.
Major Arcana images retain [YY Game's separate usage terms](../public/images/major-arcana/README.md).
Oracle dice retain [Ävos Grosimbourg's separate usage terms](../public/images/oracle-dice/README.md).
User instructions belong in the README/user guide; implementation contracts belong
in these maintainer documents, without chronological task logs or stale test counts.
