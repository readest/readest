import { IconBaseProps } from 'react-icons';
import { GenIcon } from 'react-icons/lib';

export function HighlighterIcon({
  tipColor = '#FFD700',
  tipStyle = {},
  ...props
}: IconBaseProps & { tipColor?: string; tipStyle?: React.CSSProperties }) {
  return GenIcon({
    tag: 'svg',
    attr: {
      viewBox: '0 0 256 256',
      fill: 'none',
    },
    child: [
      {
        tag: 'path',
        attr: {
          d: 'M253.66,106.34a8,8,0,0,0-11.32,0L192,156.69,107.31,72l50.35-50.34a8,8,0,1,0-11.32-11.32L96,60.69A16,16,0,0,0,93.18,79.5L72,100.69a16,16,0,0,0,0,22.62L76.69,128,136,187.31l4.69,4.69a16,16,0,0,0,22.62,0l21.18-21.18A16,16,0,0,0,203.31,168l50.35-50.34A8,8,0,0,0,253.66,106.34ZM152,180.69,83.31,112,104,91.31,172.69,160Z',
          fill: 'currentColor',
        },
        child: [],
      },
      {
        tag: 'path',
        attr: {
          d: 'M18.34,186.34c-4.209212,4.20621-2.516471,11.37196,3.13,13.25l72,24c0.815308,0.27382,1.669943,0.41232,2.53,0.41c2.12237,0.002,4.15842-0.84009,5.66-2.34L136,187.31c13.62143,13.61626-70.243446-70.24754-64-64l4.69,4.69z',
          fill: tipColor,
          style: tipStyle as unknown as string,
        },
        child: [],
      },
    ],
  })(props);
}
