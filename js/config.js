/**
 * Configuration, museum definitions, art-type taxonomy, and defaults for HORA.
 */

export const STORAGE_KEYS = {
  STATE: 'hora_gallery_state_v1',
  SETTINGS: 'hora_gallery_settings_v1',
};

export const API_ENDPOINTS = {
  AIC_BASE: 'https://api.artic.edu/api/v1',
  AIC_IIIF_FALLBACK: 'https://www.artic.edu/iiif/2',
  MET_SEARCH_V1_1: 'https://collectionapi.metmuseum.org/public/collection/v1.1/search',
  MET_OBJECT_V1: 'https://collectionapi.metmuseum.org/public/collection/v1/objects',
  WIKIDATA_API: 'https://www.wikidata.org/w/api.php',
  WIKIPEDIA_SUMMARY: 'https://en.wikipedia.org/api/rest_v1/page/summary',
};

export const MUSEUMS = [
  {
    id: 'aic',
    name: 'Art Institute of Chicago',
    shortName: 'Art Institute of Chicago',
    description: 'Includes curatorial essays, modern works & IIIF high-res scans',
  },
  {
    id: 'met',
    name: 'The Metropolitan Museum of Art',
    shortName: 'The Met',
    description: '5,000 years of global art with Open Access photography',
  },
];

/**
 * Unified art-type categories used for Include / Exclude filtering across both museums.
 * Met department IDs correspond to the official /public/collection/v1/departments taxonomy.
 */
export const ART_CATEGORIES = [
  {
    id: 'paintings',
    label: 'Paintings',
    description: 'Oil, watercolor, tempera, fresco & modern canvases',
    aicQueries: [
      'oil on canvas',
      'painting landscape',
      'painting portrait',
      'still life painting',
      'impressionism painting',
      'modern painting',
      'tempera panel',
      'seascape painting',
    ],
    metDepartments: [11, 15, 21],
    metMedium: 'Paintings',
    metQueries: [
      'painting',
      'landscape',
      'portrait',
      'garden',
      'sea',
      'flower',
      'night',
      'river',
      'woman',
      'still life',
    ],
  },
  {
    id: 'works-on-paper',
    label: 'Drawings & Prints',
    description: 'Etchings, woodblocks, sketches, watercolors & manuscripts',
    aicQueries: [
      'woodblock print',
      'etching print',
      'lithograph',
      'watercolor drawing',
      'charcoal drawing',
      'ukiyo-e',
      'engraving',
      'pastel paper',
    ],
    metDepartments: [9, 16],
    metMedium: null,
    metQueries: [
      'print',
      'drawing',
      'etching',
      'woodcut',
      'sketch',
      'watercolor',
      'engraving',
      'landscape',
      'study',
    ],
  },
  {
    id: 'photography',
    label: 'Photography',
    description: 'Gelatin silver prints, daguerreotypes & fine art photography',
    aicQueries: [
      'gelatin silver print',
      'photograph',
      'albumen print',
      'platinum print',
      'chromogenic print',
      'photogravure',
    ],
    metDepartments: [19],
    metMedium: null,
    metQueries: [
      'photograph',
      'portrait',
      'city',
      'street',
      'bridge',
      'light',
      'tree',
      'sea',
      'figure',
    ],
  },
  {
    id: 'sculpture',
    label: 'Sculpture',
    description: 'Marble, bronze, terracotta, wood carving & reliefs',
    aicQueries: [
      'bronze sculpture',
      'marble sculpture',
      'terracotta sculpture',
      'carved wood figure',
      'stone relief',
      'statue',
    ],
    metDepartments: [12, 13, 17],
    metMedium: 'Sculpture',
    metQueries: [
      'sculpture',
      'statue',
      'bronze',
      'marble',
      'bust',
      'figure',
      'relief',
      'terracotta',
    ],
  },
  {
    id: 'decorative',
    label: 'Decorative Arts & Textiles',
    description: 'Ceramics, glass, tapestries, fashion, furniture & instruments',
    aicQueries: [
      'porcelain vessel',
      'tapestry textile',
      'stained glass',
      'silver decorative',
      'ceramic vase',
      'woven silk',
      'furniture cabinet',
    ],
    metDepartments: [1, 8, 12, 18],
    metMedium: null,
    metQueries: [
      'porcelain',
      'glass',
      'silk',
      'tapestry',
      'dress',
      'vase',
      'gold',
      'cabinet',
      'violin',
    ],
  },
  {
    id: 'artifacts',
    label: 'Ancient & World Artifacts',
    description: 'Egyptian, Classical, Asian, Islamic, Medieval & Arms',
    aicQueries: [
      'ancient egyptian',
      'ancient greek vase',
      'chinese jade',
      'japanese screen',
      'islamic ceramic',
      'medieval armor',
      'pre-columbian',
      'african mask',
    ],
    metDepartments: [3, 4, 5, 6, 7, 10, 13, 14, 17],
    metMedium: null,
    metQueries: [
      'temple',
      'gold',
      'armor',
      'jade',
      'scroll',
      'screen',
      'vessel',
      'mask',
      'mosaic',
      'sword',
    ],
  },
];

export const FRAMING_MODES = ['ambient', 'fill', 'matte'];

export const DEFAULT_SETTINGS = {
  framing: 'ambient',
  highlightsOnly: true,
  museums: {
    aic: true,
    met: true,
  },
  categories: {
    paintings: true,
    'works-on-paper': true,
    photography: true,
    sculpture: true,
    decorative: true,
    artifacts: true,
  },
};

/**
 * Verified backup IDs used strictly as a last-resort safety net if live search
 * pagination temporarily errors, ensuring the gallery never gets stuck blank.
 */
export const VERIFIED_FALLBACK_IDS = {
  aic: [
    { id: 16568, category: 'paintings' },   // Monet, Water Lilies (1906)
    { id: 27992, category: 'paintings' },   // Seurat, A Sunday on La Grande Jatte
    { id: 28560, category: 'paintings' },   // Van Gogh, The Bedroom
    { id: 111628, category: 'paintings' },  // Hopper, Nighthawks
    { id: 24645, category: 'works-on-paper' }, // Hokusai, The Great Wave
  ],
  met: [
    { id: 436524, category: 'paintings' },  // Van Gogh, Sunflowers
    { id: 436528, category: 'paintings' },  // Van Gogh, Irises
    { id: 437133, category: 'paintings' },  // Leutze, Washington Crossing the Delaware
    { id: 547802, category: 'artifacts' },  // The Temple of Dendur
  ],
};

export const RECENT_HISTORY_LIMIT = 80;
export const IDLE_TIMEOUT_MS = 3600;
