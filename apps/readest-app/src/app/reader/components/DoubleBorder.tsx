interface DoubleBorderProps {
  borderColor: string;
  horizontalGap: number;
  verticalMargin: number;
}

const paddingPx = 10;

const DoubleBorder: React.FC<DoubleBorderProps> = ({
  borderColor,
  horizontalGap,
  verticalMargin,
}) => {
  return (
    <>
      <div
        className={'borderframe pointer-events-none absolute'}
        style={{
          border: `4px solid ${borderColor}`,
          height: `calc(100% - ${verticalMargin * 2}px + ${paddingPx * 2}px)`,
          top: `calc(${verticalMargin}px - ${paddingPx}px)`,
          left: `calc(${horizontalGap * 2}% - 32px - ${paddingPx}px)`,
          right: `calc(${horizontalGap * 2}% - 32px - ${paddingPx}px)`,
        }}
      ></div>
      <div
        className={'borderframe pointer-events-none absolute'}
        style={{
          border: `1px solid ${borderColor}`,
          height: `calc(100% - ${verticalMargin * 2}px)`,
          top: `${verticalMargin}px`,
          left: `${horizontalGap * 2}%`,
          right: `${horizontalGap * 2}%`,
        }}
      />
      <div
        className={'borderframe pointer-events-none absolute'}
        style={{
          border: `1px solid ${borderColor}`,
          width: '32px',
          height: `calc(100% - ${verticalMargin * 2}px)`,
          top: `${verticalMargin}px`,
          left: `calc(${horizontalGap * 2}% - 32px)`,
          borderRight: 'none',
        }}
      />
      <div
        className={'borderframe pointer-events-none absolute'}
        style={{
          border: `1px solid ${borderColor}`,
          width: '32px',
          height: `calc(100% - ${verticalMargin * 2}px)`,
          top: `${verticalMargin}px`,
          left: `calc(100% - ${horizontalGap * 2}%)`,
          borderLeft: 'none',
        }}
      />
    </>
  );
};

export default DoubleBorder;
