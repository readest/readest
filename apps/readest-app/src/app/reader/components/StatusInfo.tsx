import React from 'react';
import clsx from 'clsx';
import { useCurrentTime } from '../hooks/useCurrentTime';
import { useCurrentBatteryStatus } from '../hooks/useCurrentBattery';

interface StatusInfoProps {
  showTime: boolean;
  showBattery: boolean;
  showBatteryPercentage: boolean;
  use24Hour?: boolean;
  isVertical?: boolean;
  isEink?: boolean;
  className?: string;
  /** A custom header/footer text color is set: the percentage inherits it. */
  inheritTextColor?: boolean;
  /** Backdrop for the scrolled-mode pill; see ProgressBar. */
  style?: React.CSSProperties;
}

const StatusInfo: React.FC<StatusInfoProps> = ({
  showTime,
  use24Hour = true,
  showBattery,
  showBatteryPercentage,
  isVertical,
  isEink,
  className,
  inheritTextColor,
  style,
}) => {
  const formattedTime = useCurrentTime(showTime, use24Hour);
  const batteryLevel = useCurrentBatteryStatus(showBattery);

  if (!showTime && !showBattery) return null;

  const fillWidth = ((batteryLevel ?? 0) / 100) * 21;
  // Drawn in the icon's own coordinates: the baseline sits half of Inter's cap
  // height (0.7275em) below the body's middle (y 6), so the digits center on
  // the body whatever ascent and descent the engine reads. A line box centered
  // in the icon followed those metrics, up to a pixel high in CEF on Linux.
  const renderPercentage = (colorClass?: string) => (
    <text
      x='11'
      y='8.9'
      textAnchor='middle'
      fill='currentColor'
      className={clsx(
        'battery-percentage text-[8px] font-medium',
        colorClass,
        isVertical && '[writing-mode:horizontal-tb]',
      )}
    >
      {batteryLevel}
    </text>
  );

  return (
    <div
      className={clsx(
        'status-bar flex shrink-0 items-center gap-2 whitespace-nowrap tabular-nums',
        isVertical ? 'my-auto' : 'flex-row',
        className,
      )}
      style={style}
    >
      {showTime && <span>{formattedTime}</span>}
      {showBattery && batteryLevel !== null && (
        <span
          className={clsx(
            'relative inline-flex items-center justify-center',
            isVertical ? 'my-[6.5px] rotate-90' : 'translate-y-[-0.5px]',
          )}
        >
          <svg width='25' height='12' viewBox='0 0 25 12' fill='none'>
            <rect
              x='0.5'
              y='0.5'
              width='21'
              height='11'
              rx='2'
              stroke='currentColor'
              strokeWidth='1'
              opacity={isEink ? 1.0 : 0.75}
            />
            <rect
              x='0.5'
              y='0.5'
              width={fillWidth}
              height='11'
              rx='1'
              fill='currentColor'
              opacity={isEink ? 1.0 : 0.3}
            />
            <path
              d='M23 4V8C23.8 8 24 7 24 6C24 5 23.8 4 23 4Z'
              fill='currentColor'
              opacity={isEink ? 1.0 : 0.75}
            />
            {/* The fill behind the number is currentColor at 30% opacity -- a
                mid tone in any theme, which themed text reads against. In eink
                the fill is opaque base-content but covers only the charged
                part, so a page-colored copy clipped to the fill (the nested
                svg ends where the fill does) is knocked out of it while the
                rest of the number stays base-content. */}
            {showBatteryPercentage &&
              renderPercentage(inheritTextColor && !isEink ? undefined : 'text-base-content')}
            {showBatteryPercentage && isEink && (
              <svg width={(0.5 + fillWidth).toFixed(2)} height='12' overflow='hidden'>
                {renderPercentage('text-base-100')}
              </svg>
            )}
          </svg>
        </span>
      )}
    </div>
  );
};

export default StatusInfo;
