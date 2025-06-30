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
    const touchStart = e.touches[0]!.clientX;
    const handleTouchMove = (moveEvent: TouchEvent) => {
      const touchEnd = moveEvent.touches[0]!.clientX;
      const diff = touchStart - touchEnd;

      if (Math.abs(diff) > 50) {
        if (diff > 0) {
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
    <div className='overflow-hidden rounded-xl border bg-white shadow-sm'>
      <PlanNavigation
        currentPlanIndex={currentPlanIndex}
        totalPlans={allPlans.length}
        onPlanSwipe={handlePlanSwipe}
      />

      <div
        ref={plansScrollRef}
        className='scrollbar-hide flex items-center overflow-x-auto scroll-smooth pe-20'
        onTouchStart={handleTouchStart}
        style={{
          scrollSnapType: 'x mandatory',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {allPlans.map((plan, index) => (
          <PlanCard
            key={plan.plan}
            plan={plan}
            comingSoon={appService?.isIOSApp}
            isUserPlan={plan.plan === userPlan}
            upgradable={index > userPlanIndex}
            index={index}
            currentPlanIndex={currentPlanIndex}
            onSubscribe={onSubscribe}
            onPlanSwipe={handlePlanSwipe}
          />
        ))}
      </div>

      <PlanIndicators
        allPlans={allPlans}
        currentPlanIndex={currentPlanIndex}
        onPlanSelect={setCurrentPlanIndex}
      />
    </div>
  );
};

export default PlansComparison;
