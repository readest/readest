import { Insets } from '@/types/misc';

interface DoubleBorderProps {
  borderColor: string;
  horizontalGap: number;
  showHeader: boolean;
  showFooter: boolean;
  contentInsets: Insets;
}

const paddingPx = 10;

const DoubleBorder: React.FC<DoubleBorderProps> = ({
  borderColor,
  showHeader,
  showFooter,
  contentInsets,
}) => {
  return (
    <div>
      {/* outter frame */}
      <div
        className={'borderframe pointer-events-none absolute'}
        style={{
          border: `4px solid ${borderColor}`,
          height: `calc(100% - ${contentInsets.top + contentInsets.bottom}px + ${paddingPx * 2}px)`,
          top: `calc(${contentInsets.top}px - ${paddingPx}px)`,
          left: `calc(${contentInsets.left}px - ${paddingPx}px)`,
          right: `calc(${contentInsets.right}px - ${paddingPx}px)`,
        }}
      ></div>
      {/* inner frame */}
      <div
        className={'borderframe pointer-events-none absolute'}
        style={{
          border: `1px solid ${borderColor}`,
          height: `calc(100% - ${contentInsets.top + contentInsets.bottom}px)`,
          top: `${contentInsets.top}px`,
          left: `calc(${contentInsets.left + (showFooter ? 32 : 0)}px`,
          right: `calc(${contentInsets.right + (showHeader ? 32 : 0)}px`,
        }}
      />
      {/* footer */}
      {showFooter && (
        <div
          className={'borderframe pointer-events-none absolute'}
          style={{
            borderTop: `1px solid ${borderColor}`,
            borderBottom: `1px solid ${borderColor}`,
            borderLeft: `1px solid ${borderColor}`,
            width: '32px',
            height: `calc(100% - ${contentInsets.top + contentInsets.bottom}px)`,
            top: `${contentInsets.top}px`,
            left: `calc(${contentInsets.left}px)`,
          }}
        />
      )}
      {/* header */}
      {showHeader && (
        <div
          className={'borderframe pointer-events-none absolute'}
          style={{
            borderTop: `1px solid ${borderColor}`,
            borderBottom: `1px solid ${borderColor}`,
            borderRight: `1px solid ${borderColor}`,
            width: '32px',
            height: `calc(100% - ${contentInsets.top + contentInsets.bottom}px)`,
            top: `${contentInsets.top}px`,
            left: `calc(100% - ${contentInsets.right}px - 32px)`,
          }}
        />
      )}
    </div>
  );
};

export default DoubleBorder;
