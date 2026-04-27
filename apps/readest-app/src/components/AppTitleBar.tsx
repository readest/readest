import clsx from 'clsx';
import React from 'react';

interface AppTitleBarProps {
  headerRef?: React.RefObject<HTMLDivElement | null>;
  style?: React.CSSProperties;
  className?: string;
  contentClassName?: string;
  leftContent?: React.ReactNode;
  centerContent?: React.ReactNode;
  rightContent?: React.ReactNode;
  leftClassName?: string;
  centerClassName?: string;
  rightClassName?: string;
}

const AppTitleBar: React.FC<AppTitleBarProps> = ({
  headerRef,
  style,
  className,
  contentClassName,
  leftContent,
  centerContent,
  rightContent,
  leftClassName,
  centerClassName,
  rightClassName,
}) => {
  return (
    <div
      ref={headerRef}
      className={clsx(
        'titlebar z-10 flex h-[52px] w-full items-center py-2 pr-4 sm:h-[48px]',
        'bg-base-100/90 border-b border-[var(--citadel-line-gold)] shadow-[var(--citadel-shadow-soft)] backdrop-blur-sm',
        'dark:border-[var(--citadel-line-gold)] dark:bg-[color-mix(in_srgb,var(--citadel-bg-dark)_88%,transparent)] dark:backdrop-blur-sm',
        className,
      )}
      style={style}
    >
      <div
        className={clsx(
          'flex w-full items-center justify-between gap-4 sm:gap-8',
          contentClassName,
        )}
      >
        {leftContent && (
          <div className={clsx('flex items-center', leftClassName)}>{leftContent}</div>
        )}
        {centerContent && (
          <div className={clsx('flex min-w-0 flex-1 items-center', centerClassName)}>
            {centerContent}
          </div>
        )}
        {rightContent && (
          <div className={clsx('flex items-center justify-end', rightClassName)}>
            {rightContent}
          </div>
        )}
      </div>
    </div>
  );
};

export default AppTitleBar;
