import { Suspense } from 'react';
import LinkDevice from './LinkDevice';

export default function Page() {
  // The client child reads the code with useSearchParams, which Next 16
  // requires to be wrapped in Suspense.
  return (
    <Suspense fallback={null}>
      <LinkDevice />
    </Suspense>
  );
}
