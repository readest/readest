import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Reading Statistics',
  description: 'View your reading statistics and progress',
};

export default function StatisticsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
