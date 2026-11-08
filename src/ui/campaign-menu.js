import { openDialog } from './dialog-focus.js';
import { generateWorld } from '../generation/world.js';
import { campaignWorld } from '../generation/campaign-world.js';
import { cloneTemplate } from './templates.js';
import { loadThumbnails } from './thumbnail-cache.js';
import { campaignWeek } from '../application/party-token.js';
import { timeIncrementLabels } from '../application/campaign-time.js';
import { copyText, mapLink } from './map-link.js';
import {
  createCampaign,
  campaignStats,
  exportCampaign,
  campaignFilename,
  findCampaignReplay,
  chooseCampaignIcon,
} from '../application/campaigns.js';

export function createCampaignMenu({
  store,
  defaultPalette,
  onEnter,
  onNewCampaign,
  saveStatus,
  getTimeIncrement = () => 'week',
}) {
  const menu = document.getElementById('campaign-menu');
  const list = document.getElementById('campaign-list');
  const newButton = document.getElementById('new-campaign');
  const status = document.getElementById('campaign-message');
  function setMessage(text, error = false) {
    status.textContent = text;
    status.dataset.kind = error ? 'error' : 'status';
  }
  const undoDelete = document.getElementById('undo-delete-campaign');
  const deleteDialog = document.getElementById('delete-campaign-dialog');
  const listeners = new AbortController();
  const listen = (target, type, callback) =>
    target.addEventListener(type, callback, { signal: listeners.signal });
  const cached = new Map();
  const campaigns = store.campaigns;
  let deletedCampaign = store.deletedCampaign;
  let storageAvailable = true;
  let pendingDeleteId;
  let opening = false;
  let releaseBusy = () => {};
  let saveRevision = 0;

  function revealIconControls(icon, revealed) {
    icon.classList.toggle('is-revealed', revealed);
    icon.querySelector('.campaign-icon-toggle').setAttribute('aria-expanded', String(revealed));
  }

  function hideIconControls(except) {
    list.querySelectorAll('.campaign-icon.is-revealed').forEach((icon) => {
      if (icon === except) return;
      revealIconControls(icon, false);
    });
  }

  function recoveryNotice() {
    const { reason, readOnly, preservedCount, hasRecovery } = store.status();
    const message = document.getElementById('campaign-recovery-message');
    let text = '';
    if (reason === 'conflict')
      text =
        'Saved campaigns changed in another tab. Download your current campaigns before reloading this page.';
    else if (reason === 'quota')
      text = 'Browser storage is full. Download your changes, free some space, then retry saving.';
    else if (reason === 'versionchange')
      text =
        'Browser storage was updated in another tab. Download your current campaigns before reloading.';
    else if (reason === 'unreadable')
      text =
        'Some saved data cannot be read by this version. It has been kept unchanged. New campaigns can only be kept in this session.';
    else if (readOnly)
      text =
        'Browser storage cannot be read. Download any campaigns you create before closing this page. Reload to retry opening your saves.';
    else if (preservedCount)
      text = `${preservedCount} saved ${preservedCount === 1 ? 'campaign cannot' : 'campaigns cannot'} be opened by this version. ${preservedCount === 1 ? 'Its' : 'Their'} data is preserved in your library.`;
    if (message.textContent !== text) message.textContent = text;
    document.getElementById('campaign-recovery').hidden = !message.textContent;
    document.getElementById('download-campaign-recovery').hidden = !hasRecovery;
    const note = menu.querySelector('.campaign-storage-note');
    if (note)
      note.textContent =
        store.status().durability === 'granted'
          ? 'Saved on this device. Export a campaign to take it with you.'
          : 'Saved in this browser. Export backups; the browser may clear local data.';
  }

  async function save(palettes, activeCampaignId) {
    const revision = ++saveRevision;
    // The retained map session can outlive its campaign's removal from the library.
    if (!campaigns.some(({ id }) => id === activeCampaignId)) activeCampaignId = undefined;
    const success = await store.save({ campaigns, deletedCampaign, palettes, activeCampaignId });
    if (revision !== saveRevision || listeners.signal.aborted) return success;
    storageAvailable = success;
    saveStatus.update('campaigns', storageAvailable);
    recoveryNotice();
    undoDelete.hidden = !deletedCampaign;
    return success;
  }

  function expireUndo() {
    if (!deletedCampaign) return;
    deletedCampaign = null;
    setMessage('');
    save();
  }

  recoveryNotice();
  const unsubscribe = store.subscribe(recoveryNotice);

  function campaignData(campaign) {
    const signature = JSON.stringify([campaign.seed, campaign.variant, campaign.hexEdits]);
    let data = cached.get(campaign.id);
    if (data?.signature !== signature) {
      const world = campaignWorld(campaign);
      data = {
        signature,
        world,
        stats: campaignStats(world),
      };
      cached.set(campaign.id, data);
    }
    if (!data.world.cells.some((cell) => cell.key === campaign.iconKey)) {
      campaign.iconKey = chooseCampaignIcon(data.world);
      save();
    }
    return data;
  }

  async function paintIcon(card, campaign, ready) {
    const request = {};
    card.iconRequest = request;
    const shuffle = card.querySelector('[data-action="shuffle"]');
    if (!ready) shuffle.disabled = true;
    const images = ready ?? (await loadThumbnails(campaign, { allowStale: true }));
    if (!card.isConnected || card.iconRequest !== request) return;
    card.iconEntries = images;
    shuffle.disabled = opening || images.length < 2;
    const img = card.querySelector('.campaign-icon img');
    const placeholder = card.querySelector('.campaign-icon-placeholder');
    const previous =
      card.dataset.iconSeed === campaign.seed && img.dataset.hexKey === campaign.iconKey
        ? img.getAttribute('src')
        : '';
    const image = images.find((entry) => entry.key === campaign.iconKey)?.image || previous;
    img.alt = `Terrain hex from ${campaign.name}`;
    if (image) {
      img.src = image;
      img.dataset.hexKey = campaign.iconKey ?? '';
      card.dataset.iconSeed = campaign.seed;
    } else {
      img.removeAttribute('src');
      delete img.dataset.hexKey;
      delete card.dataset.iconSeed;
    }
    img.hidden = !image;
    placeholder.hidden = Boolean(image);
  }

  function labelActions(card, campaign) {
    const helps = {
      share: 'Copy shareable URL with original seed',
      copy: 'Copy seed',
      download: 'Export this campaign to a JSON file',
      delete: 'Delete campaign',
    };
    for (const [action, text] of Object.entries(helps))
      card.querySelector(`[data-action="${action}"]`).dataset.tooltip = text;
    for (const [action, label] of [
      ['enter', 'Enter'],
      ['copy', 'Copy seed for'],
      ['share', 'Share seed for'],
      ['download', 'Export'],
      ['delete', 'Delete'],
      ['shuffle', 'Next icon for'],
      ['icon-controls', 'Change icon for'],
    ])
      card
        .querySelector(`[data-action="${action}"]`)
        .setAttribute('aria-label', `${label} ${campaign.name}`);
  }

  function render() {
    const existing = new Map([...list.children].map((card) => [card.dataset.id, card]));
    const cards = [];
    document.getElementById('campaign-count').textContent = campaigns.length;
    for (const campaign of campaigns) {
      const data = campaignData(campaign);
      const card =
        existing.get(campaign.id) ?? cloneTemplate('campaign-template').firstElementChild;
      card.dataset.id = campaign.id;
      const name = card.querySelector('.campaign-name');
      name.value = campaign.name;
      name.setAttribute('aria-label', `Campaign name: ${campaign.name}`);

      card.querySelector('.campaign-date').dateTime = campaign.createdAt;
      card.querySelector('.campaign-date').textContent = new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(new Date(campaign.createdAt));
      card.querySelector('.campaign-palette').textContent = campaign.paletteName;
      card.querySelector('.campaign-week').textContent = String(campaignWeek(campaign));
      card.querySelector('.campaign-time-label').textContent = timeIncrementLabels(
        getTimeIncrement(campaign),
      ).label;
      const ratio = card.querySelector('.campaign-ratio');
      ratio.querySelector('dd').textContent =
        `${data.stats.waterPercent}% / ${data.stats.landPercent}%`;
      card.querySelector('.campaign-seed').textContent = campaign.seed;
      labelActions(card, campaign);
      cards.push(card);
      void paintIcon(card, campaign);
    }
    list.replaceChildren(...cards);
  }

  async function add(campaign, palettes) {
    expireUndo();
    campaigns.push(campaign);
    return save(palettes);
  }

  async function enter(campaign, button = newButton, options) {
    if (opening || menu.hidden || listeners.signal.aborted) return false;
    opening = true;
    const creating = !campaign;
    const controls = [...menu.querySelectorAll('button, input, select')].map((control) => [
      control,
      control.disabled,
    ]);
    const label = button.getAttribute('aria-label');
    const title = newButton.querySelector('strong');
    const originalTitle = title.textContent;
    const enterText = button.querySelector('span');
    const originalEnterText = enterText?.textContent;
    releaseBusy = () => {
      for (const [control, disabled] of controls) control.disabled = disabled;
      button.removeAttribute('aria-busy');
      if (label === null) button.removeAttribute('aria-label');
      else button.setAttribute('aria-label', label);
      title.textContent = originalTitle;
      if (button !== newButton && enterText) enterText.textContent = originalEnterText;
      opening = false;
      releaseBusy = () => {};
    };
    for (const [control] of controls) control.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (button === newButton)
      title.textContent = creating ? 'Creating campaign…' : 'Opening campaign…';
    else {
      button.setAttribute('aria-label', `Opening ${campaign.name}…`);
      if (enterText) enterText.textContent = 'Opening…';
    }
    expireUndo();
    setMessage(creating ? 'Creating your campaign…' : 'Opening campaign…');
    try {
      if (listeners.signal.aborted) return false;
      if (creating) {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (listeners.signal.aborted) return false;
        const world = generateWorld(crypto.randomUUID());
        const palette = typeof defaultPalette === 'function' ? defaultPalette() : defaultPalette;
        campaign = createCampaign(world, palette.colors, palette.paletteName);
        await add(campaign);
      }
      return (await onEnter(campaign, options)) !== false;
    } catch (error) {
      if (!listeners.signal.aborted) {
        menu.hidden = false;
        render();
        setMessage(
          `Could not ${creating ? 'create the campaign' : 'open the map'}. ${error.message}`,
          true,
        );
      }
      return false;
    } finally {
      if (!listeners.signal.aborted) {
        releaseBusy();
        if (!menu.hidden) button.focus({ preventScroll: true });
      }
    }
  }

  function downloadFile(source, filename) {
    const blob = new Blob([source], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function download(campaign) {
    const date = new Date();
    try {
      downloadFile(exportCampaign(campaign, date), campaignFilename(campaign, date));
      setMessage(`Campaign export started: “${campaign.name}”`);
    } catch (error) {
      setMessage(error.message, true);
    }
  }

  async function downloadRecovery(palettes) {
    const stored = JSON.parse(await store.recovery());
    downloadFile(
      JSON.stringify({ ...stored, unsaved: { campaigns, deletedCampaign, palettes } }, null, 2),
      campaignFilename({ name: 'recovery' }),
    );
    setMessage('Recovery export started. Keep it with your campaign backups.');
  }

  listen(document.getElementById('download-campaign-recovery'), 'click', async () => {
    const source = await store.recovery();
    if (source == null) return;
    downloadFile(source, campaignFilename({ name: 'recovery' }));
    setMessage('Recovery export started. Keep it with your campaign backups.');
  });

  async function rename(input) {
    const campaign = campaigns.find(
      (item) => item.id === input.closest('.campaign-card').dataset.id,
    );
    const name = input.value.trim();
    if (!name) {
      input.value = campaign.name;
      return;
    }
    if (name === campaign.name) {
      input.value = name;
      return;
    }
    expireUndo();
    campaign.nameEdited = true;
    campaign.name = name;
    input.value = name;
    input.setAttribute('aria-label', `Campaign name: ${name}`);
    const card = input.closest('.campaign-card');
    labelActions(card, campaign);
    card.querySelector('.campaign-icon img').alt =
      `${cached.get(campaign.id)?.tile?.terrain ?? 'Terrain'} hex from ${name}`;
    if (await save()) setMessage('Campaign name saved');
  }

  listen(list, 'change', (event) => {
    if (event.target.matches('.campaign-name')) rename(event.target);
  });
  listen(list, 'submit', (event) => {
    event.preventDefault();
    const input = event.target.querySelector('input');
    rename(input);
    input.blur();
  });
  listen(list, 'keydown', (event) => {
    if (event.key === 'Escape') hideIconControls();
    if (event.key === 'Escape' && event.target.matches('.campaign-name')) {
      const campaign = campaigns.find(
        (item) => item.id === event.target.closest('.campaign-card').dataset.id,
      );
      event.target.value = campaign.name;
      event.target.blur();
    }
  });
  for (const type of ['pointerover', 'focusin'])
    listen(list, type, (event) => {
      if (
        type === 'pointerover'
          ? event.pointerType !== 'mouse'
          : !event.target.matches(':focus-visible')
      )
        return;
      const icon = event.target.closest('.campaign-icon');
      if (icon) revealIconControls(icon, true);
    });
  for (const type of ['pointerout', 'focusout'])
    listen(list, type, (event) => {
      const icon = event.target.closest('.campaign-icon');
      if (icon && !icon.contains(event.relatedTarget) && !icon.contains(document.activeElement))
        revealIconControls(icon, false);
    });
  listen(list, 'click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || opening || menu.hidden) return;
    const campaign = campaigns.find(
      (item) => item.id === button.closest('.campaign-card').dataset.id,
    );
    const action = button.dataset.action;
    expireUndo();
    if (action === 'icon-controls') {
      const icon = button.closest('.campaign-icon');
      hideIconControls(icon);
      revealIconControls(
        icon,
        event.pointerType === 'mouse' || !icon.classList.contains('is-revealed'),
      );
      return;
    }
    if (action === 'enter') return enter(campaign, button);
    if (action === 'download') return download(campaign);
    if (action === 'shuffle') {
      const card = button.closest('.campaign-card');
      const images = card.iconEntries ?? [];
      if (images.length < 2) return;
      const index = images.findIndex((entry) => entry.key === campaign.iconKey);
      campaign.iconKey = images[(index + 1) % images.length].key;
      const saved = await save();
      void paintIcon(card, campaign, images);
      if (saved) setMessage('Campaign icon updated');
      return;
    }
    if (action === 'delete') {
      pendingDeleteId = campaign.id;
      document.getElementById('delete-campaign-name').textContent = campaign.name;
      deleteDialog.returnValue = 'cancel';
      openDialog(deleteDialog);
      return;
    }
    try {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.classList.add('hp-working');
      setMessage(action === 'copy' ? 'Copying seed…' : 'Copying map link…');
      await copyText(action === 'copy' ? campaign.seed : mapLink(window.location.href, campaign));
      setMessage(action === 'copy' ? 'Seed copied' : 'Map link copied');
    } catch {
      setMessage(
        action === 'copy'
          ? 'Could not copy. Select the seed text to copy it.'
          : 'Could not copy a link. Enter the campaign and copy the URL from the address bar.',
        true,
      );
    } finally {
      button.disabled = opening;
      button.removeAttribute('aria-busy');
      button.classList.remove('hp-working');
    }
  });
  listen(document, 'click', (event) => {
    if (!event.target.closest('.campaign-icon')) hideIconControls();
  });
  listen(deleteDialog, 'close', async () => {
    const index = campaigns.findIndex((item) => item.id === pendingDeleteId);
    pendingDeleteId = null;
    if (deleteDialog.returnValue !== 'delete' || index < 0) return;
    const [campaign] = campaigns.splice(index, 1);
    deletedCampaign = { campaign, index };
    cached.delete(campaign.id);
    render();
    undoDelete.hidden = false;
    const saved = await save();
    if (saved) setMessage(`Deleted “${campaign.name}”`);
    undoDelete.focus({ preventScroll: true });
  });
  listen(undoDelete, 'click', async () => {
    if (!deletedCampaign) return;
    const { campaign, index } = deletedCampaign;
    campaigns.splice(Math.min(index, campaigns.length), 0, campaign);
    deletedCampaign = null;
    render();
    undoDelete.hidden = true;
    const saved = await save();
    if (saved) setMessage(`Restored “${campaign.name}”`);
    list
      .querySelectorAll('[data-action="delete"]')
      .item(Math.min(index, campaigns.length - 1))
      ?.focus({ preventScroll: true });
  });
  listen(newButton, 'click', () => (onNewCampaign ? onNewCampaign() : enter()));

  return {
    add,
    render,
    snapshotCampaigns: () => campaigns.map((campaign) => structuredClone(campaign)),
    async applyRemote(campaign, expected = null) {
      if (opening) throw new Error('Wait for the current campaign action to finish.');
      const index = campaigns.findIndex((item) => item.id === campaign.id);
      const current = index < 0 ? null : campaigns[index];
      if (JSON.stringify(current) !== JSON.stringify(expected))
        throw new Error('The local campaign changed while loading. Both copies have been kept.');
      const next = campaigns.slice();
      if (index < 0) next.push(campaign);
      else next[index] = campaign;
      const success = await store.save({ campaigns: next, deletedCampaign: null });
      saveStatus.update('campaigns', success);
      if (!success)
        throw new Error(
          'The account copy could not be saved in this browser. Download it before retrying.',
        );
      campaigns.splice(0, campaigns.length, ...next);
      deletedCampaign = null;
      cached.delete(campaign.id);
      undoDelete.hidden = true;
      render();
      return campaign;
    },
    enter,
    download,
    downloadRecovery,
    save,
    refreshThumbnail(campaign) {
      const card = [...list.children].find((card) => card.dataset.id === campaign.id);
      const current = campaigns.find((item) => item.id === campaign.id);
      if (card && current) void paintIcon(card, current);
    },
    findReplay(state) {
      return findCampaignReplay(campaigns, state);
    },
    update(campaign, palettes) {
      const index = campaigns.findIndex((item) => item.id === campaign.id);
      if (index >= 0) campaigns[index] = { ...campaign, colors: campaign.colors.slice() };
      return save(palettes, campaign.id);
    },
    show() {
      menu.hidden = false;
      render();
      undoDelete.hidden = !deletedCampaign;
      if (storageAvailable)
        setMessage(deletedCampaign ? `Deleted “${deletedCampaign.campaign.name}”` : '');
    },
    dispose() {
      unsubscribe();
      releaseBusy();
      listeners.abort();
    },
  };
}
