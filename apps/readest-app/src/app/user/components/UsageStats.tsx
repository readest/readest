import Quota from '@/components/Quota';
import { QuotaType } from '@/types/user';

interface UsageStatsProps {
  quotas: QuotaType[];
}

const UsageStats: React.FC<UsageStatsProps> = ({ quotas }) => (
  <div className='rounded-lg'>
    <div className='p-0'>
      {quotas && quotas.length > 0 ? (
        <Quota quotas={quotas} showProgress className='space-y-4' labelClassName='pl-4 pr-2' />
      ) : (
        <div className='h-10 animate-pulse'></div>
      )}
    </div>
  </div>
);

export default UsageStats;
