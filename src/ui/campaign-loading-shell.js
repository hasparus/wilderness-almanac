// @ts-check

/**
 * Own the entry placeholder while existing map/details stay mounted but concealed.
 * Layout boxes remain intact so panel restoration and canvas sizing agree.
 * @param {HTMLElement} workspace
 */
export function createCampaignLoadingShell(workspace) {
  const title = workspace.querySelector('.hp-title');
  const loading = workspace.querySelector('#hp-loading');
  if (!(title instanceof HTMLElement) || !(loading instanceof HTMLElement))
    throw new Error('Campaign loading shell is missing.');

  return {
    /** @param {string} name */
    show(name) {
      workspace.dataset.loading = 'true';
      workspace.setAttribute('aria-busy', 'true');
      title.textContent = name;
      document.title = `${name} · Wilderness Almanac`;
      loading.textContent = 'Preparing the landscape…';
      loading.hidden = false;
    },
    /** Release the shell once setMap has scheduled work, not when geometry finishes. */
    finish() {
      delete workspace.dataset.loading;
      workspace.removeAttribute('aria-busy');
      loading.hidden = true;
    },
  };
}
