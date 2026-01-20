import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'User Account',
  description: 'Manage your account settings and subscription',
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
