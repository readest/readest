import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import StatusBadge from '@/app/library/components/StatusBadge';

describe('StatusBadge', () => {
  it('renders children for the abandoned status', () => {
    const { queryByText } = render(<StatusBadge status='abandoned'>On hold</StatusBadge>);
    expect(queryByText('On hold')).not.toBeNull();
  });

  it('renders nothing for the reading status', () => {
    const { container } = render(<StatusBadge status='reading'>x</StatusBadge>);
    expect(container.firstChild).toBeNull();
  });
});
