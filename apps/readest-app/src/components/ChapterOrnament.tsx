'use client';

import React from 'react';
import Image from 'next/image';
import { getOrnamentAsset, type OrnamentStyle } from '@/styles/ornaments';
import { getHouseForCharacter, extractCharacterFromChapterTitle } from '@/data/got-houses';

interface ChapterOrnamentProps {
  /** Chapter title text, used for character extraction in GOT books */
  chapterTitle?: string;
  /** The ornament style to use */
  ornamentStyle: OrnamentStyle;
  /** Whether to attempt sigil display for GOT-style books */
  useSigils?: boolean;
  /** Width of the divider ornament in px */
  dividerWidth?: number;
  /** Height of the sigil in px */
  sigilHeight?: number;
  /** Additional CSS class */
  className?: string;
}

/**
 * Chapter ornament divider component.
 * Renders an ornamental divider below the chapter title.
 * When useSigils is true and the chapter title matches a GOT POV character,
 * the character's house sigil is displayed centered in the divider.
 */
const ChapterOrnament: React.FC<ChapterOrnamentProps> = ({
  chapterTitle,
  ornamentStyle,
  useSigils = false,
  dividerWidth = 220,
  sigilHeight = 48,
  className = '',
}) => {
  const dividerAsset = getOrnamentAsset(ornamentStyle, 'divider');

  const houseInfo =
    useSigils && chapterTitle
      ? (() => {
          const character = extractCharacterFromChapterTitle(chapterTitle);
          return character ? getHouseForCharacter(character) : null;
        })()
      : null;

  return (
    <div className={`citadel-chapter-ornament-wrapper ${className}`} aria-hidden='true'>
      {/* Divider line ornament */}
      {dividerAsset && (
        <div className='flex items-center justify-center'>
          <Image
            src={dividerAsset}
            alt=''
            width={dividerWidth}
            height={16}
            className='h-auto w-auto opacity-80'
            style={{
              maxWidth: 'min(12rem, 42%)',
              filter: 'brightness(0.86) sepia(0.2) saturate(0.8)',
            }}
            draggable={false}
          />
        </div>
      )}

      {/* Sigil — displayed between divider and ornament if available */}
      {houseInfo && (
        <div className='flex items-center justify-center py-1'>
          <Image
            src={houseInfo.sigilPath}
            alt={`${houseInfo.name} sigil — ${houseInfo.sigil}`}
            width={sigilHeight}
            height={sigilHeight}
            className='h-auto w-auto opacity-90'
            style={{
              maxHeight: sigilHeight,
              filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5)) brightness(0.92) sepia(0.15)',
            }}
            draggable={false}
          />
        </div>
      )}

      {/* Bottom ornament */}
      {dividerAsset && (
        <div
          className='flex items-center justify-center'
          style={{ marginTop: houseInfo ? 0 : undefined }}
        >
          <Image
            src={getOrnamentAsset(ornamentStyle, 'ornament') || dividerAsset}
            alt=''
            width={dividerWidth}
            height={16}
            className='h-auto w-auto opacity-70'
            style={{
              maxWidth: 'min(8rem, 28%)',
              filter: 'brightness(0.86) sepia(0.2) saturate(0.8)',
            }}
            draggable={false}
          />
        </div>
      )}
    </div>
  );
};

export default ChapterOrnament;
