import React from 'react';
import { LuUsers } from 'react-icons/lu';

import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useCharacterUiStore } from '@/store/characterUiStore';
import Button from '@/components/Button';

interface CharacterListTogglerProps {
  bookKey: string;
}

const CharacterListToggler: React.FC<CharacterListTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const iconSize18 = useResponsiveSize(18);
  const openCharacterList = useCharacterUiStore((state) => state.openCharacterList);

  return (
    <Button
      icon={<LuUsers size={iconSize18} className='text-base-content' />}
      onClick={() => openCharacterList(bookKey)}
      label={_('Characters')}
    ></Button>
  );
};

export default CharacterListToggler;
