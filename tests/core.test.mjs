import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_SKIPS_PER_HOUR, STORAGE_KEYS } from '../js/config.js';
import {
  formatCountdown,
  getCurrentHourKey,
  getMsUntilNextHour,
  getNextHourDate,
} from '../js/clock.js';
import {
  canSkipInHour,
  getFilterSignature,
  getSkipsRemainingInHour,
  getSkipsUsedInHour,
  loadGalleryState,
  loadSettings,
  normalizeSettings,
  recordDisplayedArtwork,
  saveGalleryState,
  saveSettings,
} from '../js/storage.js';
import {
  buildAicImageUrls,
  classifyAicArtwork,
  classifyMetArtwork,
  normalizeAicArtwork,
  normalizeMetArtwork,
  sanitizeArtHtml,
} from '../js/classify.js';
import {
  buildMetSearchUrl,
  clearApiCaches,
  enrichArtworkContext,
  extractWikidataId,
  fetchNextArtwork,
  isAicCoolingDown,
} from '../js/api.js';
import {
  clampPan,
  clampZoom,
  computeFocalZoomPan,
  computePinchTransform,
  MAX_ZOOM,
  MIN_ZOOM,
} from '../js/zoom.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('clock utilities compute stable local hour keys and exact :00 rollover', () => {
  const d1 = new Date(2026, 10, 20, 15, 0, 0, 0);
  const d2 = new Date(2026, 10, 20, 15, 59, 59, 999);
  const d3 = new Date(2026, 10, 20, 16, 0, 0, 0);

  assert.equal(getCurrentHourKey(d1), '2026-11-20T15');
  assert.equal(getCurrentHourKey(d2), '2026-11-20T15');
  assert.equal(getCurrentHourKey(d3), '2026-11-20T16');

  const next = getNextHourDate(new Date(2026, 10, 20, 15, 42, 30, 0));
  assert.equal(next.getHours(), 16);
  assert.equal(next.getMinutes(), 0);
  assert.equal(next.getSeconds(), 0);

  const ms = getMsUntilNextHour(new Date(2026, 10, 20, 15, 59, 0, 0));
  assert.ok(ms >= 60_000 && ms <= 60_500);

  assert.equal(formatCountdown(45_000), '45s');
  assert.equal(formatCountdown(12 * 60_000), '12m');
});

test('storage enforces valid settings, filter signatures, 5 skips/hr, and legacy migration', () => {
  const store = createMemoryStorage();

  const sanitized = normalizeSettings({
    framing: 'invalid',
    museums: { aic: false, met: false },
    categories: {
      paintings: false,
      'works-on-paper': false,
      photography: false,
      sculpture: false,
      decorative: false,
      artifacts: false,
    },
  });
  assert.equal(sanitized.framing, 'ambient');
  assert.equal(sanitized.museums.aic, true);
  assert.equal(sanitized.museums.met, true);
  assert.equal(sanitized.categories.paintings, true);

  // Filter signature ignores framing changes but catches curatorial filter changes
  const sigAmbient = getFilterSignature({ ...sanitized, framing: 'ambient' });
  const sigMatte = getFilterSignature({ ...sanitized, framing: 'matte' });
  const sigOnlyAic = getFilterSignature({ ...sanitized, museums: { aic: true, met: false } });
  assert.equal(sigAmbient, sigMatte);
  assert.notEqual(sigAmbient, sigOnlyAic);

  saveSettings({ ...sanitized, framing: 'matte', highlightsOnly: false }, store);
  const loadedSettings = loadSettings(store);
  assert.equal(loadedSettings.framing, 'matte');
  assert.equal(loadedSettings.highlightsOnly, false);

  // Counted 5 skips per hour lifecycle
  assert.equal(MAX_SKIPS_PER_HOUR, 5);
  let state = loadGalleryState(store);
  assert.equal(getSkipsRemainingInHour(state, '2026-11-20T15'), 5);

  // Initial hourly artwork does not consume a skip
  state = recordDisplayedArtwork(
    state,
    { uid: 'aic:16568', title: 'Water Lilies' },
    '2026-11-20T15',
    { consumedSkip: false }
  );
  assert.equal(getSkipsUsedInHour(state, '2026-11-20T15'), 0);

  // Use 4 skips
  for (let i = 1; i <= 4; i++) {
    state = recordDisplayedArtwork(
      state,
      { uid: `met:${436520 + i}`, title: `Work ${i}` },
      '2026-11-20T15',
      { consumedSkip: true }
    );
  }
  assert.equal(getSkipsUsedInHour(state, '2026-11-20T15'), 4);
  assert.equal(getSkipsRemainingInHour(state, '2026-11-20T15'), 1);
  assert.equal(canSkipInHour(state, '2026-11-20T15'), true);

  // Filter preview does NOT consume the remaining skip
  state = recordDisplayedArtwork(
    state,
    { uid: 'aic:27992', title: 'La Grande Jatte' },
    '2026-11-20T15',
    { consumedSkip: false }
  );
  assert.equal(getSkipsRemainingInHour(state, '2026-11-20T15'), 1);

  // Consume 5th and final skip
  state = recordDisplayedArtwork(
    state,
    { uid: 'aic:28560', title: 'The Bedroom' },
    '2026-11-20T15',
    { consumedSkip: true }
  );
  saveGalleryState(state, store);

  const reloaded = loadGalleryState(store);
  assert.equal(getSkipsRemainingInHour(reloaded, '2026-11-20T15'), 0);
  assert.equal(canSkipInHour(reloaded, '2026-11-20T15'), false);

  // Resets cleanly back to 5 on the next clock hour
  assert.equal(getSkipsRemainingInHour(reloaded, '2026-11-20T16'), 5);
  assert.equal(canSkipInHour(reloaded, '2026-11-20T16'), true);

  // Legacy single-skip state migrates cleanly to 1 used skip (4 remaining)
  const legacyStore = createMemoryStorage();
  legacyStore.setItem(
    STORAGE_KEYS.STATE,
    JSON.stringify({
      hourKey: '2026-11-20T15',
      artwork: { uid: 'aic:16568' },
      skippedHourKey: '2026-11-20T15',
      recentIds: ['aic:16568'],
    })
  );
  const migrated = loadGalleryState(legacyStore);
  assert.equal(getSkipsUsedInHour(migrated, '2026-11-20T15'), 1);
  assert.equal(getSkipsRemainingInHour(migrated, '2026-11-20T15'), 4);
});

test('artwork classification and normalization handle both AIC and Met records', () => {
  assert.equal(classifyAicArtwork({ artwork_type_title: 'Painting' }), 'paintings');
  assert.equal(classifyAicArtwork({ artwork_type_title: 'Photograph' }), 'photography');
  assert.equal(classifyAicArtwork({ artwork_type_title: 'Print' }), 'works-on-paper');
  assert.equal(classifyAicArtwork({ artwork_type_title: 'Sculpture' }), 'sculpture');
  assert.equal(classifyAicArtwork({ artwork_type_title: 'Textile' }), 'decorative');
  assert.equal(classifyAicArtwork({ department_title: 'Arts of the Ancient Mediterranean' }), 'artifacts');

  assert.equal(classifyMetArtwork({ department: 'European Paintings', classification: 'Paintings' }), 'paintings');
  assert.equal(classifyMetArtwork({ department: 'Photographs', objectName: 'Photograph' }), 'photography');
  assert.equal(classifyMetArtwork({ department: 'Drawings and Prints', classification: 'Prints' }), 'works-on-paper');
  assert.equal(classifyMetArtwork({ department: 'European Sculpture and Decorative Arts', classification: 'Sculpture' }), 'sculpture');
  assert.equal(classifyMetArtwork({ department: 'The Costume Institute', objectName: 'Dress' }), 'decorative');
  assert.equal(classifyMetArtwork({ department: 'Egyptian Art', objectName: 'Temple' }), 'artifacts');

  const aicNormalized = normalizeAicArtwork(
    {
      id: 16568,
      title: 'Water Lilies',
      artist_display: 'Claude Monet\nFrench, 1840–1926',
      artist_title: 'Claude Monet',
      date_display: '1906',
      place_of_origin: 'France',
      style_title: 'Impressionism',
      artwork_type_title: 'Painting',
      department_title: 'Painting and Sculpture of Europe',
      medium_display: 'Oil on canvas',
      is_on_view: true,
      gallery_title: 'Gallery 243',
      image_id: 'abc-123',
      description: '<p>Monet painted <em>Water Lilies</em> at Giverny.<script>alert(1)</script></p>',
    },
    'https://www.artic.edu/iiif/2'
  );

  assert.equal(aicNormalized.uid, 'aic:16568');
  assert.equal(aicNormalized.category, 'paintings');
  assert.equal(aicNormalized.galleryLocation, 'On view · Gallery 243');
  assert.deepEqual(aicNormalized.imageUrls, [
    'https://www.artic.edu/iiif/2/abc-123/full/1686,/0/default.jpg',
    'https://www.artic.edu/iiif/2/abc-123/full/843,/0/default.jpg',
    'https://www.artic.edu/iiif/2/abc-123/full/600,/0/default.jpg',
  ]);
  assert.equal(aicNormalized.descriptionHtml, '<p>Monet painted <em>Water Lilies</em> at Giverny.</p>');

  const metNormalized = normalizeMetArtwork({
    objectID: 436524,
    title: 'Sunflowers',
    artistDisplayName: 'Vincent van Gogh',
    artistDisplayBio: 'Dutch, Zundert 1853–1890 Auvers-sur-Oise',
    objectDate: '1887',
    department: 'European Paintings',
    classification: 'Paintings',
    medium: 'Oil on canvas',
    GalleryNumber: '825',
    primaryImage: 'https://images.metmuseum.org/original.jpg',
    primaryImageSmall: 'https://images.metmuseum.org/small.jpg',
    objectWikidata_URL: 'https://www.wikidata.org/wiki/Q18915137',
    tags: [{ term: 'Sunflowers' }, { term: 'Flowers' }],
  });

  assert.equal(metNormalized.uid, 'met:436524');
  assert.equal(metNormalized.category, 'paintings');
  assert.equal(metNormalized.needsContextEnrichment, true);
  assert.equal(metNormalized.galleryLocation, 'On view · Gallery 825');
  assert.deepEqual(metNormalized.tags, ['Sunflowers', 'Flowers']);
  assert.equal(normalizeMetArtwork({ objectID: 999, primaryImage: '', primaryImageSmall: '' }), null);
});

test('HTML sanitizer strips scripts and dangerous attributes while preserving emphasis', () => {
  const dirty = '<p onclick="evil()">Hello <em style="color:red">Art</em> <a href="javascript:alert(1)">Link</a><script>bad()</script></p>';
  const clean = sanitizeArtHtml(dirty);
  assert.ok(!clean.includes('script'));
  assert.ok(!clean.includes('onclick'));
  assert.ok(!clean.includes('javascript:'));
  assert.equal(clean, '<p>Hello <em>Art</em> Link</p>');
  assert.equal(buildAicImageUrls('').length, 0);
});

test('Met v1.1 search URL builder places q strictly last and uses v1.1', () => {
  const url = buildMetSearchUrl({
    departmentId: 11,
    medium: 'Paintings',
    isHighlight: true,
    limit: 250,
    q: 'sunflowers',
  });
  assert.ok(url.startsWith('https://collectionapi.metmuseum.org/public/collection/v1.1/search?'));
  assert.ok(url.includes('hasImages=true'));
  assert.ok(url.includes('isHighlight=true'));
  assert.ok(url.endsWith('&q=sunflowers'));
});

test('AIC client batches ?ids= detail fetches and serves subsequent skips from pool cache with 0 API calls', async () => {
  clearApiCaches();

  const aicOnly = normalizeSettings({
    museums: { aic: true, met: false },
    categories: {
      paintings: true,
      'works-on-paper': false,
      photography: false,
      sculpture: false,
      decorative: false,
      artifacts: false,
    },
  });

  let networkCalls = 0;
  let sawBatchIdsCall = false;

  const mockFetch = async (url) => {
    networkCalls++;
    if (url.includes('/artworks/search')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 16568, title: 'Water Lilies', image_id: 'img-1', artwork_type_title: 'Painting', is_on_view: true },
            { id: 27992, title: 'La Grande Jatte', image_id: 'img-2', artwork_type_title: 'Painting', is_on_view: true },
            { id: 28560, title: 'The Bedroom', image_id: 'img-3', artwork_type_title: 'Painting', is_on_view: true },
          ],
        }),
      };
    }
    if (url.includes('/artworks?ids=')) {
      sawBatchIdsCall = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          config: { iiif_url: 'https://www.artic.edu/iiif/2' },
          data: [
            { id: 16568, title: 'Water Lilies', artist_title: 'Monet', image_id: 'img-1', artwork_type_title: 'Painting' },
            { id: 27992, title: 'La Grande Jatte', artist_title: 'Seurat', image_id: 'img-2', artwork_type_title: 'Painting' },
            { id: 28560, title: 'The Bedroom', artist_title: 'Van Gogh', image_id: 'img-3', artwork_type_title: 'Painting' },
          ],
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const first = await fetchNextArtwork(aicOnly, [], null, { fetchImpl: mockFetch });
  assert.ok(first.uid.startsWith('aic:'));
  assert.equal(sawBatchIdsCall, true);
  assert.equal(networkCalls, 2); // 1 search + 1 batched ?ids= call

  // 2nd and 3rd skips should come straight from the cached pool with 0 extra requests!
  const second = await fetchNextArtwork(aicOnly, [first.uid], 'aic', { fetchImpl: mockFetch });
  const third = await fetchNextArtwork(aicOnly, [first.uid, second.uid], 'aic', { fetchImpl: mockFetch });
  assert.notEqual(second.uid, first.uid);
  assert.notEqual(third.uid, first.uid);
  assert.notEqual(third.uid, second.uid);
  assert.equal(networkCalls, 2);
});

test('AIC HTTP 429 triggers cooldown and routes seamlessly to The Met', async () => {
  clearApiCaches();

  const bothSettings = normalizeSettings({
    museums: { aic: true, met: true },
    categories: {
      paintings: true,
      'works-on-paper': false,
      photography: false,
      sculpture: false,
      decorative: false,
      artifacts: false,
    },
  });

  let aicCalls = 0;
  const mockFetch = async (url) => {
    if (url.includes('api.artic.edu')) {
      aicCalls++;
      return { ok: false, status: 429, json: async () => ({ error: 'Too Many Requests' }) };
    }
    if (url.includes('/v1.1/search')) {
      return { ok: true, status: 200, json: async () => ({ total: 2, objectIDs: [436524, 436528] }) };
    }
    if (url.endsWith('/v1/objects/436524') || url.endsWith('/v1/objects/436528')) {
      const id = Number(url.split('/').pop());
      return {
        ok: true,
        status: 200,
        json: async () => ({
          objectID: id,
          title: id === 436524 ? 'Sunflowers' : 'Irises',
          artistDisplayName: 'Vincent van Gogh',
          department: 'European Paintings',
          classification: 'Paintings',
          primaryImage: `https://images.metmuseum.org/${id}.jpg`,
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  // Pass lastSource='met' so AIC is tried first (or if Met tried first, force AIC 429 directly)
  const aicOnly = normalizeSettings({ ...bothSettings, museums: { aic: true, met: false } });
  await assert.rejects(() => fetchNextArtwork(aicOnly, [], null, { fetchImpl: mockFetch }));
  assert.equal(isAicCoolingDown(), true);

  const callsBeforeCooldownRoute = aicCalls;
  const routed = await fetchNextArtwork(bothSettings, [], 'met', { fetchImpl: mockFetch });
  assert.equal(routed.source, 'met');
  assert.equal(aicCalls, callsBeforeCooldownRoute); // AIC was skipped while cooling down!
});

test('Met client caches search objectIDs, skips 404 IDs, and enriches via Wikipedia', async () => {
  clearApiCaches();

  const metSettings = normalizeSettings({
    museums: { aic: false, met: true },
    categories: {
      paintings: true,
      'works-on-paper': false,
      photography: false,
      sculpture: false,
      decorative: false,
      artifacts: false,
    },
  });

  let searchCalls = 0;
  const mockFetch = async (url) => {
    if (url.includes('/v1.1/search')) {
      searchCalls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ total: 8, objectIDs: [999999, 436524, 436528, 437133, 437881, 435809, 436819, 437394] }),
      };
    }
    if (url.endsWith('/v1/objects/999999')) {
      return { ok: false, status: 404, json: async () => ({ message: 'Not a valid object' }) };
    }
    if (url.includes('/v1/objects/')) {
      const id = Number(url.split('/').pop());
      return {
        ok: true,
        status: 200,
        json: async () => ({
          objectID: id,
          title: `Painting ${id}`,
          artistDisplayName: 'Vincent van Gogh',
          department: 'European Paintings',
          classification: 'Paintings',
          primaryImage: `https://images.metmuseum.org/${id}.jpg`,
          objectWikidata_URL: 'https://www.wikidata.org/wiki/Q18915137',
        }),
      };
    }
    if (url.includes('wikidata.org')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          entities: {
            Q18915137: {
              sitelinks: { enwiki: { title: 'Sunflowers (Van Gogh series)' } },
            },
          },
        }),
      };
    }
    if (url.includes('en.wikipedia.org/api/rest_v1/page/summary')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          extract: 'Sunflowers is the title of two series of still life paintings by the Dutch painter Vincent van Gogh.',
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Sunflowers_(Van_Gogh_series)' } },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const first = await fetchNextArtwork(metSettings, [], null, { fetchImpl: mockFetch });
  assert.equal(first.source, 'met');
  assert.equal(searchCalls, 1);

  // Second Met fetch reuses cached objectID pool without calling /v1.1/search again!
  const second = await fetchNextArtwork(metSettings, [first.uid], 'met', { fetchImpl: mockFetch });
  assert.equal(second.source, 'met');
  assert.notEqual(second.uid, first.uid);
  assert.equal(searchCalls, 1);

  assert.equal(extractWikidataId(first.objectWikidataUrl), 'Q18915137');
  const context = await enrichArtworkContext(first, { fetchImpl: mockFetch });
  assert.ok(context.descriptionHtml.includes('Vincent van Gogh'));
  assert.equal(context.descriptionSource.label, 'Historical Context · Wikipedia');
});

test('zoom math clamps 100%-400%, enforces viewport pan bounds, and anchors focal-point pinch', () => {
  assert.equal(MIN_ZOOM, 1);
  assert.equal(MAX_ZOOM, 4);
  assert.equal(clampZoom(0.5), 1);
  assert.equal(clampZoom(2.5), 2.5);
  assert.equal(clampZoom(7), 4);
  assert.equal(clampZoom(Number.NaN), 1);

  // At 100%, pan is always centered (0, 0)
  assert.deepEqual(
    clampPan(250, -200, { scale: 1, baseWidth: 800, baseHeight: 600, viewportWidth: 1000, viewportHeight: 800 }),
    { tx: 0, ty: 0 }
  );

  // At 200% on an 800x600 image inside a 1000x800 viewport:
  // scaled is 1600x1200 -> maxX = (1600 - 1000)/2 = 300, maxY = (1200 - 800)/2 = 200
  assert.deepEqual(
    clampPan(500, -400, { scale: 2, baseWidth: 800, baseHeight: 600, viewportWidth: 1000, viewportHeight: 800 }),
    { tx: 300, ty: -200 }
  );

  // Narrow portrait at 120% still fits horizontally (maxX = 0) while allowing vertical pan
  assert.deepEqual(
    clampPan(90, 150, { scale: 1.2, baseWidth: 500, baseHeight: 900, viewportWidth: 1000, viewportHeight: 800 }),
    { tx: 0, ty: 140 }
  );

  // Focal zoom from 1x to 2x at point (+100, -50) shifts image by (-100, +50) to keep focal point stationary
  assert.deepEqual(
    computeFocalZoomPan({ currentScale: 1, nextScale: 2, currentTx: 0, currentTy: 0, focalX: 100, focalY: -50 }),
    { tx: -100, ty: 50 }
  );

  // Two-finger pinch doubling finger distance from midpoint (60, -40) moved to (80, -30)
  const pinch = computePinchTransform({
    startDist: 100,
    currentDist: 200,
    startMidX: 60,
    startMidY: -40,
    currentMidX: 80,
    currentMidY: -30,
  });
  assert.equal(pinch.scale, 2);
  assert.equal(pinch.tx, 80 - 2 * 60);
  assert.equal(pinch.ty, -30 - 2 * -40);

  // Pinch clamps cleanly at 4x max
  const overPinch = computePinchTransform({
    startDist: 50,
    currentDist: 400,
    startMidX: 0,
    startMidY: 0,
    currentMidX: 0,
    currentMidY: 0,
  });
  assert.equal(overPinch.scale, 4);
});

