/**
 * Artwork classification, schema normalization across AIC & The Met,
 * IIIF image fallback URL construction, and safe curatorial HTML sanitization.
 */

import { API_ENDPOINTS, ART_CATEGORIES } from './config.js';

const CATEGORY_MAP = new Map(ART_CATEGORIES.map((c) => [c.id, c.label]));

/**
 * Classifies an Art Institute of Chicago record into one of the 6 HORA art types.
 */
export function classifyAicArtwork(record) {
  const typeText = [
    record.artwork_type_title,
    record.classification_title,
    ...(Array.isArray(record.classification_titles) ? record.classification_titles : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const deptText = String(record.department_title || '').toLowerCase();
  const mediumText = String(record.medium_display || '').toLowerCase();
  const combined = `${typeText} ${deptText} ${mediumText}`;

  if (/\b(photograph|photography|daguerreotype|gelatin silver|albumen|photogravure|chromogenic|cyanotype)\b/.test(typeText) || deptText.includes('photography')) {
    return 'photography';
  }
  if (/\b(painting|oil on canvas|oil on panel|tempera|fresco|acrylic on canvas|miniature painting)\b/.test(typeText) || /\bpainting\b/.test(record.artwork_type_title?.toLowerCase() || '')) {
    return 'paintings';
  }
  if (/\b(print|drawing|watercolor|etching|lithograph|woodblock|woodcut|engraving|pastel|sketch|manuscript|book|poster|calligraphy)\b/.test(typeText) || deptText.includes('prints and drawings')) {
    return 'works-on-paper';
  }
  if (/\b(sculpture|statue|bust|relief|carving|figurine)\b/.test(typeText)) {
    return 'sculpture';
  }
  if (/\b(textile|tapestry|costume|furniture|glass|ceramic|porcelain|stoneware|celadon|earthenware|lacquer|cloisonn[eé]|kimono|robe|vessel|metalwork|silver|jewelry|decorative|stained glass|carpet|lace|embroidery|clock|instrument)\b/.test(typeText) || deptText.includes('textiles') || deptText.includes('architecture and design')) {
    return 'decorative';
  }
  if (/\b(ancient|egyptian|greek|roman|byzantine|medieval|islamic|asian|african|americas|oceanic|armor|arms|weapon|coin|mask|scroll|screen)\b/.test(combined)) {
    return 'artifacts';
  }
  if (/\b(oil|canvas|panel|tempera|acrylic)\b/.test(mediumText)) {
    return 'paintings';
  }
  return 'artifacts';
}

/**
 * Classifies a Met Collection object record into one of the 6 HORA art types.
 */
export function classifyMetArtwork(record) {
  const dept = String(record.department || '').toLowerCase();
  const classification = String(record.classification || '').toLowerCase();
  const objName = String(record.objectName || '').toLowerCase();
  const medium = String(record.medium || '').toLowerCase();
  const primary = `${classification} ${objName}`;

  if (dept.includes('photograph') || /\b(photograph|daguerreotype|gelatin silver|albumen|negative)\b/.test(primary)) {
    return 'photography';
  }
  if (dept.includes('european paintings') || /\bpainting/.test(primary) || /\b(oil on canvas|oil on wood|tempera on wood|oil on panel)\b/.test(medium)) {
    return 'paintings';
  }
  if (dept.includes('drawings and prints') || dept.includes('libraries') || /\b(print|drawing|etching|woodcut|woodblock|lithograph|engraving|watercolor|manuscript|book|codex|pastel)\b/.test(primary)) {
    return 'works-on-paper';
  }
  if (/\b(sculpture|statue|statuette|bust|relief|figure|figurine)\b/.test(primary)) {
    return 'sculpture';
  }
  if (
    dept.includes('decorative arts') ||
    dept.includes('costume institute') ||
    dept.includes('musical instruments') ||
    /\b(textile|tapestry|ceramic|porcelain|stoneware|celadon|earthenware|lacquer|cloisonn[eé]|kimono|robe|glass|furniture|metalwork|silver|gold|jewelry|costume|dress|lace|instrument|clock|enamel|woodwork)\b/.test(primary)
  ) {
    return 'decorative';
  }
  if (
    dept.includes('egyptian') ||
    dept.includes('greek and roman') ||
    dept.includes('ancient near eastern') ||
    dept.includes('asian') ||
    dept.includes('islamic') ||
    dept.includes('arms and armor') ||
    dept.includes('africa') ||
    dept.includes('medieval') ||
    dept.includes('cloisters')
  ) {
    return 'artifacts';
  }
  if (dept.includes('modern art') || dept.includes('lehman')) {
    return 'paintings';
  }
  return 'artifacts';
}

/**
 * Sanitizes museum curatorial HTML into safe paragraphs/emphasis only.
 * Strips scripts, links, inline styles, and unsafe attributes.
 */
export function sanitizeArtHtml(rawHtml) {
  if (!rawHtml || typeof rawHtml !== 'string') return '';
  const trimmed = rawHtml.trim();
  if (!trimmed) return '';

  // Use native DOMParser in browser environments for exact HTML parsing.
  if (typeof globalThis.DOMParser === 'function') {
    const parser = new globalThis.DOMParser();
    const doc = parser.parseFromString(trimmed, 'text/html');
    const ALLOWED_TAGS = new Set(['P', 'EM', 'I', 'STRONG', 'B', 'BR', 'BLOCKQUOTE']);

    const cleanNode = (node) => {
      if (node.nodeType === 3) {
        return escapeHtml(node.textContent || '');
      }
      if (node.nodeType !== 1) return '';
      const tag = node.tagName.toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'OBJECT') {
        return '';
      }
      const children = Array.from(node.childNodes).map(cleanNode).join('');
      if (tag === 'BR') return '<br>';
      if (ALLOWED_TAGS.has(tag)) {
        const lower = tag.toLowerCase();
        return `<${lower}>${children}</${lower}>`;
      }
      return children;
    };

    const output = Array.from(doc.body.childNodes).map(cleanNode).join('').trim();
    if (!output) return '';
    return output.startsWith('<p>') || output.startsWith('<blockquote>') ? output : `<p>${output}</p>`;
  }

  // Fallback sanitizer for non-DOM environments (e.g., Node unit tests).
  const withoutDangerous = trimmed
    .replace(/<(script|style|iframe|object)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(?!(?:p|em|i|strong|b|br|blockquote)\b)[a-z][^>]*>/gi, '')
    .replace(/<(p|em|i|strong|b|br|blockquote)\b[^>]*>/gi, '<$1>')
    .trim();

  if (!withoutDangerous) return '';
  return /^<(p|blockquote)>/i.test(withoutDangerous) ? withoutDangerous : `<p>${withoutDangerous}</p>`;
}

export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function textToSafeParagraphs(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('');
}

/**
 * Builds an ordered AIC IIIF image URL ladder: high-res first, gracefully stepping
 * down to 843px (AIC's standard cached/copyright-safe width) and 600px.
 */
export function buildAicImageUrls(imageId, iiifBase = API_ENDPOINTS.AIC_IIIF_FALLBACK) {
  if (!imageId) return [];
  const base = String(iiifBase || API_ENDPOINTS.AIC_IIIF_FALLBACK).replace(/\/+$/, '');
  return [
    `${base}/${imageId}/full/1686,/0/default.jpg`,
    `${base}/${imageId}/full/843,/0/default.jpg`,
    `${base}/${imageId}/full/600,/0/default.jpg`,
  ];
}

/**
 * Normalizes an Art Institute of Chicago artwork response into HORA's unified model.
 */
export function normalizeAicArtwork(record, iiifBase) {
  if (!record || !record.id || !record.image_id) return null;

  const category = classifyAicArtwork(record);
  const artistDisplay = cleanText(record.artist_display);
  const artistTitle = cleanText(record.artist_title);
  const artist = artistDisplay || artistTitle || 'Unknown Artist';
  const artistShort = artistTitle || artist.split('\n')[0];

  const styleParts = uniqueNonEmpty([
    record.style_title,
    ...(Array.isArray(record.style_titles) ? record.style_titles : []),
  ]);

  const rawDesc = record.description || record.short_description || '';
  const descriptionHtml = sanitizeArtHtml(rawDesc);

  let galleryLocation = '';
  if (record.is_on_view && record.gallery_title) {
    galleryLocation = `On view · ${record.gallery_title}`;
  } else if (record.is_on_view) {
    galleryLocation = 'Currently on view';
  } else {
    galleryLocation = 'Not currently on view';
  }

  const tags = uniqueNonEmpty([
    ...(Array.isArray(record.term_titles) ? record.term_titles : []),
    ...(Array.isArray(record.style_titles) ? record.style_titles : []),
  ]).slice(0, 6);

  return {
    uid: `aic:${record.id}`,
    source: 'aic',
    museumName: 'Art Institute of Chicago',
    museumShort: 'Art Institute of Chicago',
    id: record.id,
    title: cleanText(record.title) || 'Untitled',
    artist: artist.replace(/\n+/g, ' · '),
    artistShort,
    category,
    categoryLabel: cleanText(record.artwork_type_title) || CATEGORY_MAP.get(category) || 'Fine Art',
    dateDisplay: cleanText(record.date_display),
    eraOrMovement: styleParts.slice(0, 2).join(', '),
    originOrCulture: cleanText(record.place_of_origin),
    medium: cleanText(record.medium_display),
    dimensions: cleanText(record.dimensions),
    department: cleanText(record.department_title),
    galleryLocation,
    imageUrls: buildAicImageUrls(record.image_id, iiifBase),
    lqip: record.thumbnail?.lqip || '',
    altText: cleanText(record.thumbnail?.alt_text) || `${cleanText(record.title) || 'Artwork'} by ${artistShort}`,
    descriptionHtml,
    descriptionSource: descriptionHtml
      ? { label: 'Curatorial Note · Art Institute of Chicago', url: `https://www.artic.edu/artworks/${record.id}` }
      : null,
    needsContextEnrichment: false,
    objectWikidataUrl: '',
    artistWikidataUrl: '',
    creditLine: cleanText(record.credit_line),
    tags,
    museumUrl: `https://www.artic.edu/artworks/${record.id}`,
  };
}

/**
 * Normalizes a Met Collection object response into HORA's unified model.
 */
export function normalizeMetArtwork(record) {
  if (!record || !record.objectID) return null;
  const imageUrls = uniqueNonEmpty([record.primaryImage, record.primaryImageSmall]);
  if (imageUrls.length === 0) return null;

  const category = classifyMetArtwork(record);

  const artistName = cleanText(record.artistDisplayName);
  const artistBio = cleanText(record.artistDisplayBio);
  const artistPrefix = cleanText(record.artistPrefix);
  let artist = 'Unknown Artist';
  let artistShort = 'Unknown Artist';

  if (artistName) {
    const prefixed = artistPrefix ? `${artistPrefix} ${artistName}` : artistName;
    artist = artistBio ? `${prefixed} (${artistBio})` : prefixed;
    artistShort = artistName;
  } else if (cleanText(record.culture)) {
    artist = cleanText(record.culture);
    artistShort = artist;
  }

  const eraOrMovement = uniqueNonEmpty([record.period, record.dynasty, record.reign]).join(' · ');
  const originOrCulture = uniqueNonEmpty([
    record.culture,
    record.country,
    record.region,
    record.city,
  ])
    .slice(0, 2)
    .join(', ');

  let galleryLocation = 'Not currently on view';
  if (cleanText(record.GalleryNumber)) {
    galleryLocation = `On view · Gallery ${cleanText(record.GalleryNumber)}`;
  }

  const tags = Array.isArray(record.tags)
    ? uniqueNonEmpty(record.tags.map((t) => (typeof t === 'string' ? t : t?.term))).slice(0, 6)
    : [];

  const objectWikidataUrl = cleanText(record.objectWikidata_URL);
  const artistWikidataUrl = cleanText(record.artistWikidata_URL);

  return {
    uid: `met:${record.objectID}`,
    source: 'met',
    museumName: 'The Metropolitan Museum of Art',
    museumShort: 'The Met',
    id: record.objectID,
    title: cleanText(record.title) || cleanText(record.objectName) || 'Untitled',
    artist,
    artistShort,
    category,
    categoryLabel: cleanText(record.classification) || cleanText(record.objectName) || CATEGORY_MAP.get(category) || 'Fine Art',
    dateDisplay: cleanText(record.objectDate),
    eraOrMovement,
    originOrCulture,
    medium: cleanText(record.medium),
    dimensions: cleanText(record.dimensions),
    department: cleanText(record.department),
    galleryLocation,
    imageUrls,
    lqip: '',
    altText: `${cleanText(record.title) || 'Artwork'} — ${artistShort}`,
    descriptionHtml: '',
    descriptionSource: null,
    needsContextEnrichment: Boolean(objectWikidataUrl || artistWikidataUrl),
    objectWikidataUrl,
    artistWikidataUrl,
    creditLine: cleanText(record.creditLine),
    tags,
    museumUrl: cleanText(record.objectURL) || `https://www.metmuseum.org/art/collection/search/${record.objectID}`,
  };
}

function cleanText(val) {
  if (typeof val !== 'string') return '';
  return val.replace(/\s+/g, ' ').trim();
}

function uniqueNonEmpty(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const cleaned = cleanText(item);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cleaned);
    }
  }
  return out;
}

/* ==========================================================================
   Art-History Era Matching (Chronology + Curatorial Movement / Region)
   ========================================================================== */

const NON_EUROPEAN_RE =
  /\b(japanese|japan|chinese|china|korean|korea|asian|asia|indian|india|islamic|iranian|iran|persian|ottoman|turkish|african|africa|oceanic|oceania|pre-columbian|mexican|mexico|peruvian|peru|american|united states|u\.s\.a\.|canadian|edo|qing|ming|meiji|mughal|joseon|safavid|tibetan|thai|cambodian|indonesian|polynesian|aztec|maya|inca)\b/i;

const NON_WESTERN_RE =
  /\b(japanese|japan|chinese|china|korean|korea|asian|asia|indian|india|islamic|iranian|iran|persian|ottoman|turkish|african|africa|oceanic|oceania|pre-columbian|edo|qing|ming|meiji|mughal|joseon|safavid|tibetan|thai|cambodian|indonesian|polynesian|aztec|maya|inca)\b/i;

const EUROPEAN_ORIGIN_RE =
  /\b(european|europe|italian|italy|french|france|dutch|netherlands|holland|flemish|flanders|netherlandish|belgian|belgium|german|germany|spanish|spain|british|english|england|scottish|scotland|irish|ireland|austrian|austria|swiss|switzerland|bohemian|czech|polish|poland|russian|russia|swedish|sweden|danish|denmark|norwegian|norway|portuguese|portugal|hungarian|hungary|venetian|florentine|roman|neapolitan|bolognese|lombard|sienese|byzantine|gothic|greek|greece|medieval|cloisters|paris|london|rome|venice|florence|amsterdam|antwerp|madrid|vienna)\b/i;

const WESTERN_ORIGIN_RE =
  /\b(american|united states|new york|boston|philadelphia|chicago|canadian|canada)\b/i;

const ANCIENT_SCOPE_RE =
  /\b(ancient|egypt|egyptian|greek|greece|roman|rome|etruscan|mesopotam|assyria|assyrian|babylon|babylonian|sumer|sumerian|mediterranean|near east|near eastern|cycladic|minoan|mycenaean|hellenistic|classical|prehistoric|neolithic|paleolithic|phoenician|cypriot|anatolian|levant|achaemenid|byzantine|celtic)\b/i;

const JAPAN_ORIGIN_RE =
  /\b(japan|japanese|edo|kyoto|tokyo|osaka|nagasaki|heian|kamakura|muromachi|momoyama|nanbokucho|azuchi-momoyama|nara|meiji|taisho|showa|ukiyo-e|shin-hanga|sosaku-hanga|nihonga|rimpa|kano school|maruyama-shijo)\b/i;

const CHINA_ORIGIN_RE =
  /\b(china|chinese|beijing|peking|shanghai|nanjing|hangzhou|suzhou|jingdezhen|shang|zhou|warring states|qin|han|six dynasties|northern wei|sui|tang|song|northern song|southern song|jin dynasty|liao|yuan|ming|qing|kangxi|qianlong|yongle|wanli|xuande|sancai|shan shui)\b/i;

const NON_JAPAN_RE =
  /\b(china|chinese|korea|korean|joseon|goryeo|india|indian|mughal|tibet|tibetan|nepal|nepalese|thailand|thai|cambodia|cambodian|khmer|vietnam|vietnamese|indonesia|indonesian|java|javanese|iran|iranian|persia|persian|islamic|ottoman|turkish|europe|european|france|french|italy|italian|germany|german|england|english|british|dutch|netherlands|spain|spanish|american|united states|egypt|egyptian|greek|roman)\b/i;

const NON_CHINA_RE =
  /\b(japan|japanese|edo|meiji|taisho|showa|heian|kamakura|muromachi|momoyama|ukiyo-e|korea|korean|joseon|goryeo|india|indian|mughal|tibet|tibetan|nepal|nepalese|thailand|thai|cambodia|cambodian|khmer|vietnam|vietnamese|indonesia|indonesian|java|javanese|iran|iranian|persia|persian|islamic|ottoman|turkish|europe|european|france|french|italy|italian|germany|german|england|english|british|dutch|netherlands|spain|spanish|american|united states|egypt|egyptian|greek|roman)\b/i;

function isYearInEra(startYear, endYear, era) {
  const hasStart = typeof startYear === 'number' && Number.isFinite(startYear);
  const hasEnd = typeof endYear === 'number' && Number.isFinite(endYear);
  if (!hasStart && !hasEnd) return false;

  const s = hasStart ? startYear : endYear;
  const e = hasEnd ? endYear : startYear;
  // Guard against overly vague date ranges on post-ancient works (allowing wider dynastic spans for Early Imperial China)
  if (era.id !== 'ancient') {
    const maxSpan = era.id === 'china-early' ? 1000 : 250;
    if (Math.abs(e - s) > maxSpan) {
      return false;
    }
  }
  const mid = (s + e) / 2;
  return mid >= era.dateBegin && mid <= era.dateEnd;
}

function matchesRegionScope({ scope, dept, primaryOrigin = '', originText, styleText, era }) {
  if (scope === 'any') return true;

  const deptLow = dept.toLowerCase();
  const primaryLow = primaryOrigin.toLowerCase();
  const originLow = originText.toLowerCase();
  const styleLow = styleText.toLowerCase();
  const allText = `${deptLow} ${originLow} ${styleLow}`;

  if (scope === 'ancient') {
    if (/\b(arts of asia|asian art|islamic art|arts of africa|oceania|americas)\b/i.test(deptLow)) {
      return false;
    }
    return ANCIENT_SCOPE_RE.test(allText);
  }

  if (scope === 'europe') {
    if (NON_EUROPEAN_RE.test(deptLow) || NON_EUROPEAN_RE.test(originLow)) {
      return false;
    }
    if (Array.isArray(era.aicStyles) && styleLow) {
      if (era.aicStyles.some((s) => styleLow.includes(s))) return true;
    }
    if (/\b(europe|european|medieval|cloisters|lehman)\b/i.test(deptLow)) {
      return true;
    }
    return EUROPEAN_ORIGIN_RE.test(allText);
  }

  if (scope === 'western') {
    if (NON_WESTERN_RE.test(deptLow) || NON_WESTERN_RE.test(originLow)) {
      return false;
    }
    if (Array.isArray(era.aicStyles) && styleLow) {
      if (era.aicStyles.some((s) => styleLow.includes(s))) return true;
    }
    if (/\b(europe|european|american|americas|lehman)\b/i.test(deptLow)) {
      return true;
    }
    return EUROPEAN_ORIGIN_RE.test(allText) || WESTERN_ORIGIN_RE.test(allText);
  }

  if (scope === 'japan') {
    const hasExplicitJapan = /\b(japan|japanese)\b/i.test(originLow);
    if (primaryLow && NON_JAPAN_RE.test(primaryLow) && !/\b(japan|japanese)\b/i.test(primaryLow)) {
      return false;
    }
    if (NON_JAPAN_RE.test(originLow) && !hasExplicitJapan) {
      return false;
    }
    if (
      /\b(european|american|egyptian|greek and roman|ancient near|islamic|medieval|cloisters|africa|oceania)\b/i.test(deptLow) &&
      !hasExplicitJapan
    ) {
      return false;
    }
    return JAPAN_ORIGIN_RE.test(originLow) || JAPAN_ORIGIN_RE.test(styleLow);
  }

  if (scope === 'china') {
    const hasExplicitChina = /\b(china|chinese)\b/i.test(originLow);
    if (primaryLow && NON_CHINA_RE.test(primaryLow) && !/\b(china|chinese)\b/i.test(primaryLow)) {
      return false;
    }
    if (NON_CHINA_RE.test(originLow) && !hasExplicitChina) {
      return false;
    }
    if (
      /\b(european|american|egyptian|greek and roman|ancient near|islamic|medieval|cloisters|africa|oceania)\b/i.test(deptLow) &&
      !hasExplicitChina
    ) {
      return false;
    }
    return CHINA_ORIGIN_RE.test(originLow) || CHINA_ORIGIN_RE.test(styleLow);
  }

  return true;
}

/**
 * Checks whether an Art Institute of Chicago record belongs to a specific art-history era.
 */
export function matchesAicEra(record, era) {
  if (!record || !era) return false;

  const start = typeof record.date_start === 'number' ? record.date_start : null;
  const end = typeof record.date_end === 'number' ? record.date_end : null;
  if (!isYearInEra(start, end, era)) return false;

  const styleText = [
    record.style_title,
    ...(Array.isArray(record.style_titles) ? record.style_titles : []),
  ]
    .filter(Boolean)
    .join(' ');

  const primaryOrigin = String(record.place_of_origin || '');
  const originText = [record.place_of_origin, record.artist_display]
    .filter(Boolean)
    .join(' ');

  return matchesRegionScope({
    scope: era.regionScope,
    dept: String(record.department_title || ''),
    primaryOrigin,
    originText,
    styleText,
    era,
  });
}

export function matchesAnyAicEra(record, eras) {
  if (!Array.isArray(eras) || eras.length === 0) return true;
  return eras.some((era) => matchesAicEra(record, era));
}

/**
 * Checks whether a Met Collection record belongs to a specific art-history era.
 */
export function matchesMetEra(record, era) {
  if (!record || !era) return false;

  const rawStart = typeof record.objectBeginDate === 'number' ? record.objectBeginDate : null;
  const rawEnd = typeof record.objectEndDate === 'number' ? record.objectEndDate : null;

  // The Met encodes undated objects as objectBeginDate: 0, objectEndDate: 0.
  const isUndatedZero =
    rawStart === 0 &&
    rawEnd === 0 &&
    !/\b(b\.?c\.?|a\.?d\.?|1st century|\b0\b)\b/i.test(String(record.objectDate || ''));
  if (isUndatedZero) return false;

  if (!isYearInEra(rawStart, rawEnd, era)) return false;

  const primaryOrigin = [record.culture, record.country]
    .filter(Boolean)
    .join(' ');

  const originText = [
    record.culture,
    record.country,
    record.region,
    record.city,
    record.artistNationality,
    record.artistDisplayBio,
  ]
    .filter(Boolean)
    .join(' ');

  const styleText = [record.period, record.dynasty, record.reign]
    .filter(Boolean)
    .join(' ');

  return matchesRegionScope({
    scope: era.regionScope,
    dept: String(record.department || ''),
    primaryOrigin,
    originText,
    styleText,
    era,
  });
}

export function matchesAnyMetEra(record, eras) {
  if (!Array.isArray(eras) || eras.length === 0) return true;
  return eras.some((era) => matchesMetEra(record, era));
}

