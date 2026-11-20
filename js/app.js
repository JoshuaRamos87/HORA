/**
 * HORA — Minimalist Hourly Fine Art Gallery
 * Main client application controller.
 */

import {
  ART_CATEGORIES,
  FRAMING_MODES,
  IDLE_TIMEOUT_MS,
  MUSEUMS,
} from './config.js';
import {
  formatCountdown,
  formatHourLabel,
  getCurrentHourKey,
  getMsUntilNextHour,
  getNextHourDate,
} from './clock.js';
import {
  canSkipInHour,
  loadGalleryState,
  loadSettings,
  recordDisplayedArtwork,
  saveGalleryState,
  saveSettings,
} from './storage.js';
import { enrichArtworkContext, fetchNextArtwork } from './api.js';

const FRAMING_LABELS = {
  ambient: 'Ambient Frame',
  fill: 'Full-Bleed Fill',
  matte: 'Dark Gallery Matte',
};

const dom = {
  viewport: document.getElementById('gallery-viewport'),
  ambientImage: document.getElementById('ambient-image'),
  artworkImage: document.getElementById('artwork-image'),
  stageStatus: document.getElementById('stage-status'),
  statusLabel: document.getElementById('status-label'),
  statusRetryBtn: document.getElementById('status-retry-btn'),

  menuTrigger: document.getElementById('menu-trigger'),
  infoTrigger: document.getElementById('info-trigger'),
  whisperCaption: document.getElementById('whisper-caption'),
  scrim: document.getElementById('overlay-scrim'),

  infoDrawer: document.getElementById('info-drawer'),
  infoCloseBtn: document.getElementById('info-close-btn'),
  infoMuseum: document.getElementById('info-museum'),
  infoType: document.getElementById('info-type'),
  infoHourBadge: document.getElementById('info-hour-badge'),
  infoTitle: document.getElementById('info-title'),
  infoArtist: document.getElementById('info-artist'),
  infoMetaGrid: document.getElementById('info-meta-grid'),
  infoHistorySection: document.getElementById('info-history-section'),
  infoHistorySource: document.getElementById('info-history-source'),
  infoHistoryProse: document.getElementById('info-history-prose'),
  infoTags: document.getElementById('info-tags'),
  infoCredit: document.getElementById('info-credit'),
  infoMuseumLink: document.getElementById('info-museum-link'),

  menuDrawer: document.getElementById('menu-drawer'),
  menuCloseBtn: document.getElementById('menu-close-btn'),
  menuTabs: Array.from(document.querySelectorAll('.menu-tab')),
  menuPanels: Array.from(document.querySelectorAll('.menu-panel')),
  menuNextLabel: document.getElementById('menu-next-label'),
  menuCountdown: document.getElementById('menu-countdown'),
  skipBtn: document.getElementById('skip-btn'),
  skipBtnLabel: document.getElementById('skip-btn-label'),
  skipHint: document.getElementById('skip-hint'),
  framingButtons: Array.from(document.querySelectorAll('[data-framing-option]')),
  fullscreenBtn: document.getElementById('fullscreen-btn'),
  fullscreenLabel: document.getElementById('fullscreen-label'),
  museumToggles: document.getElementById('museum-toggles'),
  categoryToggles: document.getElementById('category-toggles'),
  toggleHighlights: document.getElementById('toggle-highlights'),

  toast: document.getElementById('toast'),
};

let settings = loadSettings();
let galleryState = loadGalleryState();
let activeOverlay = null; // 'info' | 'menu' | null
let isLoadingArtwork = false;
let loadRequestId = 0;
let idleTimer = null;
let hourTimer = null;
let clockInterval = null;
let toastTimer = null;

/* ==========================================================================
   Toast & Status Helpers
   ========================================================================== */

function showToast(message, durationMs = 2600) {
  dom.toast.textContent = message;
  dom.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.classList.remove('is-visible');
  }, durationMs);
}

function setStageStatus(mode, message = '') {
  if (mode === 'hidden') {
    dom.stageStatus.classList.remove('is-visible');
    return;
  }
  dom.stageStatus.dataset.mode = mode;
  dom.statusLabel.textContent = message;
  dom.stageStatus.classList.add('is-visible');
}

/* ==========================================================================
   Idle Chrome Auto-Dim
   ========================================================================== */

function wakeChrome() {
  dom.viewport.classList.remove('is-idle');
  clearTimeout(idleTimer);
  if (activeOverlay) return;
  idleTimer = setTimeout(() => {
    if (!activeOverlay) {
      dom.viewport.classList.add('is-idle');
    }
  }, IDLE_TIMEOUT_MS);
}

/* ==========================================================================
   Overlays (Bottom Info Drawer & Left Hamburger Menu)
   ========================================================================== */

function openOverlay(which) {
  activeOverlay = which;
  clearTimeout(idleTimer);
  dom.viewport.classList.remove('is-idle');
  dom.viewport.classList.add('is-overlay-open');
  dom.scrim.classList.add('is-open');

  const isInfo = which === 'info';
  const isMenu = which === 'menu';

  dom.infoDrawer.classList.toggle('is-open', isInfo);
  dom.infoDrawer.setAttribute('aria-hidden', String(!isInfo));
  dom.infoTrigger.setAttribute('aria-expanded', String(isInfo));

  dom.menuDrawer.classList.toggle('is-open', isMenu);
  dom.menuDrawer.setAttribute('aria-hidden', String(!isMenu));
  dom.menuTrigger.setAttribute('aria-expanded', String(isMenu));

  updateClockUI();
  const focusTarget = isInfo ? dom.infoCloseBtn : dom.menuCloseBtn;
  setTimeout(() => focusTarget?.focus({ preventScroll: true }), 120);
}

function closeOverlays() {
  if (!activeOverlay) return;
  const previous = activeOverlay;
  activeOverlay = null;
  dom.viewport.classList.remove('is-overlay-open');
  dom.scrim.classList.remove('is-open');

  dom.infoDrawer.classList.remove('is-open');
  dom.infoDrawer.setAttribute('aria-hidden', 'true');
  dom.infoTrigger.setAttribute('aria-expanded', 'false');

  dom.menuDrawer.classList.remove('is-open');
  dom.menuDrawer.setAttribute('aria-hidden', 'true');
  dom.menuTrigger.setAttribute('aria-expanded', 'false');

  if (previous === 'info') {
    dom.infoTrigger?.focus({ preventScroll: true });
  } else if (previous === 'menu') {
    dom.menuTrigger?.focus({ preventScroll: true });
  }

  wakeChrome();
}

function selectMenuTab(tabName) {
  for (const tab of dom.menuTabs) {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const panel of dom.menuPanels) {
    const active = panel.id === `panel-${tabName}`;
    panel.classList.toggle('is-active', active);
  }
}

/* ==========================================================================
   Framing & Fullscreen
   ========================================================================== */

function applyFraming(mode) {
  const valid = FRAMING_MODES.includes(mode) ? mode : 'ambient';
  settings = saveSettings({ ...settings, framing: valid });
  dom.viewport.dataset.framing = valid;
  for (const btn of dom.framingButtons) {
    btn.classList.toggle('is-active', btn.dataset.framingOption === valid);
  }
}

function cycleFraming() {
  const idx = FRAMING_MODES.indexOf(settings.framing);
  const next = FRAMING_MODES[(idx + 1) % FRAMING_MODES.length];
  applyFraming(next);
  showToast(`Framing: ${FRAMING_LABELS[next]}`);
}

function updateFullscreenButton() {
  const isFs = Boolean(document.fullscreenElement);
  dom.fullscreenLabel.textContent = isFs ? 'Exit Fullscreen' : 'Enter Fullscreen';
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch {
    showToast('Fullscreen is not available in this browser view');
  }
}

/* ==========================================================================
   Filter Settings Rendering & Handlers
   ========================================================================== */

function createToggleRow({ id, title, desc, checked, onChange }) {
  const label = document.createElement('label');
  label.className = 'toggle-row';
  label.htmlFor = id;

  const textWrap = document.createElement('span');
  textWrap.className = 'toggle-text';

  const titleEl = document.createElement('span');
  titleEl.className = 'toggle-title';
  titleEl.textContent = title;

  const descEl = document.createElement('span');
  descEl.className = 'toggle-desc';
  descEl.textContent = desc;

  textWrap.append(titleEl, descEl);

  const input = document.createElement('input');
  input.id = id;
  input.type = 'checkbox';
  input.className = 'switch-input';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input));

  label.append(textWrap, input);
  return label;
}

function renderFilterSettings() {
  dom.museumToggles.innerHTML = '';
  for (const museum of MUSEUMS) {
    dom.museumToggles.append(
      createToggleRow({
        id: `toggle-museum-${museum.id}`,
        title: museum.name,
        desc: museum.description,
        checked: Boolean(settings.museums[museum.id]),
        onChange: (input) => {
          const nextMuseums = { ...settings.museums, [museum.id]: input.checked };
          if (!Object.values(nextMuseums).some(Boolean)) {
            input.checked = true;
            showToast('Keep at least one museum enabled');
            return;
          }
          settings = saveSettings({ ...settings, museums: nextMuseums });
          showToast('Saved — applies next hour or skip');
        },
      })
    );
  }

  dom.categoryToggles.innerHTML = '';
  for (const cat of ART_CATEGORIES) {
    dom.categoryToggles.append(
      createToggleRow({
        id: `toggle-cat-${cat.id}`,
        title: cat.label,
        desc: cat.description,
        checked: Boolean(settings.categories[cat.id]),
        onChange: (input) => {
          const nextCats = { ...settings.categories, [cat.id]: input.checked };
          if (!Object.values(nextCats).some(Boolean)) {
            input.checked = true;
            showToast('Keep at least one art type enabled');
            return;
          }
          settings = saveSettings({ ...settings, categories: nextCats });
          showToast('Saved — applies next hour or skip');
        },
      })
    );
  }

  dom.toggleHighlights.checked = Boolean(settings.highlightsOnly);
}

/* ==========================================================================
   Image Preloading & Artwork Presentation
   ========================================================================== */

function loadFirstWorkingImage(urls) {
  return new Promise((resolve, reject) => {
    const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
    if (list.length === 0) {
      reject(new Error('No image URLs available'));
      return;
    }

    let idx = 0;
    const tryNext = () => {
      if (idx >= list.length) {
        reject(new Error('All image resolutions failed to load'));
        return;
      }
      const candidateUrl = list[idx++];
      const probe = new Image();
      probe.decoding = 'async';
      probe.referrerPolicy = 'no-referrer';
      probe.onload = async () => {
        try {
          if (typeof probe.decode === 'function') {
            await probe.decode();
          }
        } catch {
          // Proceed even if decode throws on already-ready image
        }
        resolve(candidateUrl);
      };
      probe.onerror = () => tryNext();
      probe.src = candidateUrl;
    };

    tryNext();
  });
}

function renderArtworkMetadata(artwork, { loadingContext = false } = {}) {
  dom.infoMuseum.textContent = artwork.museumName;
  dom.infoType.textContent = artwork.categoryLabel || 'Fine Art';
  dom.infoTitle.textContent = artwork.title;
  dom.infoArtist.textContent = artwork.artist;
  dom.infoArtist.hidden = !artwork.artist;

  const captionParts = [artwork.title, artwork.artistShort].filter(Boolean);
  dom.whisperCaption.textContent = captionParts.join(' — ');
  document.title = `${artwork.title} — HORA`;

  // Build archival key-value specs, omitting empty fields.
  const specs = [
    { label: 'Date / Era', value: artwork.dateDisplay },
    { label: 'Movement / Period', value: artwork.eraOrMovement },
    { label: 'Origin / Culture', value: artwork.originOrCulture },
    { label: 'Medium', value: artwork.medium },
    { label: 'Dimensions', value: artwork.dimensions },
    { label: 'Department', value: artwork.department },
    { label: 'Gallery Status', value: artwork.galleryLocation },
  ].filter((s) => Boolean(s.value));

  dom.infoMetaGrid.innerHTML = '';
  for (const spec of specs) {
    const wrap = document.createElement('div');
    wrap.className = 'meta-item';

    const dt = document.createElement('dt');
    dt.className = 'meta-label';
    dt.textContent = spec.label;

    const dd = document.createElement('dd');
    dd.className = 'meta-value';
    dd.textContent = spec.value;

    wrap.append(dt, dd);
    dom.infoMetaGrid.append(wrap);
  }

  // Art history & curatorial context
  renderHistoryBlock(artwork, loadingContext);

  // Subject tags
  dom.infoTags.innerHTML = '';
  if (Array.isArray(artwork.tags) && artwork.tags.length > 0) {
    for (const tag of artwork.tags) {
      const chip = document.createElement('span');
      chip.className = 'subject-chip';
      chip.textContent = tag;
      dom.infoTags.append(chip);
    }
    dom.infoTags.hidden = false;
  } else {
    dom.infoTags.hidden = true;
  }

  // Footer attribution & museum catalog link
  dom.infoCredit.textContent = artwork.creditLine || `Collection of ${artwork.museumName}.`;
  dom.infoMuseumLink.href = artwork.museumUrl || '#';
  dom.infoMuseumLink.querySelector('span').textContent = `View at ${artwork.museumShort || 'Museum'}`;
}

function renderHistoryBlock(artwork, loadingContext = false) {
  dom.infoHistorySource.innerHTML = '';
  dom.infoHistoryProse.innerHTML = '';

  if (artwork.descriptionHtml) {
    dom.infoHistorySection.hidden = false;
    dom.infoHistoryProse.innerHTML = artwork.descriptionHtml;

    if (artwork.descriptionSource?.label) {
      if (artwork.descriptionSource.url) {
        const a = document.createElement('a');
        a.href = artwork.descriptionSource.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = artwork.descriptionSource.label;
        dom.infoHistorySource.append(a);
      } else {
        dom.infoHistorySource.textContent = artwork.descriptionSource.label;
      }
    }
    return;
  }

  if (loadingContext) {
    dom.infoHistorySection.hidden = false;
    const p = document.createElement('p');
    p.className = 'history-loading';
    p.textContent = 'Looking up art-historical context…';
    dom.infoHistoryProse.append(p);
    return;
  }

  dom.infoHistorySection.hidden = true;
}

async function presentArtwork(artwork, { requestId }) {
  // Show AIC low-res blur preview immediately while the crisp image downloads.
  if (artwork.lqip) {
    dom.artworkImage.src = artwork.lqip;
    dom.artworkImage.alt = artwork.altText || artwork.title;
    dom.artworkImage.classList.add('is-visible', 'is-lqip');
  } else {
    dom.artworkImage.classList.remove('is-visible', 'is-lqip');
  }

  const resolvedUrl = await loadFirstWorkingImage(artwork.imageUrls);
  if (requestId !== loadRequestId) return false;

  dom.artworkImage.referrerPolicy = 'no-referrer';
  dom.artworkImage.alt = artwork.altText || artwork.title;
  dom.artworkImage.src = resolvedUrl;
  dom.artworkImage.classList.remove('is-lqip');
  // Force clean fade-in transition on the next animation frame.
  requestAnimationFrame(() => {
    dom.artworkImage.classList.add('is-visible');
  });

  // Update ambient blurred backdrop cleanly.
  dom.ambientImage.classList.remove('is-visible');
  dom.ambientImage.referrerPolicy = 'no-referrer';
  dom.ambientImage.src = resolvedUrl;
  requestAnimationFrame(() => {
    dom.ambientImage.classList.add('is-visible');
  });

  setStageStatus('hidden');
  renderArtworkMetadata(artwork, { loadingContext: artwork.needsContextEnrichment });

  // Kick off optional Wikipedia/Wikidata context enrichment in the background for Met works.
  if (artwork.needsContextEnrichment && !artwork.descriptionHtml) {
    enrichArtworkContext(artwork).then((context) => {
      if (requestId !== loadRequestId) return;
      if (context) {
        const enriched = {
          ...artwork,
          descriptionHtml: context.descriptionHtml,
          descriptionSource: context.descriptionSource,
          needsContextEnrichment: false,
        };
        if (galleryState.artwork?.uid === artwork.uid) {
          galleryState = saveGalleryState({ ...galleryState, artwork: enriched });
        }
        renderHistoryBlock(enriched, false);
      } else {
        renderHistoryBlock(artwork, false);
      }
    });
  }

  return true;
}

/* ==========================================================================
   Hourly Load & 1-Skip-Per-Hour Flow
   ========================================================================== */

async function loadFreshArtwork({ reason = 'hour', consumeSkip = false } = {}) {
  if (isLoadingArtwork) return;
  isLoadingArtwork = true;
  const requestId = ++loadRequestId;
  const hourKey = getCurrentHourKey();
  const hadVisibleArtwork = Boolean(dom.artworkImage.getAttribute('src') && galleryState.artwork);

  const statusText =
    reason === 'skip'
      ? 'Curating another piece…'
      : reason === 'retry'
        ? 'Connecting to museum collections…'
        : 'Selecting this hour’s work…';

  dom.artworkImage.classList.remove('is-visible');
  setStageStatus('loading', statusText);
  updateClockUI();

  const recentIds = [...galleryState.recentIds];
  const lastSource = galleryState.artwork?.source || null;

  try {
    let loaded = false;
    let lastError = null;

    // Up to 3 attempts in case an individual image CDN URL fails to load.
    for (let attempt = 0; attempt < 3 && !loaded; attempt++) {
      const candidate = await fetchNextArtwork(settings, recentIds, lastSource);
      if (requestId !== loadRequestId) return;

      try {
        await presentArtwork(candidate, { requestId });
        galleryState = saveGalleryState(
          recordDisplayedArtwork(galleryState, candidate, hourKey, {
            consumedSkip: consumeSkip,
          })
        );
        loaded = true;
      } catch (imgErr) {
        lastError = imgErr;
        if (candidate?.uid) recentIds.push(candidate.uid);
      }
    }

    if (!loaded) {
      throw lastError || new Error('Could not display artwork image');
    }

    if (reason === 'skip') {
      showToast('Artwork skipped — 0 skips left this hour');
    } else if (reason === 'top-of-hour') {
      showToast(`New hour · ${formatHourLabel(new Date())}`);
    }
  } catch (err) {
    if (requestId !== loadRequestId) return;
    if (reason === 'skip' && hadVisibleArtwork) {
      dom.artworkImage.classList.add('is-visible');
      setStageStatus('hidden');
      showToast('Couldn’t reach museums — your hourly skip wasn’t used', 3400);
    } else {
      setStageStatus(
        'error',
        err?.message || 'Unable to reach the museum APIs right now.'
      );
    }
  } finally {
    if (requestId === loadRequestId) {
      isLoadingArtwork = false;
      updateClockUI();
    }
  }
}

async function handleSkip() {
  const hourKey = getCurrentHourKey();
  if (isLoadingArtwork) return;
  if (!canSkipInHour(galleryState, hourKey)) {
    const nextLabel = formatHourLabel(getNextHourDate());
    showToast(`Skip already used — resets at ${nextLabel}`);
    return;
  }
  closeOverlays();
  await loadFreshArtwork({ reason: 'skip', consumeSkip: true });
}

/* ==========================================================================
   Clock & Top-of-the-Hour (:00) Scheduler
   ========================================================================== */

function updateClockUI() {
  const now = new Date();
  const hourKey = getCurrentHourKey(now);
  const nextDate = getNextHourDate(now);
  const msLeft = Math.max(0, nextDate.getTime() - now.getTime());
  const nextLabel = formatHourLabel(nextDate);
  const countdown = formatCountdown(msLeft);
  const currentLabel = formatHourLabel(now);

  dom.menuNextLabel.textContent = `Next artwork at ${nextLabel}`;
  dom.menuCountdown.textContent = `in ${countdown}`;
  dom.infoHourBadge.textContent = `${currentLabel} Hour · Next in ${countdown}`;

  const skipAvailable = canSkipInHour(galleryState, hourKey);
  dom.skipBtn.disabled = !skipAvailable || isLoadingArtwork;

  if (isLoadingArtwork) {
    dom.skipBtnLabel.textContent = 'Loading…';
    dom.skipHint.textContent = 'Fetching from museum archives';
  } else if (skipAvailable) {
    dom.skipBtnLabel.textContent = 'Skip Artwork';
    dom.skipHint.textContent = '1 skip available this hour';
  } else {
    dom.skipBtnLabel.textContent = 'Skip Used This Hour';
    dom.skipHint.textContent = `Resets at ${nextLabel} (in ${countdown})`;
  }
}

function checkHourBoundary() {
  const currentKey = getCurrentHourKey();
  if (!isLoadingArtwork && galleryState.hourKey && galleryState.hourKey !== currentKey) {
    loadFreshArtwork({ reason: 'top-of-hour', consumeSkip: false });
  }
  updateClockUI();
}

function scheduleNextHourRotation() {
  clearTimeout(hourTimer);
  const ms = getMsUntilNextHour();
  hourTimer = setTimeout(() => {
    checkHourBoundary();
    scheduleNextHourRotation();
  }, ms);
}

/* ==========================================================================
   Touch Swipe Gestures for Bottom Info Drawer
   ========================================================================== */

function bindSwipeGestures() {
  let startY = null;
  let startX = null;

  dom.viewport.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
    },
    { passive: true }
  );

  dom.viewport.addEventListener(
    'touchend',
    (e) => {
      if (startY === null || e.changedTouches.length !== 1) return;
      const dy = e.changedTouches[0].clientY - startY;
      const dx = Math.abs(e.changedTouches[0].clientX - startX);
      const startedNearBottom = startY > window.innerHeight * 0.65;
      startY = null;
      startX = null;

      if (dx > 70) return;

      // Swipe up from lower portion opens info drawer.
      if (!activeOverlay && startedNearBottom && dy < -48) {
        openOverlay('info');
      } else if (activeOverlay === 'info' && dy > 65 && dom.infoDrawer.querySelector('.info-drawer-body').scrollTop <= 2) {
        closeOverlays();
      }
    },
    { passive: true }
  );
}

/* ==========================================================================
   Event Wiring & Bootstrap
   ========================================================================== */

function bindEvents() {
  dom.menuTrigger.addEventListener('click', () => openOverlay('menu'));
  dom.infoTrigger.addEventListener('click', () => openOverlay('info'));
  dom.infoCloseBtn.addEventListener('click', closeOverlays);
  dom.menuCloseBtn.addEventListener('click', closeOverlays);
  dom.scrim.addEventListener('click', closeOverlays);

  dom.skipBtn.addEventListener('click', handleSkip);
  dom.statusRetryBtn.addEventListener('click', () => loadFreshArtwork({ reason: 'retry' }));
  dom.fullscreenBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenButton);

  for (const tab of dom.menuTabs) {
    tab.addEventListener('click', () => selectMenuTab(tab.dataset.tab));
  }

  for (const btn of dom.framingButtons) {
    btn.addEventListener('click', () => {
      applyFraming(btn.dataset.framingOption);
      showToast(`Framing: ${FRAMING_LABELS[btn.dataset.framingOption]}`);
    });
  }

  dom.toggleHighlights.addEventListener('change', () => {
    settings = saveSettings({
      ...settings,
      highlightsOnly: dom.toggleHighlights.checked,
    });
    showToast('Saved — applies next hour or skip');
  });

  // Auto-dim chrome when admiring art
  ['pointermove', 'pointerdown', 'keydown'].forEach((evt) => {
    window.addEventListener(evt, wakeChrome, { passive: true });
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'Escape' && activeOverlay) {
      e.preventDefault();
      closeOverlays();
    } else if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'i') {
      if (activeOverlay === 'info') {
        closeOverlays();
      } else {
        e.preventDefault();
        openOverlay('info');
      }
    } else if (e.key === 'ArrowDown' && activeOverlay === 'info') {
      e.preventDefault();
      closeOverlays();
    } else if (e.key.toLowerCase() === 'm') {
      if (activeOverlay === 'menu') {
        closeOverlays();
      } else {
        e.preventDefault();
        openOverlay('menu');
      }
    } else if (e.key.toLowerCase() === 'f') {
      e.preventDefault();
      cycleFraming();
    }
  });

  // Wake cleanly after laptop sleep or switching back from a background tab
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkHourBoundary();
      scheduleNextHourRotation();
    }
  });

  bindSwipeGestures();
}

async function init() {
  applyFraming(settings.framing);
  renderFilterSettings();
  updateFullscreenButton();
  bindEvents();
  updateClockUI();
  scheduleNextHourRotation();
  clockInterval = setInterval(checkHourBoundary, 10000);
  wakeChrome();

  const currentHourKey = getCurrentHourKey();
  const hasValidCachedWork =
    galleryState.hourKey === currentHourKey &&
    galleryState.artwork &&
    Array.isArray(galleryState.artwork.imageUrls) &&
    galleryState.artwork.imageUrls.length > 0;

  if (hasValidCachedWork) {
    const requestId = ++loadRequestId;
    try {
      setStageStatus('loading', 'Restoring this hour’s work…');
      await presentArtwork(galleryState.artwork, { requestId });
      updateClockUI();
      return;
    } catch {
      // Cached image URL failed (stale or offline); fall through to live fetch.
    }
  }

  await loadFreshArtwork({ reason: 'hour', consumeSkip: false });
}

init();
