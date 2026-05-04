export interface HouseInfo {
  name: string;
  sigil: string;
  sigilPath: string;
  words: string;
}

export const SIGILS_BASE = '/citadel/sigils';

export const HOUSES: Record<string, HouseInfo> = {
  stark: {
    name: 'Stark',
    sigil: 'Direwolf',
    sigilPath: `${SIGILS_BASE}/Stark.png`,
    words: 'Winter is Coming',
  },
  lannister: {
    name: 'Lannister',
    sigil: 'Lion',
    sigilPath: `${SIGILS_BASE}/Lannister.png`,
    words: 'Hear Me Roar!',
  },
  targaryen: {
    name: 'Targaryen',
    sigil: 'Dragon',
    sigilPath: `${SIGILS_BASE}/Targaryen.png`,
    words: 'Fire and Blood',
  },
  baratheon: {
    name: 'Baratheon',
    sigil: 'Stag',
    sigilPath: `${SIGILS_BASE}/Baratheon.png`,
    words: 'Ours is the Fury',
  },
  greyjoy: {
    name: 'Greyjoy',
    sigil: 'Kraken',
    sigilPath: `${SIGILS_BASE}/Greyjoy.png`,
    words: 'We Do Not Sow',
  },
  arryn: {
    name: 'Arryn',
    sigil: 'Falcon',
    sigilPath: `${SIGILS_BASE}/Arryn.png`,
    words: 'As High as Honor',
  },
  tully: {
    name: 'Tully',
    sigil: 'Trout',
    sigilPath: `${SIGILS_BASE}/Tully.png`,
    words: 'Family, Duty, Honor',
  },
  tyrell: {
    name: 'Tyrell',
    sigil: 'Rose',
    sigilPath: `${SIGILS_BASE}/Tyrell.png`,
    words: 'Growing Strong',
  },
  martell: {
    name: 'Martell',
    sigil: 'Sun and Spear',
    sigilPath: `${SIGILS_BASE}/Martel.png`,
    words: 'Unbowed, Unbent, Unbroken',
  },
  seaworth: {
    name: 'Seaworth',
    sigil: 'Onion Ship',
    sigilPath: `${SIGILS_BASE}/Seaworth.png`,
    words: '',
  },
  mormont: {
    name: 'Mormont',
    sigil: 'Bear',
    sigilPath: `${SIGILS_BASE}/Mormont.png`,
    words: 'Here We Stand',
  },
  clegane: {
    name: 'Clegane',
    sigil: 'Three Dogs',
    sigilPath: `${SIGILS_BASE}/Clagane.png`,
    words: '',
  },
  hightower: {
    name: 'Hightower',
    sigil: 'Tower',
    sigilPath: `${SIGILS_BASE}/Hightower.png`,
    words: 'We Light the Way',
  },
  hunter: {
    name: 'Hunter',
    sigil: 'Arrows',
    sigilPath: `${SIGILS_BASE}/Hunter.png`,
    words: '',
  },
  starfall: {
    name: 'Dayne',
    sigil: 'Falling Star',
    sigilPath: `${SIGILS_BASE}/Starfall.png`,
    words: '',
  },
};

/**
 * POV character → house key mapping for A Song of Ice and Fire.
 * Chapter title matching is done case-insensitively against character names.
 */
export const CHARACTER_HOUSE_MAP: Record<string, string> = {
  // Starks & allies
  eddard: 'stark',
  'eddard stark': 'stark',
  ned: 'stark',
  'ned stark': 'stark',
  catelyn: 'tully',
  'catelyn stark': 'tully',
  'catelyn tully': 'tully',
  robb: 'stark',
  'robb stark': 'stark',
  sansa: 'stark',
  'sansa stark': 'stark',
  arya: 'stark',
  'arya stark': 'stark',
  bran: 'stark',
  'bran stark': 'stark',
  rickon: 'stark',
  'rickon stark': 'stark',
  jon: 'stark',
  'jon snow': 'stark',

  // Lannisters & allies
  tyrion: 'lannister',
  'tyrion lannister': 'lannister',
  jaime: 'lannister',
  'jaime lannister': 'lannister',
  cersei: 'lannister',
  'cersei lannister': 'lannister',
  tywin: 'lannister',
  'tywin lannister': 'lannister',
  kevan: 'lannister',
  'kevan lannister': 'lannister',

  // Targaryens
  daenerys: 'targaryen',
  'daenerys targaryen': 'targaryen',
  dany: 'targaryen',
  viserys: 'targaryen',
  'viserys targaryen': 'targaryen',
  aegon: 'targaryen',

  // Baratheons
  robert: 'baratheon',
  'robert baratheon': 'baratheon',
  stannis: 'baratheon',
  'stannis baratheon': 'baratheon',
  renly: 'baratheon',
  'renly baratheon': 'baratheon',
  davos: 'seaworth',
  'davos seaworth': 'seaworth',

  // Greyjoys
  theon: 'greyjoy',
  'theon greyjoy': 'greyjoy',
  asha: 'greyjoy',
  'asha greyjoy': 'greyjoy',
  victarion: 'greyjoy',
  'victarion greyjoy': 'greyjoy',
  aeron: 'greyjoy',
  'aeron greyjoy': 'greyjoy',

  // Arryns
  'robert arryn': 'arryn',
  lysa: 'arryn',
  'lysa arryn': 'arryn',

  // Tyrells
  margaery: 'tyrell',
  'margaery tyrell': 'tyrell',
  loras: 'tyrell',
  'loras tyrell': 'tyrell',
  olenna: 'tyrell',
  'olenna tyrell': 'tyrell',

  // Martells
  oberyn: 'martell',
  'oberyn martell': 'martell',
  doran: 'martell',
  'doran martell': 'martell',
  arianne: 'martell',
  'arianne martell': 'martell',
  quentyn: 'martell',
  'quentyn martell': 'martell',
  areo: 'martell',
  'areo hotah': 'martell',

  // Minor houses
  brienne: 'tarth',
  'brienne of tarth': 'tarth',
  samwell: 'tarly',
  'samwell tarly': 'tarly',
  jorah: 'mormont',
  'jorah mormont': 'mormont',
  sandor: 'clegane',
  'sandor clegane': 'clegane',
  gregor: 'clegane',
  'gregor clegane': 'clegane',

  // Prologue/epilogue characters
  will: 'stark', // Night's Watch ranger
  chett: 'stark', // Night's Watch
  pate: 'hightower', // Citadel novice
  'maester cressen': 'baratheon',
  varys: 'targaryen',
  merrett: 'frey',
  'merrett frey': 'frey',
};

export function getHouseKey(characterName: string): string | null {
  const normalized = characterName.toLowerCase().trim();
  return CHARACTER_HOUSE_MAP[normalized] ?? null;
}

export function getHouseInfo(houseKey: string): HouseInfo | null {
  return HOUSES[houseKey] ?? null;
}

export function getHouseForCharacter(characterName: string): HouseInfo | null {
  const houseKey = getHouseKey(characterName);
  if (!houseKey) return null;
  return getHouseInfo(houseKey);
}

/** Try to extract a character name from a chapter title string. */
export function extractCharacterFromChapterTitle(title: string): string | null {
  const cleaned = title.replace(/^(chapter|ch\.?)\s*\d+[:\-–—\s]+/i, '').trim();

  // Try full match first
  const normalized = cleaned.toLowerCase();
  if (CHARACTER_HOUSE_MAP[normalized]) return cleaned;

  // Try partial: check each known character name
  for (const charName of Object.keys(CHARACTER_HOUSE_MAP)) {
    if (normalized.includes(charName)) {
      return charName;
    }
  }

  return null;
}
