import { renderSVG } from 'uqr';

/** Dark-on-light with a quiet zone so it stays scannable under dark and e-ink themes. */
const QRCode = ({ value }: { value: string }) => (
  <img
    // eslint-disable-next-line @next/next/no-img-element
    src={`data:image/svg+xml,${encodeURIComponent(renderSVG(value, { ecc: 'M', border: 4 }))}`}
    alt={value}
    className='mx-auto aspect-square w-full max-w-60'
  />
);

export default QRCode;
