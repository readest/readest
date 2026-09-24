import { useEffect, useState } from 'react';
import { FoliateView } from '@/types/view';
import { useTranslation } from '@/hooks/useTranslation';
import { openExternalUrl } from '@/utils/open';
import ModalPortal from '@/components/ModalPortal';
import Alert from '@/components/Alert';

// foliate opens an external link itself unless its cancelable `external-link`
// event is prevented. Hold the link behind a confirmation so a stray tap while
// reading doesn't throw the reader out to the browser (#6199).
const ExternalLinkConfirm: React.FC<{ view: FoliateView | null }> = ({ view }) => {
  const _ = useTranslation();
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    if (!view) return;
    const handleExternalLink = (e: Event) => {
      e.preventDefault();
      setHref((e as CustomEvent<{ href: string }>).detail.href);
    };
    view.addEventListener('external-link', handleExternalLink);
    return () => view.removeEventListener('external-link', handleExternalLink);
  }, [view]);

  if (!href) return null;

  return (
    <ModalPortal>
      <Alert
        title={_('Open External Link')}
        message={href}
        confirmLabel={_('Open')}
        confirmButtonClassName='btn-contrast'
        onCancel={() => setHref(null)}
        onConfirm={() => {
          setHref(null);
          openExternalUrl(href);
        }}
      />
    </ModalPortal>
  );
};

export default ExternalLinkConfirm;
