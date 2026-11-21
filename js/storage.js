/**
 * Client-side persistence for user settings, cached hourly artwork,
 * recent history deduplication, and the counted hourly skip budget.
 */

import {
  ART_CATEGORIES,
  DEFAULT_SETTINGS,
  FRAMING_MODES,
  MAX_SKIPS_PER_HOUR,
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

/**
 * Stable signature of the curatorial filter settings (museums, art types, highlights),
 * excluding visual framing preferences so Apply Filters only triggers on collection changes.
 */
export function getFilterSignature(settings) {
  const normalized = normalizeSettings(settings);
  return JSON.stringify({
    museums: getEnabledMuseums(normalized),
    categories: getEnabledCategories(normalized),
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
