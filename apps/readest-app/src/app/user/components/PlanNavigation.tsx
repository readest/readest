import { useTranslation } from '@/hooks/useTranslation';
import { PlanDetails } from '../utils/plan';

interface PlanNavigationProps {
  allPlans: PlanDetails[];
  currentPlanIndex: number;
  onSelectPlan: (index: number) => void;
}

const PlanNavigation: React.FC<PlanNavigationProps> = ({
  allPlans,
  currentPlanIndex,
  onSelectPlan,
}) => {
  const _ = useTranslation();

  return (
    <div className='bg-base-200/50 border-base-200 border-b px-6 py-4'>
      <div className='flex items-center justify-center'>
        <div
          className='bg-base-300 flex gap-2 overflow-x-auto rounded-lg p-1'
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {allPlans.map((plan, index) => (
            <button
              key={`plan-${plan.plan}-${index}`}
              onClick={() => onSelectPlan(index)}
              className={`rounded-md px-2 py-2 text-sm font-medium shadow-sm transition-colors ${
                currentPlanIndex === index ? `${plan.color}` : 'text-base-content hover:bg-base-200'
              }`}
            >
              <span className='whitespace-nowrap'>{_(plan.name)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PlanNavigation;
