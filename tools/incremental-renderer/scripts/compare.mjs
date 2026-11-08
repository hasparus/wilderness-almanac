// @ts-check
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const url = process.env.URL ?? 'http://127.0.0.1:4187';
const rounds = Number(process.env.ROUNDS ?? 1),
  warmups = Number(process.env.WARMUPS ?? 0);
const verification = process.env.VERIFY === '1';
const styles = /** @type {import('../src/types.js').ArtStyle[]} */ (
  (process.env.STYLES ?? 'low-poly,pixelart').split(',')
);
const sizes = (process.env.SIZES ?? '4,8').split(',').map(Number);
const modes = /** @type {import('../src/types.js').Mode[]} */ (
  (process.env.MODES ?? 'monolithic,native,fiber,fiber-retained').split(',')
);
const output = new URL(
  `../../../test-results/incremental-renderer/${process.env.OUTPUT ?? (verification ? 'verification' : 'results')}/`,
  import.meta.url,
);
await mkdir(output, { recursive: true });
/** @type {import('../src/types.js').Trial[]} */
const trials = [];
const versions = Object.fromEntries(
  await Promise.all(
    ['react', 'react-dom', '@react-three/fiber', 'three', 'vite'].map(async (name) => [
      name,
      /** @type {{version: string}} */ (
        JSON.parse(
          await readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8'),
        )
      ).version,
    ]),
  ),
);
const args =
  process.env.SOFTWARE_GL === '1'
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : [];
for (let round = -warmups; round < rounds; round++)
  for (const style of styles) {
    const configurations = modes.flatMap((mode) =>
      (mode === 'monolithic' ? [4] : sizes).map((chunkSize) => ({ mode, chunkSize })),
    );
    if (Math.abs(round) % 2) configurations.reverse();
    for (const config of configurations) {
      const browser = await chromium.launch({
        headless: process.env.HEADLESS !== '0',
        args,
        ...(process.env.CHROME_EXECUTABLE
          ? { executablePath: process.env.CHROME_EXECUTABLE }
          : { channel: process.env.CHANNEL ?? 'chrome' }),
      });
      try {
        const context = await browser.newContext({
          viewport: { width: 1100, height: 1050 },
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        /** @type {string[]} */
        const errors = [];
        /** @type {string[]} */
        const warnings = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (msg) => {
          if (msg.type() === 'error') errors.push(msg.text());
          if (msg.type() === 'warning') warnings.push(msg.text());
        });
        const prefix = round + '-' + style + '-' + config.mode + '-' + config.chunkSize;
        if (verification)
          await page.exposeFunction(
            'captureSpike',
            /** @param {string} name */ async (name) => {
              await page
                .locator('canvas')
                .screenshot({ path: new URL(prefix + '-' + name + '.png', output).pathname });
            },
          );
        await page.goto(url, { waitUntil: 'networkidle' });
        /** @type {import('../src/types.js').RunOptions} */
        const options = {
          ...config,
          style,
          seed: process.env.SEED ?? '7',
          verification,
          budgetMs: Number(process.env.BUDGET_MS ?? 6),
          maxChunks: Number(process.env.MAX_CHUNKS ?? 4),
          visitRadius: Number(process.env.VISIT_RADIUS ?? 0),
        };
        const data = await page.evaluate((options) => window.spike.run(options), options);
        if (verification)
          await page
            .locator('canvas')
            .screenshot({ path: new URL(prefix + '-final.png', output).pathname });
        if (errors.length) throw new Error(errors.join('\n'));
        trials.push({
          versions,
          round,
          warmup: round < 0,
          browser: browser.version(),
          args,
          warnings,
          ...data,
        });
        await writeFile(new URL('raw.json', output), JSON.stringify(trials, null, 2));
        console.log(
          prefix,
          JSON.stringify({
            firstProgressMs: data.phases.coldFogOff.firstVisibleChangedMs,
            completeMs: data.phases.coldFogOff.allChunksTwoRafMs,
            visitCompleteMs: data.phases.singleVisit.allChunksTwoRafMs,
            rebuilt: data.phases.singleVisit.rebuiltChunks,
            reused: data.phases.singleVisit.unchangedChunks,
          }),
        );
        await context.close();
      } finally {
        await browser.close();
      }
    }
  }
for (const trial of trials) {
  const paired = trials.find(
    (t) =>
      t.round === trial.round &&
      t.style === trial.style &&
      t.chunkSize === trial.chunkSize &&
      t.mode !== trial.mode &&
      t.mode !== 'monolithic',
  );
  if (paired && JSON.stringify(paired.topology) !== JSON.stringify(trial.topology))
    throw new Error('Paired native/Fiber geometry mismatch');
  if (
    paired &&
    JSON.stringify(paired.phases.finalFull.draw) !== JSON.stringify(trial.phases.finalFull.draw)
  ) {
    /** @param {import('../src/types.js').Trial} t */
    const draw = (t) => {
      const d = t.phases.finalFull.draw;
      return [d.calls, d.triangles, d.lines, d.points];
    };
    if (JSON.stringify(draw(paired)) !== JSON.stringify(draw(trial)))
      throw new Error('Paired draw mismatch');
  }
  const mono = trials.find(
    (t) => t.round === trial.round && t.style === trial.style && t.mode === 'monolithic',
  );
  if (mono && mono.topology.triangles !== trial.topology.triangles)
    throw new Error('Monolithic total triangle mismatch');
}
console.log(
  verification
    ? 'VERIFICATION ONLY: inspect first-progress and monolithic/final PNGs. Timings invalid.'
    : 'Serial timed samples saved; screenshot parity must be verified separately.',
  output.pathname,
);
