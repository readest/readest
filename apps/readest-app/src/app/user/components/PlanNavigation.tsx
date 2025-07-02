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
        <div className='bg-base-300 flex items-center space-x-1 rounded-lg p-1'>
          {allPlans.map((plan, index) => (
            <button
              key={plan.name}
              onClick={() => onSelectPlan(index)}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                currentPlanIndex === index
                  ? `${plan.color} shadow-sm`
                  : 'text-base-content hover:bg-base-200'
              }`}
            >
              {_(plan.name)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PlanNavigation;
