import * as React from 'react';

const Toggle = React.forwardRef<
  React.ComponentRef<'input'>,
  React.ComponentPropsWithoutRef<'input'>
>(({ className, ...props }, ref) => (
  <input ref={ref} type='checkbox' className='toggle' {...props} />
));

export { Toggle };
