/**
 * Client-side persistence for user settings, cached hourly artwork,
 * recent history deduplication, and the counted hourly skip budget.
 */

import {
  ART_CATEGORIES,
  ART_ERAS,
  BOOKMARKS_LIMIT,
  DEFAULT_SETTINGS,
  FRAMING_MODES,
  MAX_SKIPS_PER_HOUR,
  MUSEUMS,
  RECENT_ARCHIVE_LIMIT,
  RECENT_HISTORY_LIMIT,
  STORAGE_KEYS,
  THEME_MODES,
} from './config.js';

function resolveStorage(customStorage) {
  if (customStorage) return customStorage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function safeParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Ensures loaded settings always have valid museums, categories, eras
 * (at least 1 enabled in each group), and valid framing and theme modes.
 */
export function normalizeSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  const framing = FRAMING_MODES.includes(src.framing) ? src.framing : DEFAULT_SETTINGS.framing;
  const theme = THEME_MODES.includes(src.theme) ? src.theme : DEFAULT_SETTINGS.theme;
  const highlightsOnly =
    typeof src.highlightsOnly === 'boolean' ? src.highlightsOnly : DEFAULT_SETTINGS.highlightsOnly;

  const museums = {};
  for (const m of MUSEUMS) {
    museums[m.id] =
      src.museums && typeof src.museums[m.id] === 'boolean'
        ? src.museums[m.id]
        : DEFAULT_SETTINGS.museums[m.id];
  }
  if (!Object.values(museums).some(Boolean)) {
    museums.aic = true;
    museums.met = true;
  }

  const categories = {};
  for (const c of ART_CATEGORIES) {
    categories[c.id] =
      src.categories && typeof src.categories[c.id] === 'boolean'
        ? src.categories[c.id]
        : DEFAULT_SETTINGS.categories[c.id];
  }
  if (!Object.values(categories).some(Boolean)) {
    for (const c of ART_CATEGORIES) {
      categories[c.id] = true;
    }
  }

  const eras = {};
  const hasSavedEras = Boolean(src.eras && typeof src.eras === 'object');
  const hadCustomEraExclusions =
    hasSavedEras && Object.values(src.eras).some((v) => v === false);

  for (const e of ART_ERAS) {
    if (hasSavedEras && typeof src.eras[e.id] === 'boolean') {
      eras[e.id] = src.eras[e.id];
    } else {
      eras[e.id] = hadCustomEraExclusions ? false : DEFAULT_SETTINGS.eras[e.id];
    }
  }
  if (!Object.values(eras).some(Boolean)) {
    for (const e of ART_ERAS) {
      eras[e.id] = true;
    }
  }

  return { framing, theme, highlightsOnly, museums, categories, eras };
}

/**
 * Resolves a stored theme preference ('system' | 'light' | 'dark') to the active
 * visual theme ('light' | 'dark') given whether the OS prefers light color scheme.
 */
export function resolveThemeMode(themePreference, prefersLight = false) {
  if (themePreference === 'light') return 'light';
  if (themePreference === 'dark') return 'dark';
  return prefersLight ? 'light' : 'dark';
}

export function loadSettings(customStorage) {
  const store = resolveStorage(customStorage);
  if (!store) return normalizeSettings(null);
  return normalizeSettings(safeParse(store.getItem(STORAGE_KEYS.SETTINGS)));
}

export function saveSettings(settings, customStorage) {
  const normalized = normalizeSettings(settings);
  const store = resolveStorage(customStorage);
  if (store) {
    try {
      store.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(normalized));
    } catch {
      // Ignore quota / private browsing write errors gracefully.
    }
  }
  return normalized;
}

export function getEnabledMuseums(settings) {
  return MUSEUMS.map((m) => m.id).filter((id) => settings.museums[id]);
}

export function getEnabledCategories(settings) {
  return ART_CATEGORIES.map((c) => c.id).filter((id) => settings.categories[id]);
}

export function getEnabledEras(settings) {
  const eraMap = settings?.eras || DEFAULT_SETTINGS.eras;
  return ART_ERAS.map((e) => e.id).filter((id) => eraMap[id] !== false);
}

export function isAllErasEnabled(settings) {
  return getEnabledEras(settings).length === ART_ERAS.length;
}

/**
 * Returns true if at least one enabled art-history era extends into the
 * photography era (1825 or later).
 */
export function isPhotographyAvailableForEras(settings) {
  const enabledIds = new Set(getEnabledEras(settings));
  return ART_ERAS.some((era) => enabledIds.has(era.id) && era.dateEnd >= 1825);
}

/**
 * Returns true if at least one enabled art type can match the enabled eras.
 */
export function hasCompatibleCategoryForEras(settings) {
  const cats = getEnabledCategories(settings);
  if (cats.length === 0) return false;
  if (isPhotographyAvailableForEras(settings)) return true;
  return cats.some((id) => id !== 'photography');
}

/**
 * Stable signature of the curatorial filter settings (museums, art types, eras, highlights),
 * excluding visual framing and theme preferences so Apply Filters only triggers on collection changes.
 */
export function getFilterSignature(settings) {
  const normalized = normalizeSettings(settings);
  return JSON.stringify({
    museums: getEnabledMuseums(normalized),
    categories: getEnabledCategories(normalized),
    eras: getEnabledEras(normalized),
    highlightsOnly: normalized.highlightsOnly,
  });
}

export function loadGalleryState(customStorage) {
  const store = resolveStorage(customStorage);
  const empty = {
    hourKey: null,
    artwork: null,
    skipHourKey: null,
    skipsUsed: 0,
    recentIds: [],
  };
  if (!store) return empty;
  const parsed = safeParse(store.getItem(STORAGE_KEYS.STATE));
  if (!parsed || typeof parsed !== 'object') return empty;

  // Migrate legacy single-skip `skippedHourKey` records smoothly.
  let skipHourKey = typeof parsed.skipHourKey === 'string' ? parsed.skipHourKey : null;
  let skipsUsed = Number.isInteger(parsed.skipsUsed) && parsed.skipsUsed >= 0 ? parsed.skipsUsed : 0;
  if (!skipHourKey && typeof parsed.skippedHourKey === 'string') {
    skipHourKey = parsed.skippedHourKey;
    skipsUsed = Math.max(1, skipsUsed);
  }

  return {
    hourKey: typeof parsed.hourKey === 'string' ? parsed.hourKey : null,
    artwork: parsed.artwork && typeof parsed.artwork === 'object' ? parsed.artwork : null,
    skipHourKey,
    skipsUsed,
    recentIds: Array.isArray(parsed.recentIds)
      ? parsed.recentIds.filter((id) => typeof id === 'string').slice(-RECENT_HISTORY_LIMIT)
      : [],
  };
}

export function saveGalleryState(state, customStorage) {
  const store = resolveStorage(customStorage);
  const clean = {
    hourKey: state.hourKey || null,
    artwork: state.artwork || null,
    skipHourKey: state.skipHourKey || null,
    skipsUsed: Number.isInteger(state.skipsUsed) && state.skipsUsed >= 0 ? state.skipsUsed : 0,
    recentIds: Array.isArray(state.recentIds)
      ? Array.from(new Set(state.recentIds)).slice(-RECENT_HISTORY_LIMIT)
      : [],
  };
  if (store) {
    try {
      store.setItem(STORAGE_KEYS.STATE, JSON.stringify(clean));
    } catch {
      // Ignore quota errors gracefully.
    }
  }
  return clean;
}

/**
 * Returns how many skips have already been used in `hourKey`.
 */
export function getSkipsUsedInHour(state, hourKey) {
  if (!hourKey || !state || state.skipHourKey !== hourKey) return 0;
  return Math.max(0, Number(state.skipsUsed) || 0);
}

/**
 * Returns how many skips remain in `hourKey`.
 */
export function getSkipsRemainingInHour(state, hourKey, maxSkips = MAX_SKIPS_PER_HOUR) {
  return Math.max(0, maxSkips - getSkipsUsedInHour(state, hourKey));
}

/**
 * Returns true if the visitor still has at least one hourly skip available for `hourKey`.
 */
export function canSkipInHour(state, hourKey, maxSkips = MAX_SKIPS_PER_HOUR) {
  return Boolean(hourKey) && getSkipsRemainingInHour(state, hourKey, maxSkips) > 0;
}

/**
 * Records a newly displayed artwork into state (optionally incrementing hourly skips used).
 */
export function recordDisplayedArtwork(state, artwork, hourKey, { consumedSkip = false } = {}) {
  const nextRecent = [...(state.recentIds || [])];
  if (artwork?.uid) {
    const existingIdx = nextRecent.indexOf(artwork.uid);
    if (existingIdx !== -1) nextRecent.splice(existingIdx, 1);
    nextRecent.push(artwork.uid);
  }

  const prevUsed = getSkipsUsedInHour(state, hourKey);
  const nextUsed = consumedSkip ? prevUsed + 1 : prevUsed;
  const nextSkipHourKey = nextUsed > 0 ? hourKey : null;

  return {
    hourKey,
    artwork,
    skipHourKey: nextSkipHourKey,
    skipsUsed: nextUsed,
    recentIds: nextRecent.slice(-RECENT_HISTORY_LIMIT),
  };
}

/* ==========================================================================
   Lightweight Archive (Recently Viewed & Saved Bookmarks)
   ========================================================================== */

/**
 * Produces a compact, self-contained archive snapshot of an artwork for
 * localStorage (omitting heavy inline base64 LQIP payloads while retaining
 * full-resolution URLs, fast thumbnail URL, and all curatorial metadata).
 */
export function serializeArchiveArtwork(artwork, { hourLabel = '', seenAt = null, savedAt = null } = {}) {
  if (!artwork || typeof artwork !== 'object' || typeof artwork.uid !== 'string') return null;
  const imageUrls = Array.isArray(artwork.imageUrls)
    ? artwork.imageUrls.filter((u) => typeof u === 'string' && u.length > 0)
    : [];
  if (imageUrls.length === 0) return null;

  const thumbUrl =
    typeof artwork.thumbUrl === 'string' && artwork.thumbUrl.length > 0
      ? artwork.thumbUrl
      : imageUrls[imageUrls.length - 1];

  return {
    uid: artwork.uid,
    source: artwork.source || '',
    museumName: artwork.museumName || '',
    museumShort: artwork.museumShort || artwork.museumName || '',
    id: artwork.id ?? null,
    title: artwork.title || 'Untitled',
    artist: artwork.artist || '',
    artistShort: artwork.artistShort || artwork.artist || '',
    category: artwork.category || '',
    categoryLabel: artwork.categoryLabel || 'Fine Art',
    dateDisplay: artwork.dateDisplay || '',
    eraOrMovement: artwork.eraOrMovement || '',
    originOrCulture: artwork.originOrCulture || '',
    medium: artwork.medium || '',
    dimensions: artwork.dimensions || '',
    department: artwork.department || '',
    galleryLocation: artwork.galleryLocation || '',
    imageUrls,
    thumbUrl,
    lqip: '',
    altText: artwork.altText || artwork.title || 'Artwork',
    descriptionHtml: artwork.descriptionHtml || '',
    descriptionSource: artwork.descriptionSource || null,
    needsContextEnrichment: Boolean(artwork.needsContextEnrichment),
    objectWikidataUrl: artwork.objectWikidataUrl || '',
    artistWikidataUrl: artwork.artistWikidataUrl || '',
    creditLine: artwork.creditLine || '',
    tags: Array.isArray(artwork.tags) ? artwork.tags.slice(0, 6) : [],
    museumUrl: artwork.museumUrl || '',
    hourLabel: hourLabel || artwork.hourLabel || '',
    seenAt: typeof seenAt === 'number' ? seenAt : typeof artwork.seenAt === 'number' ? artwork.seenAt : null,
    savedAt: typeof savedAt === 'number' ? savedAt : typeof artwork.savedAt === 'number' ? artwork.savedAt : null,
  };
}

function sanitizeArchiveList(list, limit) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const clean = serializeArchiveArtwork(item);
    if (!clean || seen.has(clean.uid)) continue;
    seen.add(clean.uid);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

export function loadArchive(customStorage) {
  const store = resolveStorage(customStorage);
  if (!store) return { recent: [], bookmarks: [] };
  const parsed = safeParse(store.getItem(STORAGE_KEYS.ARCHIVE));
  if (!parsed || typeof parsed !== 'object') return { recent: [], bookmarks: [] };
  return {
    recent: sanitizeArchiveList(parsed.recent, RECENT_ARCHIVE_LIMIT),
    bookmarks: sanitizeArchiveList(parsed.bookmarks, BOOKMARKS_LIMIT),
  };
}

export function saveArchive(archive, customStorage) {
  const clean = {
    recent: sanitizeArchiveList(archive?.recent, RECENT_ARCHIVE_LIMIT),
    bookmarks: sanitizeArchiveList(archive?.bookmarks, BOOKMARKS_LIMIT),
  };
  const store = resolveStorage(customStorage);
  if (store) {
    try {
      store.setItem(STORAGE_KEYS.ARCHIVE, JSON.stringify(clean));
    } catch {
      // Ignore quota / private browsing write errors gracefully.
    }
  }
  return clean;
}

/**
 * Prepends a viewed artwork to the Recent log (deduplicated, capped at RECENT_ARCHIVE_LIMIT).
 */
export function recordRecentArtwork(archive, artwork, { hourLabel = '', seenAt = Date.now() } = {}) {
  const base = {
    recent: Array.isArray(archive?.recent) ? archive.recent : [],
    bookmarks: Array.isArray(archive?.bookmarks) ? archive.bookmarks : [],
  };
  const entry = serializeArchiveArtwork(artwork, { hourLabel, seenAt });
  if (!entry) return base;

  const filtered = base.recent.filter((item) => item.uid !== entry.uid);
  return {
    recent: [entry, ...filtered].slice(0, RECENT_ARCHIVE_LIMIT),
    bookmarks: base.bookmarks,
  };
}

/**
 * Updates cached historical context (e.g. after background Wikipedia enrichment)
 * inside both Recent and Saved lists if the artwork is present.
 */
export function updateArchivedArtworkContext(archive, enrichedArtwork) {
  if (!enrichedArtwork?.uid) return archive || { recent: [], bookmarks: [] };
  const patch = (item) =>
    item.uid === enrichedArtwork.uid
      ? {
          ...item,
          descriptionHtml: enrichedArtwork.descriptionHtml || item.descriptionHtml,
          descriptionSource: enrichedArtwork.descriptionSource || item.descriptionSource,
          needsContextEnrichment: false,
        }
      : item;

  return {
    recent: (archive?.recent || []).map(patch),
    bookmarks: (archive?.bookmarks || []).map(patch),
  };
}

export function isBookmarked(archive, uid) {
  if (!uid || !Array.isArray(archive?.bookmarks)) return false;
  return archive.bookmarks.some((item) => item.uid === uid);
}

/**
 * Toggles bookmark status for an artwork, returning the updated archive and
 * whether the piece is now saved (`true`) or removed (`false`).
 */
export function toggleBookmark(archive, artwork, { hourLabel = '', savedAt = Date.now() } = {}) {
  const base = {
    recent: Array.isArray(archive?.recent) ? archive.recent : [],
    bookmarks: Array.isArray(archive?.bookmarks) ? archive.bookmarks : [],
  };
  if (!artwork?.uid) return { archive: base, saved: false };

  if (isBookmarked(base, artwork.uid)) {
    return {
      archive: {
        recent: base.recent,
        bookmarks: base.bookmarks.filter((item) => item.uid !== artwork.uid),
      },
      saved: false,
    };
  }

  const entry = serializeArchiveArtwork(artwork, {
    hourLabel: hourLabel || artwork.hourLabel || '',
    savedAt,
  });
  if (!entry) return { archive: base, saved: false };

  return {
    archive: {
      recent: base.recent,
      bookmarks: [entry, ...base.bookmarks].slice(0, BOOKMARKS_LIMIT),
    },
    saved: true,
  };
}

