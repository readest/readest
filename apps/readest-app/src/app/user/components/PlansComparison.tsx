import { useCallback, useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { debounce } from '@/utils/debounce';
import { getPlanDetails } from '../utils/plan';
import { UserPlan } from '@/types/user';
import { AvailablePlan } from '../page';
import PlanNavigation from './PlanNavigation';
import PlanCard from './PlanCard';
import PlanIndicators from './PlanIndicators';

interface PlansComparisonProps {
  availablePlans: AvailablePlan[];
  userPlan: UserPlan;
  onSubscribe: (priceId?: string) => void;
}

const PlansComparison: React.FC<PlansComparisonProps> = ({
  availablePlans,
  userPlan,
  onSubscribe,
}) => {
  const { appService } = useEnv();
  const [currentPlanIndex, setCurrentPlanIndex] = useState(0);
  const [userPlanIndex, setUserPlanIndex] = useState(0);
  const plansScrollRef = useRef<HTMLDivElement>(null);

  const userPlans: UserPlan[] = ['free', 'plus', 'pro'];

  useEffect(() => {
    if (userPlan) {
      const initialPlanIndex = userPlans.indexOf(userPlan);
      setCurrentPlanIndex(Math.max(0, initialPlanIndex));
      setUserPlanIndex(Math.max(0, initialPlanIndex));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPlan]);

  const handlePlanSwipe = (direction: 'left' | 'right') => {
    if (direction === 'left' && currentPlanIndex < allPlans.length - 1) {
      setCurrentPlanIndex(currentPlanIndex + 1);
    } else if (direction === 'right' && currentPlanIndex > 0) {
      setCurrentPlanIndex(currentPlanIndex - 1);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touchStartX = e.touches[0]!.clientX;
    const touchStartY = e.touches[0]!.clientY;
    const handleTouchMove = (moveEvent: TouchEvent) => {
      const touchEndX = moveEvent.touches[0]!.clientX;
      const touchEndY = moveEvent.touches[0]!.clientY;
      const diffX = touchStartX - touchEndX;
      const diffY = touchStartY - touchEndY;

      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
        if (diffX > 0) {
          handlePlanSwipe('left');
        } else {
          handlePlanSwipe('right');
        }
        document.removeEventListener('touchmove', handleTouchMove);
      }
    };

    const handleTouchEnd = () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };

    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleTouchEnd);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleScroll = useCallback(
    debounce(() => {
      if (plansScrollRef.current) {
        const container = plansScrollRef.current;
        const scrollLeft = container.scrollLeft;
        const containerWidth = container.clientWidth;
        const scrollWidth = container.scrollWidth;

        const cardWidth = scrollWidth / allPlans.length;
        const viewportCenter = scrollLeft + containerWidth / 2;
        const newIndex = Math.floor(viewportCenter / cardWidth);
        const clampedIndex = Math.max(0, Math.min(newIndex, allPlans.length - 1));

        if (currentPlanIndex === 0 && scrollLeft < 10) {
          return;
        }
        if (clampedIndex !== currentPlanIndex) {
          setCurrentPlanIndex(clampedIndex);
        }
      }
    }, 100),
    [currentPlanIndex],
  );

  useEffect(() => {
    if (!plansScrollRef.current) return;

    const container = plansScrollRef.current;
    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [currentPlanIndex, handleScroll]);

  useEffect(() => {
    if (plansScrollRef.current) {
      const planWidth = plansScrollRef.current.scrollWidth / allPlans.length;
      const scrollPosition = currentPlanIndex * planWidth;
      plansScrollRef.current.scrollTo({
        left: scrollPosition,
        behavior: 'smooth',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPlanIndex]);

  const allPlans = userPlans.map((plan) => ({
    ...getPlanDetails(plan, availablePlans),
  }));

  return (
    <div className='bg-base-100 border-base-200 overflow-hidden rounded-xl border shadow-sm'>
      <PlanNavigation
        allPlans={allPlans}
        currentPlanIndex={currentPlanIndex}
        onSelectPlan={setCurrentPlanIndex}
      />

      <div
        ref={plansScrollRef}
        className='scrollbar-hide flex items-start overflow-x-auto scroll-smooth'
        onTouchStart={handleTouchStart}
        style={{
          scrollSnapType: appService?.isAndroidApp ? 'none' : 'x mandatory',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {allPlans.map((plan, index) => (
          <PlanCard
            key={plan.plan}
            plan={plan}
            comingSoon={['playstore'].includes(appService?.distChannel || '')}
            isUserPlan={plan.plan === userPlan}
            upgradable={index > userPlanIndex}
            index={index}
            currentPlanIndex={currentPlanIndex}
            onSubscribe={onSubscribe}
            onSelectPlan={setCurrentPlanIndex}
          />
        ))}
      </div>

      <PlanIndicators
        allPlans={allPlans}
        currentPlanIndex={currentPlanIndex}
        onSelectPlan={setCurrentPlanIndex}
      />
    </div>
  );
};

export default PlansComparison;
