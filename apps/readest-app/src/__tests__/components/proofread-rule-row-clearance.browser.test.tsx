import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Toggle } from '@/components/primitives/toggle';
import { RiEditLine, RiDeleteBin7Line } from 'react-icons/ri';
import { MdOutlineArrowOutward } from 'react-icons/md';

await import('@/styles/globals.css');

afterEach(cleanup);

/**
 * The rule row parks its action cluster absolutely and reserves the width with
 * end padding on the pattern text. A selection rule carries one extra button
 * (Jump to Location), so the two have to be measured, not guessed.
 */
const Row: React.FC<{ withJump: boolean }> = ({ withJump }) => (
  <div className='relative flex items-start justify-between gap-3 p-3' style={{ width: 380 }}>
    <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
      <div
        data-testid='pattern'
        className={`break-words font-medium leading-snug ${withJump ? 'pe-36' : 'pe-28'}`}
      >
        a-very-long-pattern-that-would-run-under-the-buttons
      </div>
    </div>
    <div data-testid='actions' className='absolute end-2 top-2 flex items-center gap-1'>
      <Toggle className='toggle-sm' checked readOnly />
      {withJump && (
        <button className='btn btn-ghost btn-sm h-8 w-8 p-0'>
          <MdOutlineArrowOutward className='h-4 w-4' />
        </button>
      )}
      <button className='btn btn-ghost btn-sm h-8 w-8 p-0'>
        <RiEditLine className='h-4 w-4' />
      </button>
      <button className='btn btn-ghost btn-sm h-8 w-8 p-0'>
        <RiDeleteBin7Line className='h-4 w-4' />
      </button>
    </div>
  </div>
);

describe('proofread rule row', () => {
  for (const withJump of [false, true]) {
    it(`reserves enough room for the action cluster (jump button: ${withJump})`, () => {
      const { getByTestId } = render(<Row withJump={withJump} />);
      const pattern = getByTestId('pattern').getBoundingClientRect();
      const actions = getByTestId('actions').getBoundingClientRect();
      const padding = parseFloat(getComputedStyle(getByTestId('pattern')).paddingRight);
      const contentRight = pattern.right - padding;

      expect(contentRight, 'the pattern text must stop before the buttons').toBeLessThanOrEqual(
        actions.left,
      );
    });
  }
});
