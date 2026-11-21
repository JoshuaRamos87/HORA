/**
 * Live museum API clients for:
 *  - Art Institute of Chicago (api.artic.edu/api/v1) with session pool caching,
 *    multi-ID batch detail fetches (?ids=), era date/style filtering, and HTTP 429 routing
 *  - The Metropolitan Museum of Art (collectionapi.metmuseum.org/public/collection/v1.1 & /v1)
 *    with session objectID pool caching and department + dateBegin/dateEnd era filtering
 *  - Optional Wikipedia / Wikidata context enrichment for Met works
 */

import {
  AIC_RATE_LIMIT_COOLDOWN_MS,
  API_ENDPOINTS,
  ART_CATEGORIES,
  ART_ERAS,
  VERIFIED_FALLBACK_IDS,
} from './config.js';
import {
  classifyAicArtwork,
  classifyMetArtwork,
  matchesAnyAicEra,
  matchesAnyMetEra,
  normalizeAicArtwork,
  normalizeMetArtwork,
  textToSafeParagraphs,
} from './classify.js';
import {
  getEnabledCategories,
  getEnabledEras,
  getEnabledMuseums,
  isAllErasEnabled,
} from './storage.js';

const AIC_SEARCH_FIELDS = [
  'id',
  'title',
  'image_id',
  'artwork_type_title',
  'classification_title',
  'classification_titles',
  'department_title',
  'medium_display',
  'date_start',
  'date_end',
  'style_title',
  'style_titles',
  'place_of_origin',
  'artist_display',
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
  'date_start',
  'date_end',
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

const AIC_BATCH_SIZE = 10;
const CATEGORY_BY_ID = new Map(ART_CATEGORIES.map((c) => [c.id, c]));
const ERA_BY_ID = new Map(ART_ERAS.map((e) => [e.id, e]));

// In-memory session caches to minimize API calls during skips & filter previews.
const aicPoolCache = new Map(); // key `${catId}:${eraKey}:${highlightsOnly}` -> Artwork[]
const metIdPoolCache = new Map(); // key `${catId}:${eraKey}:${highlightsOnly}` -> number[]
let aicCooldownUntil = 0;

/**
 * Clears in-memory API caches and rate-limit cooldown state (helpful in tests).
 */
export function clearApiCaches() {
  aicPoolCache.clear();
  metIdPoolCache.clear();
  aicCooldownUntil = 0;
}

export function isAicCoolingDown(now = Date.now()) {
  return now < aicCooldownUntil;
}

function noteAicError(err, now = Date.now()) {
  if (err?.status === 429) {
    aicCooldownUntil = now + AIC_RATE_LIMIT_COOLDOWN_MS;
  }
}

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

function poolKey(catId, eraKey, highlightsOnly) {
  return `${catId}:${eraKey}:${highlightsOnly ? 'hi' : 'all'}`;
}

/**
 * Builds an Art Institute of Chicago search URL, optionally applying an
 * Elasticsearch `date_start` range filter when a specific art-history era is active.
 */
export function buildAicSearchUrl({ queryTerm, page = 1, limit = 50, era = null }) {
  const params = [
    `q=${encodeURIComponent(queryTerm)}`,
    `limit=${Math.min(100, Math.max(1, limit))}`,
    `page=${Math.max(1, page)}`,
    `fields=${AIC_SEARCH_FIELDS}`,
  ];
  if (era && typeof era.dateBegin === 'number' && typeof era.dateEnd === 'number') {
    params.push(`query[range][date_start][gte]=${era.dateBegin}`);
    params.push(`query[range][date_start][lte]=${era.dateEnd}`);
  }
  return `${API_ENDPOINTS.AIC_BASE}/artworks/search?${params.join('&')}`;
}

/**
 * Fetches a single authoritative AIC artwork record by ID.
 */
export async function fetchAicArtworkById(id, options = {}) {
  const url = `${API_ENDPOINTS.AIC_BASE}/artworks/${id}?fields=${AIC_DETAIL_FIELDS}`;
  try {
    const json = await fetchJson(url, options);
    return normalizeAicArtwork(json?.data, json?.config?.iiif_url);
  } catch (err) {
    noteAicError(err);
    throw err;
  }
}

/**
 * Batch-fetches multiple authoritative AIC artwork records in a single request
 * using AIC's official `?ids=` multi-ID parameter, returning raw + normalized pairs
 * so era rules can be verified against authoritative detail fields.
 */
export async function fetchAicArtworksByIds(ids, options = {}) {
  const cleanIds = Array.from(new Set(ids.filter(Boolean))).slice(0, AIC_BATCH_SIZE);
  if (cleanIds.length === 0) return [];
  const url = `${API_ENDPOINTS.AIC_BASE}/artworks?ids=${cleanIds.join(',')}&fields=${AIC_DETAIL_FIELDS}`;
  try {
    const json = await fetchJson(url, options);
    const iiifBase = json?.config?.iiif_url;
    const rows = Array.isArray(json?.data) ? json.data : [];
    return rows
      .map((raw) => ({ raw, artwork: normalizeAicArtwork(raw, iiifBase) }))
      .filter((entry) => Boolean(entry.artwork));
  } catch (err) {
    noteAicError(err);
    throw err;
  }
}

/**
 * Pops a cached, unseen AIC artwork matching any enabled category and active era (0 API calls).
 */
function popCachedAicArtwork(enabledCats, eraKeys, highlightsOnly, recentSet) {
  const enabledSet = new Set(enabledCats);
  const pairs = [];
  for (const catId of enabledCats) {
    for (const eraKey of eraKeys) {
      pairs.push([catId, eraKey]);
    }
  }

  for (const [catId, eraKey] of shuffle(pairs)) {
    const key = poolKey(catId, eraKey, highlightsOnly);
    const bucket = aicPoolCache.get(key);
    if (!bucket || bucket.length === 0) continue;

    while (bucket.length > 0) {
      const candidate = bucket.pop();
      if (candidate && !recentSet.has(candidate.uid) && enabledSet.has(candidate.category)) {
        return candidate;
      }
    }
    aicPoolCache.delete(key);
  }
  return null;
}

const AIC_CATEGORY_HINTS = {
  paintings: 'painting',
  'works-on-paper': 'print drawing',
  photography: 'photograph',
  sculpture: 'sculpture',
  decorative: 'decorative textile ceramic',
  artifacts: 'artifact',
};

/**
 * Fetches a random artwork from the Art Institute of Chicago matching the user's
 * enabled categories, art-history eras, and highlight preference.
 */
export async function fetchRandomAicArtwork(settings, recentSet, options = {}) {
  const enabledCats = getEnabledCategories(settings);
  if (enabledCats.length === 0) return null;
  const enabledCatSet = new Set(enabledCats);

  const allEras = isAllErasEnabled(settings);
  const enabledEraIds = getEnabledEras(settings);
  const selectedEras = allEras ? [] : enabledEraIds.map((id) => ERA_BY_ID.get(id)).filter(Boolean);
  const cacheEraKeys = allEras ? ['any'] : enabledEraIds;

  // 1. Serve instantly from our pre-batched session cache if available (0 network calls).
  const cached = popCachedAicArtwork(enabledCats, cacheEraKeys, settings.highlightsOnly, recentSet);
  if (cached) return cached;

  // 2. Build up to 4 (category, era) search attempts.
  const combos = [];
  if (allEras) {
    const shuffledCats = shuffle(enabledCats);
    for (let i = 0; i < 3; i++) {
      combos.push({ catId: shuffledCats[i % shuffledCats.length], era: null });
    }
  } else {
    const allPairs = [];
    for (const era of selectedEras) {
      for (const catId of enabledCats) {
        // Skip impossible pre-photography era + photography-only pairings
        if (catId === 'photography' && era.dateEnd < 1825) continue;
        allPairs.push({ catId, era });
      }
    }
    if (allPairs.length === 0) return null;
    const shuffledPairs = shuffle(allPairs);
    const totalAttempts = Math.min(4, Math.max(3, shuffledPairs.length));
    for (let i = 0; i < totalAttempts; i++) {
      combos.push(shuffledPairs[i % shuffledPairs.length]);
    }
  }

  for (let attemptIdx = 0; attemptIdx < combos.length; attemptIdx++) {
    if (isAicCoolingDown()) return null;

    const { catId, era } = combos[attemptIdx];
    const cat = CATEGORY_BY_ID.get(catId);
    if (!cat) continue;

    const eraKey = era ? era.id : 'any';
    const isFinalAttempt = attemptIdx === combos.length - 1;
    const maxPage = era ? (settings.highlightsOnly ? 3 : 6) : settings.highlightsOnly ? 4 : 16;
    const page = isFinalAttempt ? 1 : 1 + Math.floor(Math.random() * maxPage);

    const queryTerm = era
      ? `${pickRandom(era.aicQueries)} ${AIC_CATEGORY_HINTS[catId] || ''}`.trim()
      : pickRandom(cat.aicQueries);

    // When era filtering is active, try Elasticsearch date range first; fall back to keyword-only if sparse.
    const searchCandidates = era
      ? [
          buildAicSearchUrl({ queryTerm, page, limit: 50, era }),
          buildAicSearchUrl({ queryTerm: pickRandom(era.aicQueries), page: 1, limit: 50, era }),
          buildAicSearchUrl({ queryTerm, page: 1, limit: 50, era: null }),
        ]
      : [buildAicSearchUrl({ queryTerm, page, limit: 50, era: null })];

    let matching = [];
    for (const searchUrl of searchCandidates) {
      let searchJson;
      try {
        searchJson = await fetchJson(searchUrl, options);
      } catch (err) {
        noteAicError(err);
        if (isAicCoolingDown()) return null;
        continue;
      }

      const items = Array.isArray(searchJson?.data) ? searchJson.data : [];
      matching = items.filter((item) => {
        if (!item || !item.id || !item.image_id) return false;
        if (recentSet.has(`aic:${item.id}`)) return false;
        if (!enabledCatSet.has(classifyAicArtwork(item))) return false;
        if (selectedEras.length > 0 && !matchesAnyAicEra(item, selectedEras)) return false;
        return true;
      });

      if (matching.length > 0) break;
    }

    if (matching.length === 0) continue;

    let pool = matching;
    if (settings.highlightsOnly) {
      const rich = matching.filter((item) => item.description || item.short_description || item.is_on_view);
      if (rich.length > 0) pool = rich;
    }

    const batchIds = shuffle(pool).slice(0, AIC_BATCH_SIZE).map((item) => item.id);

    // Batch-fetch up to 10 full records in a single API call.
    let detailedEntries = [];
    try {
      detailedEntries = await fetchAicArtworksByIds(batchIds, options);
    } catch {
      if (isAicCoolingDown()) return null;
      for (const id of batchIds.slice(0, 3)) {
        try {
          const url = `${API_ENDPOINTS.AIC_BASE}/artworks/${id}?fields=${AIC_DETAIL_FIELDS}`;
          const json = await fetchJson(url, options);
          const work = normalizeAicArtwork(json?.data, json?.config?.iiif_url);
          if (work) detailedEntries.push({ raw: json.data, artwork: work });
          if (detailedEntries.length > 0) break;
        } catch (err) {
          noteAicError(err);
          if (isAicCoolingDown()) return null;
        }
      }
    }

    const validWorks = shuffle(
      detailedEntries
        .filter(({ raw, artwork }) => {
          if (!artwork || recentSet.has(artwork.uid)) return false;
          if (!enabledCatSet.has(artwork.category)) return false;
          if (selectedEras.length > 0 && !matchesAnyAicEra(raw, selectedEras)) return false;
          return true;
        })
        .map(({ artwork }) => artwork)
    );

    if (validWorks.length === 0) continue;

    const chosen = validWorks.pop();

    // Store remaining works into their category+era caches for future skips / filter tests.
    for (const extra of validWorks) {
      const k = poolKey(extra.category, eraKey, settings.highlightsOnly);
      const list = aicPoolCache.get(k) || [];
      if (!list.some((w) => w.uid === extra.uid)) {
        list.push(extra);
        aicPoolCache.set(k, list);
      }
    }

    return chosen;
  }

  return null;
}

/**
 * Builds a Met v1.1 search URL, ensuring `q` is always the final parameter
 * (documented Met API quirk) and boolean flags use lowercase `true`.
 * Supports optional integer `dateBegin` & `dateEnd` (negative = BCE).
 */
export function buildMetSearchUrl({
  departmentId,
  medium,
  isHighlight,
  dateBegin,
  dateEnd,
  limit = 250,
  offset = 0,
  q,
}) {
  const params = [];
  params.push('hasImages=true');
  if (isHighlight) params.push('isHighlight=true');
  if (departmentId != null) params.push(`departmentId=${encodeURIComponent(departmentId)}`);
  if (medium) params.push(`medium=${encodeURIComponent(medium)}`);
  if (typeof dateBegin === 'number' && typeof dateEnd === 'number') {
    params.push(`dateBegin=${Math.trunc(dateBegin)}`);
    params.push(`dateEnd=${Math.trunc(dateEnd)}`);
  }
  params.push(`limit=${Math.min(500, Math.max(1, limit))}`);
  if (offset > 0) params.push(`offset=${offset}`);
  // Keep `q` strictly last.
  params.push(`q=${encodeURIComponent(q)}`);
  return `${API_ENDPOINTS.MET_SEARCH_V1_1}?${params.join('&')}`;
}

async function fetchMetRawById(objectId, options = {}) {
  const url = `${API_ENDPOINTS.MET_OBJECT_V1}/${objectId}`;
  return fetchJson(url, options);
}

/**
 * Fetches a single Met object record via /public/collection/v1/objects/{id}.
 * Note: Only /search moved to v1.1; object lookups remain on v1.
 */
export async function fetchMetArtworkById(objectId, options = {}) {
  const raw = await fetchMetRawById(objectId, options);
  return normalizeMetArtwork(raw);
}

/**
 * Fetches a random artwork from The Metropolitan Museum of Art matching the user's
 * enabled categories, art-history eras, and highlight preference.
 */
export async function fetchRandomMetArtwork(settings, recentSet, options = {}) {
  const enabledCats = getEnabledCategories(settings);
  if (enabledCats.length === 0) return null;
  const enabledCatSet = new Set(enabledCats);

  const allEras = isAllErasEnabled(settings);
  const enabledEraIds = getEnabledEras(settings);
  const selectedEras = allEras ? [] : enabledEraIds.map((id) => ERA_BY_ID.get(id)).filter(Boolean);

  // Build valid (category, era, matchingDepartments) attempts.
  const combos = [];
  if (allEras) {
    const shuffledCats = shuffle(enabledCats);
    for (let i = 0; i < 3; i++) {
      const catId = shuffledCats[i % shuffledCats.length];
      const cat = CATEGORY_BY_ID.get(catId);
      if (cat) combos.push({ catId, cat, era: null, departments: cat.metDepartments });
    }
  } else {
    const validPairs = [];
    for (const era of selectedEras) {
      const eraDeptSet = new Set(era.metDepartments);
      for (const catId of enabledCats) {
        const cat = CATEGORY_BY_ID.get(catId);
        if (!cat) continue;
        const intersection = cat.metDepartments.filter((d) => eraDeptSet.has(d));
        if (intersection.length > 0) {
          validPairs.push({ catId, cat, era, departments: intersection });
        }
      }
    }
    if (validPairs.length === 0) return null;
    const shuffledPairs = shuffle(validPairs);
    const totalAttempts = Math.min(4, Math.max(3, shuffledPairs.length));
    for (let i = 0; i < totalAttempts; i++) {
      combos.push(shuffledPairs[i % shuffledPairs.length]);
    }
  }

  for (const { catId, cat, era, departments } of combos) {
    const eraKey = era ? era.id : 'any';
    const key = poolKey(catId, eraKey, settings.highlightsOnly);
    let cachedIds = metIdPoolCache.get(key) || [];
    cachedIds = cachedIds.filter((id) => !recentSet.has(`met:${id}`));

    // Refill the cached ID pool only when depleted, avoiding redundant /v1.1/search calls.
    if (cachedIds.length < 6) {
      const departmentId = pickRandom(departments);
      const queryTerm = era ? pickRandom(era.metQueries) : pickRandom(cat.metQueries);
      const fallbackQuery = era?.metFallbackQuery || '*';
      const dateParams = era ? { dateBegin: era.dateBegin, dateEnd: era.dateEnd } : {};

      const attempts = settings.highlightsOnly
        ? [
            { departmentId, medium: cat.metMedium, isHighlight: true, ...dateParams, q: queryTerm },
            { departmentId, medium: null, isHighlight: true, ...dateParams, q: fallbackQuery },
            { departmentId, medium: cat.metMedium, isHighlight: false, ...dateParams, q: queryTerm },
            ...(era ? [{ departmentId, medium: null, isHighlight: false, ...dateParams, q: fallbackQuery }] : []),
          ]
        : [
            { departmentId, medium: cat.metMedium, isHighlight: false, ...dateParams, q: queryTerm },
            { departmentId, medium: null, isHighlight: false, ...dateParams, q: era ? fallbackQuery : queryTerm },
          ];

      for (const attempt of attempts) {
        try {
          const searchUrl = buildMetSearchUrl({ ...attempt, limit: 250, offset: 0 });
          const json = await fetchJson(searchUrl, options);
          if (Array.isArray(json?.objectIDs) && json.objectIDs.length > 0) {
            const fresh = json.objectIDs.filter((id) => !recentSet.has(`met:${id}`));
            const merged = Array.from(new Set([...cachedIds, ...(fresh.length > 0 ? fresh : json.objectIDs)]));
            cachedIds = shuffle(merged);
            metIdPoolCache.set(key, cachedIds);
            break;
          }
        } catch {
          // Try next search variant
        }
      }
    }

    if (cachedIds.length === 0) continue;

    // Probe up to 12 IDs, popping each tried ID so bad/404/mismatched IDs are never retried.
    const maxProbes = Math.min(12, cachedIds.length);
    for (let p = 0; p < maxProbes; p++) {
      const objectId = cachedIds.pop();
      metIdPoolCache.set(key, cachedIds);
      if (objectId == null || recentSet.has(`met:${objectId}`)) continue;

      try {
        const raw = await fetchMetRawById(objectId, options);
        const artwork = normalizeMetArtwork(raw);
        if (!artwork || artwork.imageUrls.length === 0) continue;
        if (!enabledCatSet.has(artwork.category)) continue;
        if (selectedEras.length > 0 && !matchesAnyMetEra(raw, selectedEras)) continue;
        return artwork;
      } catch {
        // Met search occasionally lists IDs that return 404 on /v1/objects/{id}; skip quietly.
      }
    }
  }

  return null;
}

/**
 * Selects and fetches the next artwork across enabled museums, alternating gently
 * away from the previously shown museum when both are enabled and routing around
 * AIC temporarily if AIC is in HTTP 429 cooldown.
 */
export async function fetchNextArtwork(settings, recentIds = [], lastSource = null, options = {}) {
  const recentSet = new Set(recentIds);
  const enabledMuseums = getEnabledMuseums(settings);
  const allEras = isAllErasEnabled(settings);
  const enabledEraSet = new Set(getEnabledEras(settings));

  let museumOrder = shuffle(enabledMuseums);
  if (museumOrder.length > 1) {
    if (isAicCoolingDown()) {
      museumOrder = ['met', 'aic'];
    } else if (lastSource && museumOrder[0] === lastSource && Math.random() < 0.72) {
      museumOrder = [museumOrder[1], museumOrder[0]];
    }
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

  // Last-resort verified fallback IDs: strictly honor active eras & categories when era-filtering is on.
  const enabledCatSet = new Set(getEnabledCategories(settings));
  for (const museumId of museumOrder) {
    if (museumId === 'aic' && isAicCoolingDown()) continue;
    const candidates = shuffle(VERIFIED_FALLBACK_IDS[museumId] || []);
    const matching = candidates.filter((c) => {
      if (!enabledCatSet.has(c.category)) return false;
      if (!allEras && (!c.era || !enabledEraSet.has(c.era))) return false;
      return true;
    });

    const pool = allEras && matching.length === 0 ? candidates : matching;
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

  if (!allEras) {
    throw new Error(
      'No artworks matched that exact combination of era and art type. Try enabling another art type or era.'
    );
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
