import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Account & Sign In',
  description:
    'Sign in to your Citadel account or manage your subscription, cloud library storage, and account settings.',
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
