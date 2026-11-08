// @ts-check

/**
 * @typedef {object} DeferredOptions
 * @property {() => boolean} ready
 * @property {(changed: () => void) => (() => void)} observe
 * @property {(run: () => void) => number} [schedule]
 * @property {(handle: number) => void} [cancel]
 * @property {() => void} [onReady]
 */

/**
 * Optional, synchronous jobs only. Never await a job inside the runner: a gallery
 * continuation may enqueue its next tile after this opportunity has finished.
 * Replacement/cancellation settles callers with undefined, rather than stranding
 * async gallery loops. Readiness is rechecked at execution, not just scheduling.
 * @param {DeferredOptions} options
 */
export function createDeferredMapWork({
  ready,
  observe,
  schedule = (run) =>
    typeof requestIdleCallback === 'function'
      ? requestIdleCallback(run, { timeout: 1000 })
      : window.setTimeout(run, 32),
  cancel = (handle) =>
    typeof cancelIdleCallback === 'function'
      ? cancelIdleCallback(handle)
      : window.clearTimeout(handle),
  onReady = () => {},
}) {
  /** @type {Map<string, {run: () => void, cancel: () => void}>} */
  const jobs = new Map();
  /** @type {Map<string, {identity: unknown[], value: string}>} */
  const previews = new Map();
  /** @type {number | undefined} */
  let handle;
  let disposed = false;
  let open = false;
  let ticket = 0;

  function stop() {
    ticket++;
    if (handle !== undefined) cancel(handle);
    handle = undefined;
  }
  function wake() {
    if (disposed) return;
    const next = ready();
    const opened = next && !open;
    open = next;
    if (!open) {
      stop();
      return;
    }
    if (opened) onReady();
    if (handle !== undefined || !jobs.size) return;
    const current = ++ticket;
    handle = schedule(() => {
      if (disposed || current !== ticket) return;
      handle = undefined;
      if (!ready()) {
        open = false;
        return;
      }
      const entry = jobs.entries().next().value;
      if (entry) {
        const [key, job] = entry;
        jobs.delete(key);
        job.run();
      }
      wake();
    });
  }
  const disconnect = observe(wake);

  /** @param {string} key */
  function cancelKey(key) {
    jobs.get(key)?.cancel();
    jobs.delete(key);
  }
  /** @template T @param {string} key @param {() => T} run @returns {Promise<T | undefined>} */
  function enqueue(key, run) {
    cancelKey(key);
    if (disposed) return Promise.resolve(undefined);
    const result = new Promise((resolve) => {
      jobs.set(key, {
        cancel: () => resolve(undefined),
        run() {
          try {
            resolve(run());
          } catch {
            resolve(undefined);
          }
        },
      });
    });
    wake();
    return /** @type {Promise<T | undefined>} */ (result);
  }
  function clear() {
    stop();
    for (const job of jobs.values()) job.cancel();
    jobs.clear();
    previews.clear();
  }
  return {
    enqueue,
    cancel: cancelKey,
    clear,
    /**
     * Bridge existing synchronous inspector callbacks without rendering in their
     * RAF. A refresh consumes the result; it never starts another render itself.
     * @param {string} key
     * @param {unknown[]} identity
     * @param {() => string} build
     * @param {() => void} refresh
     * @returns {string}
     */
    preview(key, identity, build, refresh) {
      const cached = previews.get(key);
      if (
        cached &&
        identity.length === cached.identity.length &&
        identity.every((value, index) => value === cached.identity[index])
      ) {
        cancelKey(key);
        return cached.value;
      }
      void enqueue(key, () => {
        previews.set(key, { identity, value: build() });
        refresh();
      });
      return '';
    },
    dispose() {
      disposed = true;
      clear();
      disconnect();
    },
  };
}

/**
 * Observe just the workspace gate and main canvas (including lazy insertion).
 * No RAF or timer polling runs while loading; canvas status and shell mutations
 * wake the queue. Panel image mutations are deliberately not observed.
 * @param {HTMLElement} workspace
 * @param {HTMLElement} scene
 * @param {() => void} [onReady]
 */
export function observeDeferredMapWork(workspace, scene, onReady) {
  return createDeferredMapWork({
    ready: () =>
      !workspace.hidden &&
      !workspace.hasAttribute('data-loading') &&
      scene.querySelector('canvas')?.getAttribute('data-render-state') === 'ready',
    observe(changed) {
      const observer = new MutationObserver(changed);
      observer.observe(workspace, {
        attributes: true,
        attributeFilter: ['hidden', 'data-loading'],
      });
      observer.observe(scene, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-render-state'],
      });
      return () => observer.disconnect();
    },
    onReady,
  });
}
