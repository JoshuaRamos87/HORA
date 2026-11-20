/**
 * Live museum API clients for:
 *  - Art Institute of Chicago (api.artic.edu/api/v1)
 *  - The Metropolitan Museum of Art (collectionapi.metmuseum.org/public/collection/v1.1 & /v1)
 *  - Optional Wikipedia / Wikidata context enrichment for Met works
 */

import {
  API_ENDPOINTS,
  ART_CATEGORIES,
  VERIFIED_FALLBACK_IDS,
} from './config.js';
import {
  classifyAicArtwork,
  classifyMetArtwork,
  normalizeAicArtwork,
  normalizeMetArtwork,
  textToSafeParagraphs,
} from './classify.js';
import { getEnabledCategories, getEnabledMuseums } from './storage.js';

const AIC_SEARCH_FIELDS = [
  'id',
  'title',
  'image_id',
  'artwork_type_title',
  'classification_title',
  'classification_titles',
  'department_title',
  'medium_display',
  'is_on_view',
  'description',
  'short_description',
].join(',');

const AIC_DETAIL_FIELDS = [
  'id',
  'title',
  'artist_display',
  'artist_title',
  'date_display',
  'place_of_origin',
  'style_title',
  'style_titles',
  'classification_title',
  'classification_titles',
  'artwork_type_title',
  'department_title',
  'medium_display',
  'dimensions',
  'gallery_title',
  'is_on_view',
  'image_id',
  'thumbnail',
  'description',
  'short_description',
  'credit_line',
  'term_titles',
  'is_public_domain',
].join(',');

const CATEGORY_BY_ID = new Map(ART_CATEGORIES.map((c) => [c.id, c]));

/**
 * Fetch JSON with an explicit timeout and no custom non-CORS-safelisted headers.
 */
async function fetchJson(url, { timeoutMs = 10000, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${url}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function pickRandom(list) {
  if (!list || list.length === 0) return undefined;
  return list[Math.floor(Math.random() * list.length)];
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Fetches a single authoritative AIC artwork record by ID.
 */
export async function fetchAicArtworkById(id, options = {}) {
  const url = `${API_ENDPOINTS.AIC_BASE}/artworks/${id}?fields=${AIC_DETAIL_FIELDS}`;
  const json = await fetchJson(url, options);
  return normalizeAicArtwork(json?.data, json?.config?.iiif_url);
}

/**
 * Fetches a random artwork from the Art Institute of Chicago matching the user's
 * enabled categories and highlight preference.
 */
export async function fetchRandomAicArtwork(settings, recentSet, options = {}) {
  const enabledCats = getEnabledCategories(settings);
  if (enabledCats.length === 0) return null;
  const enabledCatSet = new Set(enabledCats);

  // Always make up to 3 attempts even if only one category is enabled.
  const catSequence = [];
  const shuffled = shuffle(enabledCats);
  for (let i = 0; i < 3; i++) {
    catSequence.push(shuffled[i % shuffled.length]);
  }

  for (let attemptIdx = 0; attemptIdx < catSequence.length; attemptIdx++) {
    const cat = CATEGORY_BY_ID.get(catSequence[attemptIdx]);
    if (!cat) continue;

    const queryTerm = pickRandom(cat.aicQueries);
    const maxPage = settings.highlightsOnly ? 4 : 16;
    // Use page 1 on the final retry to guarantee strongest category matches.
    const page = attemptIdx === catSequence.length - 1 ? 1 : 1 + Math.floor(Math.random() * maxPage);

    const searchUrl =
      `${API_ENDPOINTS.AIC_BASE}/artworks/search` +
      `?q=${encodeURIComponent(queryTerm)}` +
      `&limit=50&page=${page}&fields=${AIC_SEARCH_FIELDS}`;

    let searchJson;
    try {
      searchJson = await fetchJson(searchUrl, options);
    } catch {
      continue;
    }

    const items = Array.isArray(searchJson?.data) ? searchJson.data : [];
    const matching = items.filter((item) => {
      if (!item || !item.id || !item.image_id) return false;
      if (recentSet.has(`aic:${item.id}`)) return false;
      return enabledCatSet.has(classifyAicArtwork(item));
    });

    if (matching.length === 0) continue;

    // When highlightsOnly is enabled, prefer works with curatorial wall labels or currently on view.
    let pool = matching;
    if (settings.highlightsOnly) {
      const rich = matching.filter((item) => item.description || item.short_description || item.is_on_view);
      if (rich.length > 0) pool = rich;
    }

    const candidates = shuffle(pool).slice(0, 4);
    for (const candidate of candidates) {
      try {
        const detailed = await fetchAicArtworkById(candidate.id, options);
        if (detailed && enabledCatSet.has(detailed.category)) {
          return detailed;
        }
      } catch {
        // Try next candidate
      }
    }
  }

  return null;
}

/**
 * Builds a Met v1.1 search URL, ensuring `q` is always the final parameter
 * (documented Met API quirk) and boolean flags use lowercase `true`.
 */
export function buildMetSearchUrl({ departmentId, medium, isHighlight, limit = 250, offset = 0, q }) {
  const params = [];
  params.push('hasImages=true');
  if (isHighlight) params.push('isHighlight=true');
  if (departmentId != null) params.push(`departmentId=${encodeURIComponent(departmentId)}`);
  if (medium) params.push(`medium=${encodeURIComponent(medium)}`);
  params.push(`limit=${Math.min(500, Math.max(1, limit))}`);
  if (offset > 0) params.push(`offset=${offset}`);
  // Keep `q` strictly last.
  params.push(`q=${encodeURIComponent(q)}`);
  return `${API_ENDPOINTS.MET_SEARCH_V1_1}?${params.join('&')}`;
}

/**
 * Fetches a single Met object record via /public/collection/v1/objects/{id}.
 * Note: Only /search moved to v1.1; object lookups remain on v1.
 */
export async function fetchMetArtworkById(objectId, options = {}) {
  const url = `${API_ENDPOINTS.MET_OBJECT_V1}/${objectId}`;
  const json = await fetchJson(url, options);
  return normalizeMetArtwork(json);
}

/**
 * Fetches a random artwork from The Metropolitan Museum of Art matching the user's
 * enabled categories and highlight preference.
 */
export async function fetchRandomMetArtwork(settings, recentSet, options = {}) {
  const enabledCats = getEnabledCategories(settings);
  if (enabledCats.length === 0) return null;
  const enabledCatSet = new Set(enabledCats);

  const catSequence = [];
  const shuffled = shuffle(enabledCats);
  for (let i = 0; i < 3; i++) {
    catSequence.push(shuffled[i % shuffled.length]);
  }

  for (const catId of catSequence) {
    const cat = CATEGORY_BY_ID.get(catId);
    if (!cat) continue;

    const departmentId = pickRandom(cat.metDepartments);
    const queryTerm = pickRandom(cat.metQueries);

    // Try with highlight filter first when requested, falling back cleanly if sparse.
    const attempts = settings.highlightsOnly
      ? [
          { departmentId, medium: cat.metMedium, isHighlight: true, q: queryTerm },
          { departmentId, medium: null, isHighlight: true, q: 'a' },
          { departmentId, medium: cat.metMedium, isHighlight: false, q: queryTerm },
        ]
      : [
          { departmentId, medium: cat.metMedium, isHighlight: false, q: queryTerm },
          { departmentId, medium: null, isHighlight: false, q: queryTerm },
        ];

    let objectIds = [];
    for (const attempt of attempts) {
      try {
        const searchUrl = buildMetSearchUrl({ ...attempt, limit: 250, offset: 0 });
        const json = await fetchJson(searchUrl, options);
        if (Array.isArray(json?.objectIDs) && json.objectIDs.length > 0) {
          objectIds = json.objectIDs;
          break;
        }
      } catch {
        // Try next search variant
      }
    }

    if (objectIds.length === 0) continue;

    // Sample candidate IDs, avoiding recently viewed items and handling occasional 404 / empty-image records.
    const freshIds = objectIds.filter((id) => !recentSet.has(`met:${id}`));
    const sample = shuffle(freshIds.length > 0 ? freshIds : objectIds).slice(0, 10);

    for (const objectId of sample) {
      try {
        const artwork = await fetchMetArtworkById(objectId, options);
        if (artwork && artwork.imageUrls.length > 0 && enabledCatSet.has(artwork.category)) {
          return artwork;
        }
      } catch {
        // Met search occasionally lists IDs that return 404 on /v1/objects/{id}; skip quietly.
      }
    }
  }

  return null;
}

/**
 * Selects and fetches the next artwork across enabled museums, alternating gently
 * away from the previously shown museum when both are enabled.
 */
export async function fetchNextArtwork(settings, recentIds = [], lastSource = null, options = {}) {
  const recentSet = new Set(recentIds);
  const enabledMuseums = getEnabledMuseums(settings);

  // Order enabled museums: gently prefer the other museum for natural variety.
  let museumOrder = shuffle(enabledMuseums);
  if (museumOrder.length > 1 && lastSource && museumOrder[0] === lastSource && Math.random() < 0.72) {
    museumOrder = [museumOrder[1], museumOrder[0]];
  }

  for (const museumId of museumOrder) {
    try {
      const result =
        museumId === 'aic'
          ? await fetchRandomAicArtwork(settings, recentSet, options)
          : await fetchRandomMetArtwork(settings, recentSet, options);
      if (result) return result;
    } catch {
      // Fall through to next museum
    }
  }

  // Last-resort verified fallback IDs (respecting enabled museums & categories when possible).
  const enabledCatSet = new Set(getEnabledCategories(settings));
  for (const museumId of museumOrder) {
    const candidates = shuffle(VERIFIED_FALLBACK_IDS[museumId] || []);
    const preferred = candidates.filter((c) => enabledCatSet.has(c.category));
    const pool = preferred.length > 0 ? preferred : candidates;
    for (const entry of pool) {
      try {
        const artwork =
          museumId === 'aic'
            ? await fetchAicArtworkById(entry.id, options)
            : await fetchMetArtworkById(entry.id, options);
        if (artwork) return artwork;
      } catch {
        // Continue fallback chain
      }
    }
  }

  throw new Error('Could not reach the museum collections right now. Please try again in a moment.');
}

/**
 * Extracts a Wikidata entity ID (e.g. "Q18915137") from a Wikidata URL.
 */
export function extractWikidataId(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/(Q\d+)(?:[/?#]|$)/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Asynchronously enriches a Met artwork with a concise historical summary from
 * Wikidata + Wikipedia's public REST API. Fails quietly when unavailable.
 */
export async function enrichArtworkContext(artwork, options = {}) {
  if (!artwork || !artwork.needsContextEnrichment || artwork.descriptionHtml) {
    return null;
  }

  const targets = [
    { qid: extractWikidataId(artwork.objectWikidataUrl), scope: 'artwork' },
    { qid: extractWikidataId(artwork.artistWikidataUrl), scope: 'artist' },
  ].filter((t) => Boolean(t.qid));

  for (const target of targets) {
    try {
      const wdUrl =
        `${API_ENDPOINTS.WIKIDATA_API}?action=wbgetentities` +
        `&ids=${encodeURIComponent(target.qid)}` +
        `&props=sitelinks|descriptions&languages=en&format=json&origin=*`;

      const wdJson = await fetchJson(wdUrl, { ...options, timeoutMs: 6500 });
      const entity = wdJson?.entities?.[target.qid];
      const wikiTitle = entity?.sitelinks?.enwiki?.title;

      if (wikiTitle) {
        const wikiUrl = `${API_ENDPOINTS.WIKIPEDIA_SUMMARY}/${encodeURIComponent(wikiTitle.replace(/ /g, '_'))}`;
        const summary = await fetchJson(wikiUrl, { ...options, timeoutMs: 6500 });
        const extract = typeof summary?.extract === 'string' ? summary.extract.trim() : '';

        if (extract && extract.length > 40) {
          return {
            descriptionHtml: textToSafeParagraphs(extract),
            descriptionSource: {
              label: target.scope === 'artwork' ? 'Historical Context · Wikipedia' : 'About the Artist · Wikipedia',
              url: summary?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`,
            },
          };
        }
      }
    } catch {
      // Optional enrichment should never interrupt the main gallery.
    }
  }

  return null;
}
