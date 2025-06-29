import { IoChevronBack, IoChevronForward } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';

interface PlanNavigationProps {
  currentPlanIndex: number;
  totalPlans: number;
  onPlanSwipe: (direction: 'left' | 'right') => void;
}

const PlanNavigation: React.FC<PlanNavigationProps> = ({
  currentPlanIndex,
  totalPlans,
  onPlanSwipe,
}) => {
  const _ = useTranslation();

  return (
    <div className='border-b bg-gray-50 px-6 py-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-lg font-semibold'>{_('Available Plans')}</h3>
        <div className='flex items-center space-x-2'>
          <button
            onClick={() => onPlanSwipe('right')}
            disabled={currentPlanIndex === 0}
            className='rounded-lg p-1 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50'
          >
            <IoChevronBack className='h-5 w-5' />
          </button>
          <span className='text-sm text-gray-600'>
            {_('{{current}} of {{all}}', {
              current: currentPlanIndex + 1,
              all: totalPlans,
            })}
          </span>
          <button
            onClick={() => onPlanSwipe('left')}
            disabled={currentPlanIndex === totalPlans - 1}
            className='rounded-lg p-1 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50'
          >
            <IoChevronForward className='h-5 w-5' />
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlanNavigation;
