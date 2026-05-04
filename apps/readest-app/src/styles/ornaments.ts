export type OrnamentStyle = 'gothic' | 'arcane' | 'celestial' | 'elegant' | 'scifi' | 'art-deco';

export type OrnamentVariant = 'corner' | 'divider' | 'divider2' | 'ornament';

export interface OrnamentSet {
  style: OrnamentStyle;
  label: string;
  corner: string;
  divider: string;
  divider2: string;
  ornament: string;
}

const ORNAMENT_BASE = '/citadel/ornaments';

export const ORNAMENT_SETS: Record<OrnamentStyle, OrnamentSet> = {
  gothic: {
    style: 'gothic',
    label: 'Gothic',
    corner: `${ORNAMENT_BASE}/gothic/Gothic_corner.png`,
    divider: `${ORNAMENT_BASE}/gothic/Gothic_divider.png`,
    divider2: `${ORNAMENT_BASE}/gothic/Gothic_divider_2.png`,
    ornament: `${ORNAMENT_BASE}/gothic/Gothic_ornament.png`,
  },
  arcane: {
    style: 'arcane',
    label: 'Arcane',
    corner: `${ORNAMENT_BASE}/arcane/Arcane_corner.png`,
    divider: `${ORNAMENT_BASE}/arcane/Arcane_divider.png`,
    divider2: `${ORNAMENT_BASE}/arcane/Arcane_divider_2.png`,
    ornament: `${ORNAMENT_BASE}/arcane/Arcane_ornament.png`,
  },
  celestial: {
    style: 'celestial',
    label: 'Celestial',
    corner: `${ORNAMENT_BASE}/celestial/Celestial_corner.png`,
    divider: `${ORNAMENT_BASE}/celestial/Celestial_divider.png`,
    divider2: `${ORNAMENT_BASE}/celestial/Celestial_divider_2.png`,
    ornament: `${ORNAMENT_BASE}/celestial/Celestial_ornamental.png`,
  },
  elegant: {
    style: 'elegant',
    label: 'Elegant',
    corner: `${ORNAMENT_BASE}/elegant/Elegant_corner.png`,
    divider: `${ORNAMENT_BASE}/elegant/Elegant_divider.png`,
    divider2: `${ORNAMENT_BASE}/elegant/Elegant_divider_2.png`,
    ornament: `${ORNAMENT_BASE}/elegant/Elegant_ornament.png`,
  },
  scifi: {
    style: 'scifi',
    label: 'Sci-Fi',
    corner: `${ORNAMENT_BASE}/scifi/Futuristic_corner.png`,
    divider: `${ORNAMENT_BASE}/scifi/Futuristic_divider.png`,
    divider2: `${ORNAMENT_BASE}/scifi/Futuristic_divider_2.png`,
    ornament: `${ORNAMENT_BASE}/scifi/Futuristic_ornament.png`,
  },
  'art-deco': {
    style: 'art-deco',
    label: 'Art Deco',
    corner: '', // No corner asset in Art Deco set
    divider: `${ORNAMENT_BASE}/art-deco/ArtDeco_divider.png`,
    divider2: `${ORNAMENT_BASE}/art-deco/ArtDeco_divider_2.png`,
    ornament: `${ORNAMENT_BASE}/art-deco/ArtDeco_divider_3.png`,
  },
};

export function getOrnamentSet(style: OrnamentStyle): OrnamentSet {
  return ORNAMENT_SETS[style];
}

export function getOrnamentAsset(style: OrnamentStyle, variant: OrnamentVariant): string {
  return ORNAMENT_SETS[style]?.[variant] ?? '';
}
