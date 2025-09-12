import { isTauriAppPlatform } from '@/services/environment';
import { openUrl } from '@tauri-apps/plugin-opener';

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  title?: string;
}

const Link: React.FC<LinkProps> = ({ href, children, ...props }) => {
  const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isTauriAppPlatform()) {
      e.preventDefault();
      await openUrl(href);
    }
  };

  return (
    <a href={href} target='_blank' rel='noopener noreferrer' onClick={handleClick} {...props}>
      {children}
    </a>
  );
};

export default Link;
