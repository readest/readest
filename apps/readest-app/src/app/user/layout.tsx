import { Metadata } from 'next';
import LocalOnlyRouteGuard from '@/components/LocalOnlyRouteGuard';

export const metadata: Metadata = {
  title: 'Account & Sign In',
  description:
    'Sign in to your Readest account or manage your subscription, cloud library storage, and account settings.',
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <LocalOnlyRouteGuard>{children}</LocalOnlyRouteGuard>;
}
