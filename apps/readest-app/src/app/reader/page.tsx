'use client';

import { useAppUrlIngress } from '@/hooks/useAppUrlIngress';
import { useOpenWithBooks } from '@/hooks/useOpenWithBooks';
import { useOpenAnnotationLink } from '@/hooks/useOpenAnnotationLink';
import Reader from './components/Reader';

// This is only used for the Tauri app in the app router
export default function Page() {
  useAppUrlIngress();
  useOpenWithBooks();
  useOpenAnnotationLink();

  return <Reader />;
}
