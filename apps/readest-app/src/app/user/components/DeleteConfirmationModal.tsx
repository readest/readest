import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

interface DeleteConfirmationModalProps {
  title: string;
  message: string;
  children?: ReactNode;
  requireTypedConfirmation: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  title,
  message,
  children,
  requireTypedConfirmation,
  onCancel,
  onConfirm,
}) => {
  const _ = useTranslation();
  const titleId = useId();
  const [confirmationText, setConfirmationText] = useState('');
  const canConfirm = !requireTypedConfirmation || confirmationText === 'DELETE';
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    const firstControl = () => dialog?.querySelector<HTMLElement>('input, button');
    firstControl()?.focus();

    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog?.contains(event.target)) firstControl()?.focus();
    };
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('focusin', containFocus);
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      data-capture-blocking-overlay='true'
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
    >
      <div
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const controls = event.currentTarget.querySelectorAll<HTMLElement>(
            'input, button:not(:disabled)',
          );
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        className='bg-base-100 eink-bordered max-h-full w-full max-w-md overflow-y-auto rounded-2xl p-6'
      >
        <h3 id={titleId} className='text-base-content mb-4 text-xl font-bold'>
          {title}
        </h3>
        {children}
        <p className='text-base-content/70 mb-6'>{message}</p>
        {requireTypedConfirmation && (
          <label className='mb-6 flex flex-col gap-2 text-sm'>
            {_('Type {{word}} to confirm', { word: 'DELETE' })}
            <input
              type='text'
              value={confirmationText}
              onChange={(event) => setConfirmationText(event.target.value)}
              autoComplete='off'
              autoCapitalize='off'
              spellCheck={false}
              dir='ltr'
              className='input eink-bordered w-full'
            />
          </label>
        )}
        <div className='flex flex-col gap-3 sm:flex-row'>
          <button
            onClick={onCancel}
            className='bg-base-200 hover:bg-base-300 text-base-content eink-bordered flex-1 rounded-lg px-4 py-2 font-medium transition-colors duration-150'
          >
            {_('Cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            className='eink-contrast flex-1 rounded-lg px-4 py-2 font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 not-eink:bg-rose-600 not-eink:text-white not-eink:hover:bg-rose-700'
          >
            {_('Delete Permanently')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteConfirmationModal;
