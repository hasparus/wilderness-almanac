export function createMapAction(root, announce) {
  let busy = false;
  let disposed = false;
  let release = () => {};
  return {
    isBusy: () => busy,
    async run(button, action, label = 'Applying…') {
      if (busy || disposed) return false;
      busy = true;
      const input = new AbortController();
      const block = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      for (const type of ['pointerdown', 'click', 'keydown', 'beforeinput', 'submit']) {
        root.addEventListener(type, block, { capture: true, signal: input.signal });
      }
      release = () => {
        input.abort();
        button.removeAttribute('aria-busy');
        button.classList.remove('hp-working');
        root.removeAttribute('aria-busy');
      };
      button.classList.add('hp-working');
      button.setAttribute('aria-busy', 'true');
      root.setAttribute('aria-busy', 'true');
      announce(label);
      try {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (disposed) return false;
        input.abort();
        return action();
      } finally {
        release();
        release = () => {};
        busy = false;
      }
    },
    dispose() {
      disposed = true;
      release();
    },
  };
}
