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

/**
 * Major art-history eras combining chronological date windows with curatorial
 * department, style, and regional rules so movement-based eras (like Baroque &
 * Rococo or Neoclassicism & Romanticism) stay stylistically authentic across
 * both the Art Institute of Chicago and The Met.
 */
export const ART_ERAS = [
  {
    id: 'ancient',
    label: 'Prehistoric & Ancient',
    description: 'c. 40,000 BCE–400 CE · Egypt, Greece, Rome & Near East',
    dateBegin: -40000,
    dateEnd: 400,
    regionScope: 'ancient',
    aicQueries: [
      'ancient egyptian',
      'ancient greek',
      'ancient roman',
      'ancient mediterranean',
      'mesopotamian',
      'hellenistic',
    ],
    aicStyles: [
      'ancient',
      'egyptian',
      'greek',
      'roman',
      'etruscan',
      'hellenistic',
      'assyrian',
      'babylonian',
      'sumerian',
      'cycladic',
      'minoan',
      'mycenaean',
      'prehistoric',
      'neolithic',
      'classical',
    ],
    metDepartments: [3, 10, 13],
    metQueries: ['temple', 'statue', 'vase', 'relief', 'gold', 'marble', 'bronze', 'mosaic', 'vessel'],
  },
  {
    id: 'medieval',
    label: 'Medieval',
    description: 'c. 400–1400 · Byzantine, Romanesque & Gothic',
    dateBegin: 400,
    dateEnd: 1400,
    regionScope: 'europe',
    aicQueries: [
      'medieval',
      'gothic',
      'byzantine',
      'romanesque',
      'illuminated manuscript',
    ],
    aicStyles: [
      'medieval',
      'gothic',
      'byzantine',
      'romanesque',
      'early christian',
      'carolingian',
      'ottonian',
      'international gothic',
    ],
    metDepartments: [7, 17, 11, 15, 4],
    metQueries: ['virgin', 'gothic', 'manuscript', 'saint', 'stained glass', 'altarpiece', 'ivory', 'enamel', 'tapestry'],
  },
  {
    id: 'renaissance',
    label: 'Renaissance',
    description: 'c. 1400–1600 · Early/High, Northern & Mannerism',
    dateBegin: 1400,
    dateEnd: 1600,
    regionScope: 'europe',
    aicQueries: [
      'renaissance',
      'mannerism',
      'italian renaissance',
      'northern renaissance',
      '15th century europe',
      '16th century europe',
    ],
    aicStyles: [
      'renaissance',
      'mannerism',
      'northern renaissance',
      'early renaissance',
      'high renaissance',
      'quattrocento',
      'cinquecento',
    ],
    metDepartments: [11, 12, 9, 15, 4],
    metQueries: ['madonna', 'portrait', 'saint', 'venus', 'christ', 'landscape', 'engraving', 'bronze', 'tapestry'],
  },
  {
    id: 'baroque-rococo',
    label: 'Baroque & Rococo',
    description: 'c. 1600–1780 · Dramatic chiaroscuro & ornate elegance',
    dateBegin: 1600,
    dateEnd: 1780,
    regionScope: 'europe',
    aicQueries: [
      'baroque',
      'rococo',
      'dutch golden age',
      '17th century dutch',
      '17th century italian',
      '18th century french',
    ],
    aicStyles: [
      'baroque',
      'rococo',
      'dutch golden age',
      'flemish baroque',
      'caravaggism',
      'louis xiv',
      'louis xv',
      '17th century',
      '18th century',
    ],
    metDepartments: [11, 12, 9, 15, 8, 18],
    metQueries: ['portrait', 'still life', 'landscape', 'etching', 'mythology', 'allegory', 'interior', 'pastoral', 'marble'],
  },
  {
    id: 'neoclassicism-romanticism',
    label: 'Neoclassicism & Romanticism',
    description: 'c. 1750–1850 · Classical order & sublime emotion',
    dateBegin: 1750,
    dateEnd: 1850,
    regionScope: 'western',
    aicQueries: [
      'neoclassicism',
      'romanticism',
      'neoclassical',
      'hudson river school',
      'empire style',
      'early 19th century',
    ],
    aicStyles: [
      'neoclassicism',
      'neoclassical',
      'romanticism',
      'empire',
      'regency',
      'federal',
      'hudson river',
      'biedermeier',
      'georgian',
    ],
    metDepartments: [11, 12, 9, 1, 15, 19],
    metQueries: ['landscape', 'portrait', 'classical', 'sea', 'ruins', 'storm', 'mythology', 'mountain', 'etching'],
  },
  {
    id: 'realism-impressionism',
    label: 'Realism & Impressionism',
    description: 'c. 1850–1905 · Realism, Impressionism & Post-Impressionism',
    dateBegin: 1850,
    dateEnd: 1905,
    regionScope: 'western',
    aicQueries: [
      'impressionism',
      'post-impressionism',
      'realism',
      'symbolism',
      'art nouveau',
      'pre-raphaelite',
      'barbizon',
    ],
    aicStyles: [
      'impressionism',
      'post-impressionism',
      'realism',
      'barbizon',
      'symbolism',
      'art nouveau',
      'pre-raphaelite',
      'aesthetic movement',
      'arts and crafts',
      'nabis',
      'pointillism',
      'neo-impressionism',
      '19th century',
    ],
    metDepartments: [11, 12, 9, 1, 15, 19, 21],
    metQueries: ['garden', 'river', 'paris', 'portrait', 'landscape', 'dancer', 'flowers', 'sea', 'still life'],
  },
  {
    id: 'modern',
    label: 'Modern',
    description: 'c. 1900–1970 · Cubism, Surrealism, Abstract & Bauhaus',
    dateBegin: 1900,
    dateEnd: 1970,
    regionScope: 'any',
    aicQueries: [
      'modernism',
      'cubism',
      'surrealism',
      'abstract expressionism',
      'expressionism',
      'fauvism',
      'bauhaus',
      'art deco',
      'pop art',
    ],
    aicStyles: [
      'modern',
      'modernism',
      'cubism',
      'surrealism',
      'expressionism',
      'abstract expressionism',
      'fauvism',
      'bauhaus',
      'dada',
      'futurism',
      'de stijl',
      'art deco',
      'pop art',
      'minimalism',
      'mid-century',
      '20th century',
    ],
    metDepartments: [21, 19, 9, 1, 8, 12],
    metQueries: ['abstract', 'composition', 'city', 'portrait', 'still life', 'figure', 'landscape', 'night', 'study'],
  },
  {
    id: 'contemporary',
    label: 'Contemporary',
    description: '1970–Present · Postmodern, Conceptual & Present Day',
    dateBegin: 1970,
    dateEnd: 2035,
    regionScope: 'any',
    aicQueries: [
      'contemporary art',
      'postmodernism',
      'conceptual art',
      'contemporary photography',
      'contemporary painting',
      'late 20th century',
    ],
    aicStyles: [
      'contemporary',
      'postmodern',
      'conceptual',
      'neo-expressionism',
      '21st century',
      'late 20th century',
    ],
    metDepartments: [21, 19, 9, 8],
    metQueries: ['untitled', 'portrait', 'color', 'light', 'street', 'figure', 'landscape', 'print', 'photograph'],
  },
];

export const FRAMING_MODES = ['ambient', 'fill', 'matte'];
export const THEME_MODES = ['system', 'light', 'dark'];

export const DEFAULT_SETTINGS = {
  framing: 'ambient',
  theme: 'system',
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
  eras: {
    ancient: true,
    medieval: true,
    renaissance: true,
    'baroque-rococo': true,
    'neoclassicism-romanticism': true,
    'realism-impressionism': true,
    modern: true,
    contemporary: true,
  },
};

/**
 * Verified backup IDs used strictly as a last-resort safety net if live search
 * pagination temporarily errors, ensuring the gallery never gets stuck blank.
 */
export const VERIFIED_FALLBACK_IDS = {
  aic: [
    { id: 16568, category: 'paintings', era: 'modern' },               // Monet, Water Lilies (1906)
    { id: 27992, category: 'paintings', era: 'realism-impressionism' }, // Seurat, A Sunday on La Grande Jatte (1884)
    { id: 28560, category: 'paintings', era: 'realism-impressionism' }, // Van Gogh, The Bedroom (1889)
    { id: 111628, category: 'paintings', era: 'modern' },              // Hopper, Nighthawks (1942)
    { id: 24645, category: 'works-on-paper', era: null },              // Hokusai, The Great Wave (Edo Japan, 1831)
  ],
  met: [
    { id: 436524, category: 'paintings', era: 'realism-impressionism' }, // Van Gogh, Sunflowers (1887)
    { id: 436528, category: 'paintings', era: 'realism-impressionism' }, // Van Gogh, Irises (1890)
    { id: 437133, category: 'paintings', era: 'realism-impressionism' }, // Leutze, Washington Crossing the Delaware (1851)
    { id: 547802, category: 'artifacts', era: 'ancient' },               // The Temple of Dendur (c. 15 BCE)
  ],
};

export const RECENT_HISTORY_LIMIT = 80;
export const IDLE_TIMEOUT_MS = 3600;
export const MAX_SKIPS_PER_HOUR = 5;
export const SKIP_COOLDOWN_MS = 2000;
export const FILTER_APPLY_COOLDOWN_MS = 3000;
export const AIC_RATE_LIMIT_COOLDOWN_MS = 60_000;


