import { renderSVG } from 'uqr';

export const getQRCodeDataUrl = (value: string) =>
  `data:image/svg+xml,${encodeURIComponent(renderSVG(value, { ecc: 'M', border: 4 }))}`;

/** Dark-on-light with a quiet zone so it stays scannable under dark and e-ink themes. */
const QRCode = ({ value }: { value: string }) => (
  <img
    // eslint-disable-next-line @next/next/no-img-element
    src={getQRCodeDataUrl(value)}
    alt={value}
    className='mx-auto aspect-square w-full max-w-60'
  />
);

export default QRCode;
