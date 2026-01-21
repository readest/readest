import React from 'react';

import { Insets } from '@/types/misc';
import { TOCItem } from '@/libs/document';
import { useTranslation } from '@/hooks/useTranslation';
import { useBooknotesNav } from '../../hooks/useBooknotesNav';
import ContentNavBar from './ContentNavBar';

interface BooknotesNavProps {
  bookKey: string;
  gridInsets: Insets;
  toc: TOCItem[];
}

const BooknotesNav: React.FC<BooknotesNavProps> = ({ bookKey, gridInsets, toc }) => {
  const {
    activeBooknoteType,
    currentSection,
    showBooknotesNav,
    hasPreviousPage,
    hasNextPage,
    handleShowResults,
    handleClose,
    handlePrevious,
    handleNext,
  } = useBooknotesNav(bookKey, toc);
  const _ = useTranslation();

  if (!showBooknotesNav) {
    return null;
  }

  const getShowResultsTitle = () => {
    switch (activeBooknoteType) {
      case 'bookmark':
        return _('Bookmarks');
      case 'annotation':
        return _('Annotations');
      case 'excerpt':
        return _('Excerpts');
      default:
        return '';
    }
  };

  return (
    <ContentNavBar
      bookKey={bookKey}
      gridInsets={gridInsets}
      title={getShowResultsTitle()}
      section={currentSection}
      hasPrevious={hasPreviousPage}
      hasNext={hasNextPage}
      progress={1}
      previousTitle={_('Previous')}
      nextTitle={_('Next')}
      showResultsTitle={getShowResultsTitle()}
      closeTitle={_('Close')}
      onShowResults={handleShowResults}
      onClose={handleClose}
      onPrevious={handlePrevious}
      onNext={handleNext}
    />
  );
};

export default BooknotesNav;
