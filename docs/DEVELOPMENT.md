# Development guide

Wilderness Almanac uses vanilla JavaScript ES modules, Vite and pinned Three.js
0.160.1. Generation and campaign data are independent of the DOM and Three.js.
IndexedDB stores browser campaigns; an optional Node/SQLite API stores explicit
account copies. See [project state](PROJECT_STATE.md), [repository instructions](../AGENTS.md),
and the [user guide](USER_GUIDE.md).

## Setup and verification

Use Node.js 24 or later. Install frontend dependencies with `npm ci`; start Vite
with `npm run dev`. The browser-only app needs no environment variables. Backend
work additionally needs `npm ci --prefix server`; see [self-hosting](SELF_HOSTING.md).

| Command                  | Purpose                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `npm run lint`           | ESLint correctness and unused-variable checks across application, backend, tests and tooling |
| `npm run format:check`   | Check Prettier formatting                                                                    |
| `npm test`               | Frontend Node tests                                                                          |
| `npm run test:server`    | Backend auth, SQLite, proxy and backup tests                                                 |
| `npm run build`          | Build application and website hero embed                                                     |
| `npm run preview`        | Serve the production build                                                                   |
| `npm run test:e2e`       | Production-build desktop and mobile browser tests; build first                               |
| `npm run test:account`   | Source-served account dialog tests with mocked HTTP                                          |
| `npm run test:storage`   | Source-served real IndexedDB tests                                                           |
| `npm run test:workspace` | Source-served journal pagination, panel and workspace checks                                 |
| `npm run check`          | Frontend lint, formatting, Node tests, build and desktop/mobile browser tests                |

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
builders stay independent of browser lifecycle. Scene, controls, geometry,
materials, textures, preview jobs and listeners each have explicit disposal owners.

`generateWorld(seed, { preferences, generatorVersion })` creates plain world data;
`generateDressing(world, variant)` creates cosmetic descriptors; `prepareMap(world,
dressing)` creates numeric renderer data. `campaignWorld` and `campaignDressing`
resolve edits and locks over the generated base. Use named random streams.

Only generator **10** is supported. The number remains explicit in campaigns and
shared URLs; unsupported versions are rejected. Refactors must preserve current
world/dressing hashes and visuals. Future intentional generation changes require
a version decision. There is no runtime spreadsheet dependency: rules and names
come from `src/data/world-rules.json`.

The session owns campaign actions, selection and at most 20 Undo states. Derive and
validate complete edits before one commit/save; multi-edit remains atomic. Failed
persistence keeps live edits and history available for retry/download. Palette
changes survive hex Undo; navigation guards unsaved form drafts.

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

Browser fixtures seed current IndexedDB records directly through `e2e/data.js`.
They do not depend on localStorage campaign migration. The journal pagination component check imports source modules and runs through `test:workspace`, separately from production-build tests. Simulated failures stay in
test setup and browser contexts are isolated.

`node tools/render-default-icon.mjs /tmp/default-icon.svg` renders the bundled
fallback from shared mesh builders without WebGL; rasterize at 384px with
`rsvg-convert`. `python3 tools/render-brand-icons.py` regenerates favicons from the
active antler mark and requires librsvg and Pillow. See [branding](../public/brand/README.md).

Vite's hero plugin prepares the fixed seven-hex scene in Node. The embed uses its
own entrypoint and stylesheet, camera/selection behavior and parent-window messages.
Keep it working when changing shared renderer or scene-generation modules.

## Licensing

Keep the application AGPLv3 license and bundled font/icon licenses and attribution.
Major Arcana images retain [YY Game's separate usage terms](../public/images/major-arcana/README.md).
User instructions belong in the README/user guide; implementation contracts belong
in these maintainer documents, without chronological task logs or stale test counts.
