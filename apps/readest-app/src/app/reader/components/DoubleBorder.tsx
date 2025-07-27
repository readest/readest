import { Insets } from '@/types/misc';

interface DoubleBorderProps {
  borderColor: string;
  horizontalGap: number;
  showHeader: boolean;
  showFooter: boolean;
  insets: Insets;
}

const paddingPx = 10;

const DoubleBorder: React.FC<DoubleBorderProps> = ({
  borderColor,
  showHeader,
  showFooter,
  insets,
}) => {
  return (
    <div>
      {/* outter frame */}
      <div
        className={'borderframe pointer-events-none absolute'}
        style={{
          border: `4px solid ${borderColor}`,
          height: `calc(100% - ${insets.top + insets.bottom}px + ${paddingPx * 2}px)`,
          top: `calc(${insets.top}px - ${paddingPx}px)`,
          left: `calc(${insets.left}px - ${paddingPx}px)`,
          right: `calc(${insets.right}px - ${paddingPx}px)`,
        }}
      ></div>
      {/* inner frame */}
      <div
        className={'borderframe pointer-events-none absolute'}
        style={{
          border: `1px solid ${borderColor}`,
          height: `calc(100% - ${insets.top + insets.bottom}px)`,
          top: `${insets.top}px`,
          left: `calc(${insets.left + (showFooter ? 32 : 0)}px`,
          right: `calc(${insets.right + (showHeader ? 32 : 0)}px`,
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
            height: `calc(100% - ${insets.top + insets.bottom}px)`,
            top: `${insets.top}px`,
            left: `calc(${insets.left}px)`,
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
            height: `calc(100% - ${insets.top + insets.bottom}px)`,
            top: `${insets.top}px`,
            left: `calc(100% - ${insets.right}px - 32px)`,
          }}
        />
      )}
    </div>
  );
};

export default DoubleBorder;
