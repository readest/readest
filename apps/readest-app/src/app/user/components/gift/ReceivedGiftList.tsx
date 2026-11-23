import { useTranslation } from '@/hooks/useTranslation';
import { getLocale } from '@/utils/misc';
import type { ReceivedGiftCard } from '@/types/gift';
import GiftCard from './GiftCard';

interface ReceivedGiftListProps {
  cards: ReceivedGiftCard[];
  now: Date;
}

const ReceivedGiftList: React.FC<ReceivedGiftListProps> = ({ cards, now }) => {
  const _ = useTranslation();
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(getLocale());

  const status = (card: ReceivedGiftCard) => {
    if (now < new Date(card.startsAt))
      return _('Starts {{date}}', { date: formatDate(card.startsAt) });
    if (now >= new Date(card.endsAt)) return _('Ended');
    return _('Active until {{date}}', { date: formatDate(card.endsAt) });
  };

  return (
    <ul className='grid gap-8 sm:grid-cols-2'>
      {cards.map((card) => (
        <li key={card.id} className='flex flex-col gap-3'>
          <GiftCard face={card} year={new Date(card.startsAt).getFullYear()} />
          <span className='px-1 font-medium'>{status(card)}</span>
        </li>
      ))}
    </ul>
  );
};

export default ReceivedGiftList;
