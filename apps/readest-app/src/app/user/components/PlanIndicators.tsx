import { PlanDetails } from '../utils/plan';

interface PlanIndicatorsProps {
  allPlans: PlanDetails[];
  currentPlanIndex: number;
  onSelectPlan: (index: number) => void;
}

const PlanIndicators: React.FC<PlanIndicatorsProps> = ({
  allPlans,
  currentPlanIndex,
  onSelectPlan,
}) => (
  <div className='flex justify-center space-x-2 pb-6 pt-2'>
    {allPlans.map((_, index) => (
      <button
        key={index}
        onClick={() => onSelectPlan(index)}
        className={`h-2 w-2 rounded-full transition-colors ${
          index === currentPlanIndex ? 'bg-blue-500' : 'bg-gray-300'
        }`}
      />
    ))}
  </div>
);

export default PlanIndicators;
