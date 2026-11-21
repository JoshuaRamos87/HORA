/**
 * HORA — Minimalist Hourly Fine Art Gallery
 * Main client application controller.
 */

import {
  APP_VERSION,
  ART_CATEGORIES,
  ART_ERA_GROUPS,
  ART_ERAS,
  FILTER_APPLY_COOLDOWN_MS,
  FRAMING_MODES,
  IDLE_TIMEOUT_MS,
  MAX_SKIPS_PER_HOUR,
  MUSEUMS,
  REPO_URL,
  SKIP_COOLDOWN_MS,
  THEME_MODES,
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
  getFilterSignature,
  getSkipsRemainingInHour,
  hasCompatibleCategoryForEras,
  isAllErasEnabled,
  isPhotographyAvailableForEras,
  loadGalleryState,
  loadSettings,
  recordDisplayedArtwork,
  resolveThemeMode,
  saveGalleryState,
  saveSettings,
} from './storage.js';
import { enrichArtworkContext, fetchNextArtwork } from './api.js';
import { createZoomController, ZOOM_STEP } from './zoom.js';

const FRAMING_LABELS = {
  ambient: 'Ambient Frame',
  fill: 'Full-Bleed Fill',
  matte: 'Gallery Matte',
};

const THEME_LABELS = {
  system: 'System Default',
  light: 'Light',
  dark: 'Dark',
};

const THEME_COLORS = {
  light: '#f3f0ea',
  dark: '#100f0e',
};

const dom = {
  metaThemeColor: document.getElementById('meta-theme-color'),
  viewport: document.getElementById('gallery-viewport'),
  artworkStage: document.getElementById('artwork-stage'),
  artworkFrame: document.getElementById('artwork-frame'),
  ambientImage: document.getElementById('ambient-image'),
  artworkImage: document.getElementById('artwork-image'),
  stageStatus: document.getElementById('stage-status'),
  statusLabel: document.getElementById('status-label'),
  statusRetryBtn: document.getElementById('status-retry-btn'),

  menuTrigger: document.getElementById('menu-trigger'),
  infoTrigger: document.getElementById('info-trigger'),
  whisperCaption: document.getElementById('whisper-caption'),
  scrim: document.getElementById('overlay-scrim'),

  zoomControl: document.getElementById('zoom-control'),
  zoomToggleBtn: document.getElementById('zoom-toggle-btn'),
  zoomToggleLabel: document.getElementById('zoom-toggle-label'),
  zoomSlider: document.getElementById('zoom-slider'),
  zoomOutBtn: document.getElementById('zoom-out-btn'),
  zoomInBtn: document.getElementById('zoom-in-btn'),
  zoomPercentBtn: document.getElementById('zoom-percent-btn'),
  zoomCollapseBtn: document.getElementById('zoom-collapse-btn'),

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
  skipPips: document.getElementById('skip-pips'),
  skipHint: document.getElementById('skip-hint'),
  framingButtons: Array.from(document.querySelectorAll('[data-framing-option]')),
  themeButtons: Array.from(document.querySelectorAll('[data-theme-option]')),
  viewportGroup: document.getElementById('viewport-group'),
  fullscreenBtn: document.getElementById('fullscreen-btn'),
  fullscreenLabel: document.getElementById('fullscreen-label'),
  installGroup: document.getElementById('install-group'),
  installBtn: document.getElementById('install-btn'),
  installLabel: document.getElementById('install-label'),
  installIosHint: document.getElementById('install-ios-hint'),
  museumToggles: document.getElementById('museum-toggles'),
  categoryToggles: document.getElementById('category-toggles'),
  eraToggles: document.getElementById('era-toggles'),
  erasAllBtn: document.getElementById('eras-all-btn'),
  toggleHighlights: document.getElementById('toggle-highlights'),
  applyFiltersBtn: document.getElementById('apply-filters-btn'),
  applyFiltersLabel: document.getElementById('apply-filters-label'),
  filterApplyHint: document.getElementById('filter-apply-hint'),
  aboutVersion: document.getElementById('about-version'),
  aboutRepoLink: document.getElementById('about-repo-link'),

  toast: document.getElementById('toast'),
};

const systemLightMediaQuery =
  typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null;

let settings = loadSettings();
let galleryState = loadGalleryState();
let appliedFilterSignature = getFilterSignature(settings);
let activeOverlay = null; // 'info' | 'menu' | null
let isLoadingArtwork = false;
let loadRequestId = 0;
let idleTimer = null;
let hourTimer = null;
let clockInterval = null;
let cooldownTimer = null;
let toastTimer = null;
let skipCooldownUntil = 0;
let filterCooldownUntil = 0;
let deferredInstallPrompt = null;
let zoomController = null;

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

function scheduleCooldownRefresh() {
  clearTimeout(cooldownTimer);
  const now = Date.now();
  const nextUnlock = Math.max(skipCooldownUntil, filterCooldownUntil);
  if (nextUnlock > now) {
    cooldownTimer = setTimeout(() => {
      updateClockUI();
      updateFilterApplyUI();
    }, nextUnlock - now + 60);
  }
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
  updateFilterApplyUI();
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
  if (tabName === 'settings') {
    updateFilterApplyUI();
  }
}

/* ==========================================================================
   Framing, Theme & Fullscreen
   ========================================================================== */

function applyFraming(mode) {
  const valid = FRAMING_MODES.includes(mode) ? mode : 'ambient';
  settings = saveSettings({ ...settings, framing: valid });
  dom.viewport.dataset.framing = valid;
  for (const btn of dom.framingButtons) {
    btn.classList.toggle('is-active', btn.dataset.framingOption === valid);
  }
  zoomController?.reset({ animate: true, collapse: false });
}

function cycleFraming() {
  const idx = FRAMING_MODES.indexOf(settings.framing);
  const next = FRAMING_MODES[(idx + 1) % FRAMING_MODES.length];
  applyFraming(next);
  showToast(`Framing: ${FRAMING_LABELS[next]}`);
}

function syncResolvedTheme(preference = settings.theme) {
  const prefersLight = Boolean(systemLightMediaQuery?.matches);
  const resolved = resolveThemeMode(preference, prefersLight);
  document.documentElement.dataset.theme = resolved;
  if (dom.metaThemeColor) {
    dom.metaThemeColor.setAttribute('content', THEME_COLORS[resolved] || THEME_COLORS.dark);
  }
}

function applyTheme(mode, { persist = true } = {}) {
  const valid = THEME_MODES.includes(mode) ? mode : 'system';
  if (persist) {
    settings = saveSettings({ ...settings, theme: valid });
  }
  for (const btn of dom.themeButtons) {
    const active = btn.dataset.themeOption === valid;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  }
  syncResolvedTheme(valid);
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
   Filter Settings Rendering & Apply Refresh Control
   ========================================================================== */

function hasPendingFilterChanges() {
  return getFilterSignature(settings) !== appliedFilterSignature;
}

function syncCategoryAvailability() {
  const photoAvailable = isPhotographyAvailableForEras(settings);
  const photoInput = document.getElementById('toggle-cat-photography');
  if (!photoInput) return;

  const row = photoInput.closest('.toggle-row');
  const descEl = row?.querySelector('.toggle-desc');
  const photoCat = ART_CATEGORIES.find((c) => c.id === 'photography');

  photoInput.disabled = !photoAvailable;
  photoInput.checked = photoAvailable ? Boolean(settings.categories.photography) : false;

  if (row) {
    row.classList.toggle('is-unavailable', !photoAvailable);
    row.setAttribute('aria-disabled', String(!photoAvailable));
  }
  if (descEl && photoCat) {
    descEl.textContent = photoAvailable
      ? photoCat.description
      : 'Unavailable for selected pre-1825 eras';
  }
}

function syncEraGroupSummaries() {
  for (const group of ART_ERA_GROUPS) {
    const groupEras = ART_ERAS.filter((e) => e.group === group.id);
    const activeCount = groupEras.filter((e) => Boolean(settings.eras[e.id])).length;
    const total = groupEras.length;
    const badge = dom.eraToggles.querySelector(`[data-era-group-count="${group.id}"]`);
    if (badge) {
      badge.textContent = `${activeCount}/${total}`;
      badge.classList.toggle('is-partial', activeCount > 0 && activeCount < total);
      badge.classList.toggle('is-empty', activeCount === 0);
    }
    const details = dom.eraToggles.querySelector(`[data-era-group="${group.id}"]`);
    if (details) {
      details.classList.toggle('is-empty', activeCount === 0);
    }
  }
}

function updateFilterApplyUI() {
  const pending = hasPendingFilterChanges();
  const compatible = hasCompatibleCategoryForEras(settings);
  const now = Date.now();
  const inCooldown = now < filterCooldownUntil;

  syncCategoryAvailability();
  syncEraGroupSummaries();
  dom.erasAllBtn.disabled = isAllErasEnabled(settings);
  dom.applyFiltersBtn.disabled = !pending || !compatible || isLoadingArtwork || inCooldown;

  if (isLoadingArtwork) {
    dom.applyFiltersLabel.textContent = 'Loading…';
    dom.filterApplyHint.textContent = 'Fetching a matching work from the archives';
  } else if (!compatible) {
    dom.applyFiltersLabel.textContent = 'Select Another Art Type or Era';
    dom.filterApplyHint.textContent = 'Photography isn’t available for the selected pre-1825 eras.';
  } else if (pending && inCooldown) {
    dom.applyFiltersLabel.textContent = 'Apply & Refresh Artwork';
    dom.filterApplyHint.textContent = 'Ready in a moment…';
  } else if (pending) {
    dom.applyFiltersLabel.textContent = 'Apply & Refresh Artwork';
    dom.filterApplyHint.textContent = 'Loads a matching work immediately — doesn’t use a skip.';
  } else {
    dom.applyFiltersLabel.textContent = 'Filters Active';
    dom.filterApplyHint.textContent = 'Toggle museums, art types, or eras to preview matching art without using a skip.';
  }
}

function createToggleRow({ id, title, desc, checked, onChange, onOnly = null }) {
  const row = document.createElement(onOnly ? 'div' : 'label');
  row.className = 'toggle-row';
  if (!onOnly) row.htmlFor = id;

  const textWrap = document.createElement(onOnly ? 'label' : 'span');
  textWrap.className = 'toggle-text';
  if (onOnly) textWrap.htmlFor = id;

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

  if (onOnly) {
    const controls = document.createElement('div');
    controls.className = 'toggle-controls';

    const onlyBtn = document.createElement('button');
    onlyBtn.type = 'button';
    onlyBtn.className = 'only-pill-btn';
    onlyBtn.textContent = 'Only';
    onlyBtn.setAttribute('aria-label', `Select only ${title}`);
    onlyBtn.addEventListener('click', () => onOnly());

    controls.append(onlyBtn, input);
    row.append(textWrap, controls);
  } else {
    row.append(textWrap, input);
  }

  return row;
}

function syncEraCheckboxes() {
  for (const era of ART_ERAS) {
    const el = document.getElementById(`toggle-era-${era.id}`);
    if (el) el.checked = Boolean(settings.eras[era.id]);
  }
  syncEraGroupSummaries();
}

function createEraGroupChevron() {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'era-group-chevron');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const poly = document.createElementNS(svgNS, 'polyline');
  poly.setAttribute('points', '6 9 12 15 18 9');
  svg.append(poly);
  return svg;
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
          updateFilterApplyUI();
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
          const photoAvailable = isPhotographyAvailableForEras(settings);
          const hasAnyActive = ART_CATEGORIES.some(
            (c) => nextCats[c.id] && (c.id !== 'photography' || photoAvailable)
          );
          if (!hasAnyActive) {
            input.checked = true;
            showToast('Keep at least one available art type enabled');
            return;
          }
          settings = saveSettings({ ...settings, categories: nextCats });
          updateFilterApplyUI();
        },
      })
    );
  }

  dom.eraToggles.innerHTML = '';
  const allErasOn = isAllErasEnabled(settings);

  for (const group of ART_ERA_GROUPS) {
    const groupEras = ART_ERAS.filter((e) => e.group === group.id);
    if (groupEras.length === 0) continue;

    const activeCount = groupEras.filter((e) => Boolean(settings.eras[e.id])).length;
    const details = document.createElement('details');
    details.className = 'era-group';
    details.dataset.eraGroup = group.id;
    // Keep groups cleanly collapsed when All Eras are active; auto-expand active narrowed groups.
    if (!allErasOn && activeCount > 0) {
      details.open = true;
    }

    const summary = document.createElement('summary');
    summary.className = 'era-group-summary';

    const meta = document.createElement('div');
    meta.className = 'era-group-meta';

    const titleEl = document.createElement('span');
    titleEl.className = 'era-group-title';
    titleEl.textContent = group.label;

    const subEl = document.createElement('span');
    subEl.className = 'era-group-sub';
    subEl.textContent = group.summary;

    meta.append(titleEl, subEl);

    const actions = document.createElement('div');
    actions.className = 'era-group-actions';

    const onlyGroupBtn = document.createElement('button');
    onlyGroupBtn.type = 'button';
    onlyGroupBtn.className = 'only-pill-btn era-group-only-btn';
    onlyGroupBtn.textContent = 'Only';
    onlyGroupBtn.setAttribute('aria-label', `Select only ${group.label} eras`);
    onlyGroupBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const onlyGroupEras = {};
      for (const item of ART_ERAS) {
        onlyGroupEras[item.id] = item.group === group.id;
      }
      settings = saveSettings({ ...settings, eras: onlyGroupEras });
      details.open = true;
      syncEraCheckboxes();
      updateFilterApplyUI();
    });

    const countBadge = document.createElement('span');
    countBadge.className = 'era-group-count';
    countBadge.dataset.eraGroupCount = group.id;

    actions.append(onlyGroupBtn, countBadge, createEraGroupChevron());
    summary.append(meta, actions);

    const list = document.createElement('div');
    list.className = 'era-group-list';

    for (const era of groupEras) {
      list.append(
        createToggleRow({
          id: `toggle-era-${era.id}`,
          title: era.label,
          desc: era.description,
          checked: Boolean(settings.eras[era.id]),
          onChange: (input) => {
            const nextEras = { ...settings.eras, [era.id]: input.checked };
            if (!Object.values(nextEras).some(Boolean)) {
              input.checked = true;
              showToast('Keep at least one era enabled');
              return;
            }
            settings = saveSettings({ ...settings, eras: nextEras });
            updateFilterApplyUI();
          },
          onOnly: () => {
            const onlyEras = {};
            for (const item of ART_ERAS) {
              onlyEras[item.id] = item.id === era.id;
            }
            settings = saveSettings({ ...settings, eras: onlyEras });
            syncEraCheckboxes();
            updateFilterApplyUI();
          },
        })
      );
    }

    details.append(summary, list);
    dom.eraToggles.append(details);
  }

  dom.toggleHighlights.checked = Boolean(settings.highlightsOnly);
  updateFilterApplyUI();
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

  renderHistoryBlock(artwork, loadingContext);

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
  zoomController?.reset({ animate: false, collapse: false });

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
  requestAnimationFrame(() => {
    dom.artworkImage.classList.add('is-visible');
  });

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
   Hourly Load, 5-Skip-Per-Hour Flow, and Filter Preview Flow
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
      : reason === 'filter'
        ? 'Finding a piece matching your filters…'
        : reason === 'retry'
          ? 'Connecting to museum collections…'
          : 'Selecting this hour’s work…';

  dom.artworkImage.classList.remove('is-visible');
  setStageStatus('loading', statusText);
  updateClockUI();
  updateFilterApplyUI();

  const recentIds = [...galleryState.recentIds];
  const lastSource = galleryState.artwork?.source || null;
  const requestedSignature = getFilterSignature(settings);

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
        appliedFilterSignature = requestedSignature;
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
      skipCooldownUntil = Date.now() + SKIP_COOLDOWN_MS;
      scheduleCooldownRefresh();
      const remaining = getSkipsRemainingInHour(galleryState, hourKey);
      if (remaining === 0) {
        showToast(`Last skip used — resets at ${formatHourLabel(getNextHourDate())}`);
      } else {
        showToast(`${remaining} ${remaining === 1 ? 'skip' : 'skips'} left this hour`);
      }
    } else if (reason === 'filter') {
      filterCooldownUntil = Date.now() + FILTER_APPLY_COOLDOWN_MS;
      scheduleCooldownRefresh();
      showToast('Filters applied — hourly skips unchanged');
    } else if (reason === 'top-of-hour') {
      showToast(`New hour · ${formatHourLabel(new Date())}`);
    }
  } catch (err) {
    if (requestId !== loadRequestId) return;
    if ((reason === 'skip' || reason === 'filter') && hadVisibleArtwork) {
      dom.artworkImage.classList.add('is-visible');
      setStageStatus('hidden');
      const isNoMatch = typeof err?.message === 'string' && err.message.startsWith('No artworks matched');
      showToast(
        isNoMatch
          ? err.message
          : reason === 'skip'
            ? 'Couldn’t reach museums — your skip wasn’t used'
            : 'Couldn’t reach museums right now — try applying again',
        isNoMatch ? 4200 : 3400
      );
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
      updateFilterApplyUI();
    }
  }
}

async function handleSkip() {
  const hourKey = getCurrentHourKey();
  if (isLoadingArtwork) return;
  if (Date.now() < skipCooldownUntil) return;
  if (!canSkipInHour(galleryState, hourKey)) {
    const nextLabel = formatHourLabel(getNextHourDate());
    showToast(`All ${MAX_SKIPS_PER_HOUR} skips used — resets at ${nextLabel}`);
    return;
  }
  closeOverlays();
  await loadFreshArtwork({ reason: 'skip', consumeSkip: true });
}

async function handleApplyFilters() {
  if (isLoadingArtwork) return;
  if (!hasPendingFilterChanges() || Date.now() < filterCooldownUntil) return;
  closeOverlays();
  await loadFreshArtwork({ reason: 'filter', consumeSkip: false });
}

/* ==========================================================================
   Clock & Top-of-the-Hour (:00) Scheduler
   ========================================================================== */

function renderSkipPips(remaining) {
  dom.skipPips.innerHTML = '';
  for (let i = 0; i < MAX_SKIPS_PER_HOUR; i++) {
    const pip = document.createElement('span');
    pip.className = i < remaining ? 'skip-pip' : 'skip-pip is-spent';
    dom.skipPips.append(pip);
  }
}

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

  const remaining = getSkipsRemainingInHour(galleryState, hourKey);
  const inCooldown = Date.now() < skipCooldownUntil;
  renderSkipPips(remaining);

  dom.skipBtn.disabled = remaining === 0 || isLoadingArtwork || inCooldown;

  if (isLoadingArtwork) {
    dom.skipBtnLabel.textContent = 'Loading…';
    dom.skipHint.textContent = 'Fetching from museum archives';
  } else if (remaining === 0) {
    dom.skipBtnLabel.textContent = 'No Skips Left';
    dom.skipHint.textContent = `Resets at ${nextLabel} (in ${countdown})`;
  } else if (inCooldown) {
    dom.skipBtnLabel.textContent = 'Skip Artwork';
    dom.skipHint.textContent = 'Ready in a moment…';
  } else {
    dom.skipBtnLabel.textContent = 'Skip Artwork';
    dom.skipHint.textContent = `${remaining} of ${MAX_SKIPS_PER_HOUR} ${remaining === 1 ? 'skip' : 'skips'} left this hour`;
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
      if (e.touches.length !== 1) {
        startY = null;
        startX = null;
        return;
      }
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
    },
    { passive: true }
  );

  dom.viewport.addEventListener(
    'touchend',
    (e) => {
      if (startY === null || e.changedTouches.length !== 1 || zoomController?.isInteracting()) {
        startY = null;
        startX = null;
        return;
      }
      const dy = e.changedTouches[0].clientY - startY;
      const dx = Math.abs(e.changedTouches[0].clientX - startX);
      const startedNearBottom = startY > window.innerHeight * 0.65;
      startY = null;
      startX = null;

      if (dx > 70) return;

      if (!activeOverlay && startedNearBottom && dy < -48) {
        openOverlay('info');
      } else if (
        activeOverlay === 'info' &&
        dy > 65 &&
        dom.infoDrawer.querySelector('.info-drawer-body').scrollTop <= 2
      ) {
        closeOverlays();
      }
    },
    { passive: true }
  );
}

/* ==========================================================================
   PWA Installability & Service Worker Registration
   ========================================================================== */

function isStandaloneMode() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true
  );
}

function isIosSafari() {
  const ua = window.navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isWebkit = /WebKit/i.test(ua);
  const isOtherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  return isIos && isWebkit && !isOtherBrowser;
}

function setupPwaSupport() {
  const standalone = isStandaloneMode();
  const supportsFullscreen = typeof document.documentElement.requestFullscreen === 'function';

  // Hide browser fullscreen button when already running as a full-screen installed PWA or on iOS.
  if (standalone || !supportsFullscreen) {
    dom.viewportGroup.hidden = true;
  }

  if (standalone) {
    dom.installGroup.hidden = true;
    return;
  }

  // iOS Safari does not emit beforeinstallprompt; offer a clean inline Add-to-Home-Screen guide.
  if (isIosSafari()) {
    dom.installLabel.textContent = 'Install on iPhone / iPad';
    dom.installGroup.hidden = false;
  }

  // Chromium / Android / Edge native PWA install flow.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    dom.installLabel.textContent = 'Install App';
    dom.installIosHint.hidden = true;
    dom.installGroup.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    dom.installGroup.hidden = true;
    dom.installIosHint.hidden = true;
    showToast('HORA installed to your home screen');
  });

  dom.installBtn.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      promptEvent.prompt();
      try {
        const choice = await promptEvent.userChoice;
        if (choice?.outcome !== 'accepted') {
          dom.installGroup.hidden = true;
          showToast('You can install anytime from your browser menu');
        }
      } catch {
        dom.installGroup.hidden = true;
      }
      return;
    }

    if (isIosSafari()) {
      dom.installIosHint.hidden = !dom.installIosHint.hidden;
    }
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloadedForUpdate = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloadedForUpdate) return;
    reloadedForUpdate = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './', updateViaCache: 'none' })
      .then((reg) => reg.update().catch(() => {}))
      .catch(() => {
        // Service worker registration is optional; fail quietly on unsupported hosts/origins.
      });
  });
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
  dom.applyFiltersBtn.addEventListener('click', handleApplyFilters);
  dom.erasAllBtn.addEventListener('click', () => {
    const allEras = {};
    for (const era of ART_ERAS) {
      allEras[era.id] = true;
    }
    settings = saveSettings({ ...settings, eras: allEras });
    syncEraCheckboxes();
    updateFilterApplyUI();
  });
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

  for (const btn of dom.themeButtons) {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.themeOption;
      applyTheme(mode);
      showToast(`Theme: ${THEME_LABELS[mode] || 'System Default'}`);
    });
  }

  if (systemLightMediaQuery) {
    const handleSystemThemeChange = () => {
      if (settings.theme === 'system') {
        syncResolvedTheme('system');
      }
    };
    if (typeof systemLightMediaQuery.addEventListener === 'function') {
      systemLightMediaQuery.addEventListener('change', handleSystemThemeChange);
    } else if (typeof systemLightMediaQuery.addListener === 'function') {
      systemLightMediaQuery.addListener(handleSystemThemeChange);
    }
  }

  dom.toggleHighlights.addEventListener('change', () => {
    settings = saveSettings({
      ...settings,
      highlightsOnly: dom.toggleHighlights.checked,
    });
    updateFilterApplyUI();
  });

  ['pointermove', 'pointerdown', 'keydown'].forEach((evt) => {
    window.addEventListener(evt, wakeChrome, { passive: true });
  });

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    const isZoomSlider = document.activeElement === dom.zoomSlider;
    if ((tag === 'INPUT' || tag === 'TEXTAREA') && !isZoomSlider) return;

    if (e.key === 'Escape') {
      if (activeOverlay) {
        e.preventDefault();
        closeOverlays();
      } else if (zoomController?.isZoomed()) {
        e.preventDefault();
        zoomController.reset({ animate: true, collapse: false });
      }
    } else if (e.key === '+' || e.key === '=') {
      if (!activeOverlay) {
        e.preventDefault();
        zoomController?.stepZoom(ZOOM_STEP);
      }
    } else if (e.key === '-' || e.key === '_') {
      if (!activeOverlay) {
        e.preventDefault();
        zoomController?.stepZoom(-ZOOM_STEP);
      }
    } else if (e.key === '0') {
      if (!activeOverlay && zoomController?.isZoomed()) {
        e.preventDefault();
        zoomController.reset({ animate: true, collapse: false });
      }
    } else if (isZoomSlider) {
      return;
    } else if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'i') {
      if (activeOverlay === 'info') {
        closeOverlays();
      } else {
        e.preventDefault();
        openOverlay('info');
      }
    } else if (e.key === 'ArrowDown' && activeOverlay === 'info') {
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

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkHourBoundary();
      scheduleNextHourRotation();
    }
  });

  bindSwipeGestures();
}

async function init() {
  zoomController = createZoomController({
    viewport: dom.viewport,
    stage: dom.artworkStage,
    frame: dom.artworkFrame,
    image: dom.artworkImage,
    controlWrap: dom.zoomControl,
    toggleBtn: dom.zoomToggleBtn,
    toggleLabel: dom.zoomToggleLabel,
    slider: dom.zoomSlider,
    outBtn: dom.zoomOutBtn,
    inBtn: dom.zoomInBtn,
    percentBtn: dom.zoomPercentBtn,
    collapseBtn: dom.zoomCollapseBtn,
    isOverlayOpen: () => Boolean(activeOverlay),
    onActivity: wakeChrome,
  });

  if (dom.aboutVersion) {
    dom.aboutVersion.textContent = `HORA · v${APP_VERSION}`;
  }
  if (dom.aboutRepoLink) {
    dom.aboutRepoLink.href = REPO_URL;
  }

  applyFraming(settings.framing);
  applyTheme(settings.theme, { persist: false });
  renderFilterSettings();
  updateFullscreenButton();
  setupPwaSupport();
  registerServiceWorker();
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
