/**
 * Client-side persistence for user settings, cached hourly artwork,
 * recent history deduplication, and the 1-skip-per-hour lock.
 */

import {
  ART_CATEGORIES,
  DEFAULT_SETTINGS,
  FRAMING_MODES,
  MUSEUMS,
  RECENT_HISTORY_LIMIT,
  STORAGE_KEYS,
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
 * Ensures loaded settings always have valid museums, categories (at least 1 each),
 * and a valid framing mode.
 */
export function normalizeSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  const framing = FRAMING_MODES.includes(src.framing) ? src.framing : DEFAULT_SETTINGS.framing;
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

  return { framing, highlightsOnly, museums, categories };
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

export function loadGalleryState(customStorage) {
  const store = resolveStorage(customStorage);
  const empty = {
    hourKey: null,
    artwork: null,
    skippedHourKey: null,
    recentIds: [],
  };
  if (!store) return empty;
  const parsed = safeParse(store.getItem(STORAGE_KEYS.STATE));
  if (!parsed || typeof parsed !== 'object') return empty;
  return {
    hourKey: typeof parsed.hourKey === 'string' ? parsed.hourKey : null,
    artwork: parsed.artwork && typeof parsed.artwork === 'object' ? parsed.artwork : null,
    skippedHourKey: typeof parsed.skippedHourKey === 'string' ? parsed.skippedHourKey : null,
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
    skippedHourKey: state.skippedHourKey || null,
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
 * Returns true if the visitor still has their 1 hourly skip available for `hourKey`.
 */
export function canSkipInHour(state, hourKey) {
  return Boolean(hourKey) && state.skippedHourKey !== hourKey;
}

/**
 * Records a newly displayed artwork into state (optionally consuming the hourly skip).
 */
export function recordDisplayedArtwork(state, artwork, hourKey, { consumedSkip = false } = {}) {
  const nextRecent = [...(state.recentIds || [])];
  if (artwork?.uid) {
    const existingIdx = nextRecent.indexOf(artwork.uid);
    if (existingIdx !== -1) nextRecent.splice(existingIdx, 1);
    nextRecent.push(artwork.uid);
  }
  return {
    hourKey,
    artwork,
    skippedHourKey: consumedSkip ? hourKey : state.skippedHourKey,
    recentIds: nextRecent.slice(-RECENT_HISTORY_LIMIT),
  };
}
