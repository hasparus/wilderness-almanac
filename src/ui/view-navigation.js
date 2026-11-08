// @ts-check

/** Let the committed shell paint before importing or generating its contents. */
export function afterPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

/**
 * Serialize view changes, not decorative transitions and content loading.
 * Preparation is synchronous and runs with only the incoming view in layout.
 * @param {HTMLElement} menu
 * @param {HTMLElement} workspace
 */
export function createViewNavigation(menu, workspace) {
  /** @type {Promise<unknown>} */
  let queued = Promise.resolve();
  let disposed = false;
  /** @type {ViewTransition | undefined} */
  let transition;
  let menuScroll = 0;
  const clear = () => {
    menu.inert = workspace.inert = false;
    delete document.documentElement.dataset.viewDirection;
  };
  /**
   * @param {'forward' | 'back'} direction
   * @param {() => void} prepare
   * @param {(() => Promise<boolean | void>) | undefined} load
   */
  async function show(direction, prepare, load) {
    if (disposed) return false;
    const forward = direction === 'forward';
    const outgoing = forward ? menu : workspace;
    const incoming = forward ? workspace : menu;
    if (forward && !menu.hidden) menuScroll = window.scrollY;
    let committed = false;
    let succeeded = false;
    /** @type {() => void} */
    let resolveCommit = () => {};
    /** @type {(reason: unknown) => void} */
    let rejectCommit = () => {};
    const committedView = new Promise((resolve, reject) => {
      resolveCommit = () => resolve(undefined);
      rejectCommit = reject;
    });
    const commit = () => {
      if (committed) return;
      committed = true;
      if (disposed) {
        resolveCommit();
        return;
      }
      try {
        outgoing.hidden = true;
        incoming.hidden = false;
        prepare();
        window.scrollTo({ top: forward ? 0 : menuScroll, behavior: 'instant' });
        resolveCommit();
      } catch (error) {
        rejectCommit(error);
      }
    };
    outgoing.inert = incoming.inert = true;
    try {
      if (
        !outgoing.hidden &&
        document.startViewTransition &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        document.documentElement.dataset.viewDirection = direction;
        try {
          transition = document.startViewTransition(commit);
        } catch {
          commit();
        }
      } else commit();
      const animated = transition?.finished.catch(() => commit());
      await committedView;
      if (disposed) return false;
      if (load) {
        await afterPaint();
        if (disposed || (await load()) === false) return false;
      }
      await animated;
      succeeded = !disposed;
      return succeeded;
    } finally {
      if (!succeeded) transition?.skipTransition();
      transition = undefined;
      if (!disposed) {
        if (!succeeded) {
          incoming.hidden = true;
          outgoing.hidden = false;
          window.scrollTo({ top: forward ? menuScroll : 0, behavior: 'instant' });
        }
        clear();
        const visible = succeeded ? incoming : outgoing;
        const target =
          visible.querySelector(visible === menu ? '#new-campaign' : '#hp-scene canvas') ??
          visible.querySelector('#hp-back-menu');
        if (target instanceof HTMLElement) target.focus({ preventScroll: true });
      }
    }
  }
  return {
    /**
     * @param {'forward' | 'back'} direction
     * @param {() => void} prepare
     * @param {() => Promise<boolean | void>} [load]
     */
    show(direction, prepare, load) {
      const next = queued.then(() => show(direction, prepare, load));
      queued = next.catch(() => {});
      return next;
    },
    dispose() {
      disposed = true;
      transition?.skipTransition();
      clear();
    },
  };
}
