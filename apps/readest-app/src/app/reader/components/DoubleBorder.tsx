interface DoubleBorderProps {
  borderColor: string;
  horizontalGap: number;
  verticalMargin: number;
  showHeader: boolean;
  showFooter: boolean;
}

const paddingPx = 10;

const DoubleBorder: React.FC<DoubleBorderProps> = ({
  borderColor,
  horizontalGap,
  verticalMargin,
  showHeader,
  showFooter,
}) => {
  return (
    <>
      {/* outter frame */}
      <div
        className={'borderframe pointer-events-none absolute'}
        style={{
          border: `4px solid ${borderColor}`,
          height: `calc(100% - ${verticalMargin * 2}px + ${paddingPx * 2}px)`,
          top: `calc(${verticalMargin}px - ${paddingPx}px)`,
          left: `calc(${horizontalGap}% - ${showFooter ? 32 : 0}px - ${paddingPx}px)`,
          right: `calc(${horizontalGap}% - ${showHeader ? 32 : 0}px - ${paddingPx}px)`,
        }}
      ></div>
      {/* inner frame */}
      <div
        className={'borderframe pointer-events-none absolute'}
        style={{
          border: `1px solid ${borderColor}`,
          height: `calc(100% - ${verticalMargin * 2}px)`,
          top: `${verticalMargin}px`,
          left: showFooter ? `${horizontalGap}%` : `calc(${horizontalGap}%)`,
          right: showHeader ? `${horizontalGap}%` : `calc(${horizontalGap}%)`,
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
            height: `calc(100% - ${verticalMargin * 2}px)`,
            top: `${verticalMargin}px`,
            left: `calc(${horizontalGap}% - 32px)`,
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
            height: `calc(100% - ${verticalMargin * 2}px)`,
            top: `${verticalMargin}px`,
            left: `calc(100% - ${horizontalGap}%)`,
          }}
        />
      )}
    </>
  );
};

export default DoubleBorder;
