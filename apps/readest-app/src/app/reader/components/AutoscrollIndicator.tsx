import clsx from 'clsx';
import React from 'react';
import { AutoscrollAnchor } from '../hooks/useMiddleClickAutoscroll';

// The anchor marker shown while middle-click autoscroll is engaged: a circle
// with arrows along the scroll axis, akin to the browsers' autoscroll bullet.
const AutoscrollIndicator: React.FC<{ anchor: AutoscrollAnchor }> = ({ anchor }) => (
  <div
    aria-hidden='true'
    className='pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2'
    style={{ left: anchor.left, top: anchor.top }}
  >
    <svg
      width='30'
      height='30'
      viewBox='0 0 30 30'
      className={clsx('text-base-content', anchor.axis === 'x' && 'rotate-90')}
    >
      <circle
        cx='15'
        cy='15'
        r='13.5'
        className='fill-base-100'
        fillOpacity='0.85'
        stroke='currentColor'
        strokeWidth='1'
      />
      <path d='M15 4.5 L18.5 10 h-7 Z' fill='currentColor' />
      <path d='M15 25.5 L18.5 20 h-7 Z' fill='currentColor' />
      <circle cx='15' cy='15' r='2' fill='currentColor' />
    </svg>
  </div>
);

export default AutoscrollIndicator;
