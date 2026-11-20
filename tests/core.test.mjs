import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatCountdown,
  getCurrentHourKey,
  getMsUntilNextHour,
  getNextHourDate,
} from '../js/clock.js';
import {
  canSkipInHour,
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
  enrichArtworkContext,
  extractWikidataId,
  fetchNextArtwork,
} from '../js/api.js';

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

test('storage enforces valid settings and 1-skip-per-hour lock', () => {
  const store = createMemoryStorage();

  // Attempting to disable all museums or all categories restores safe defaults
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

  saveSettings({ ...sanitized, framing: 'matte', highlightsOnly: false }, store);
  const loadedSettings = loadSettings(store);
  assert.equal(loadedSettings.framing, 'matte');
  assert.equal(loadedSettings.highlightsOnly, false);

  // Hourly skip lifecycle
  let state = loadGalleryState(store);
  assert.equal(canSkipInHour(state, '2026-11-20T15'), true);

  state = recordDisplayedArtwork(
    state,
    { uid: 'aic:16568', title: 'Water Lilies' },
    '2026-11-20T15',
    { consumedSkip: false }
  );
  assert.equal(canSkipInHour(state, '2026-11-20T15'), true);

  // Consume the single hourly skip
  state = recordDisplayedArtwork(
    state,
    { uid: 'met:436524', title: 'Sunflowers' },
    '2026-11-20T15',
    { consumedSkip: true }
  );
  saveGalleryState(state, store);

  const reloaded = loadGalleryState(store);
  assert.equal(canSkipInHour(reloaded, '2026-11-20T15'), false);
  // Resets cleanly on the next clock hour
  assert.equal(canSkipInHour(reloaded, '2026-11-20T16'), true);
  assert.deepEqual(reloaded.recentIds, ['aic:16568', 'met:436524']);
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

  // Empty Met primaryImage should return null
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

test('fetchNextArtwork handles Met 404 IDs, cross-museum fallback, and Wikipedia enrichment', async () => {
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

  const mockFetch = async (url) => {
    if (url.includes('/v1.1/search')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ total: 2, objectIDs: [999999, 436524] }),
      };
    }
    if (url.endsWith('/v1/objects/999999')) {
      return { ok: false, status: 404, json: async () => ({ message: 'Not a valid object' }) };
    }
    if (url.endsWith('/v1/objects/436524')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          objectID: 436524,
          title: 'Sunflowers',
          artistDisplayName: 'Vincent van Gogh',
          department: 'European Paintings',
          classification: 'Paintings',
          primaryImage: 'https://images.metmuseum.org/sunflowers.jpg',
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

  const artwork = await fetchNextArtwork(metSettings, [], null, { fetchImpl: mockFetch });
  assert.equal(artwork.uid, 'met:436524');
  assert.equal(extractWikidataId(artwork.objectWikidataUrl), 'Q18915137');

  const context = await enrichArtworkContext(artwork, { fetchImpl: mockFetch });
  assert.ok(context.descriptionHtml.includes('Vincent van Gogh'));
  assert.equal(context.descriptionSource.label, 'Historical Context · Wikipedia');
});
