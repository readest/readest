import React from 'react';
import clsx from 'clsx';
import { MdOutlineInfo, MdLock, MdLockOpen, MdError } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';

const inputBaseStyles =
  'w-full rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500';
const inputBackgroundStyles = 'bg-base-200/50';
const labelStyles = 'text-base-content block text-sm font-medium';

interface SourceIndicatorProps {
  source?: string;
}

const SourceIndicator: React.FC<SourceIndicatorProps> = ({ source }) => {
  if (!source) return null;

  const [sourceName, confidence] = source.split('-');
  const confidenceNum = parseInt(confidence!);

  let color = 'text-green-500';
  if (confidenceNum < 90) color = 'text-yellow-500';
  if (confidenceNum < 70) color = 'text-red-500';

  return (
    <div className='flex items-center justify-end gap-1 text-xs'>
      <MdOutlineInfo className={clsx('h-3 w-3', color)} />
      <span className={clsx('capitalize', color)}>
        {sourceName} ({confidence}%)
      </span>
    </div>
  );
};

interface LockButtonProps {
  isLocked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

const LockButton: React.FC<LockButtonProps> = ({ isLocked, onToggle, disabled = false }) => {
  return (
    <button
      type='button'
      onClick={onToggle}
      disabled={disabled}
      className={clsx(
        'focus:outline-non absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 transition-colors',
        disabled && 'cursor-not-allowed opacity-50',
        isLocked ? 'bg-green-100 text-green-500 hover:bg-green-200' : 'text-base-content',
      )}
      title={isLocked ? 'Unlock field' : 'Lock field'}
    >
      {isLocked ? <MdLock className='h-4 w-4' /> : <MdLockOpen className='h-4 w-4' />}
    </button>
  );
};

interface FormFieldProps {
  type?: 'input' | 'textarea';
  field: string;
  label: string;
  isNumber?: boolean;
  required?: boolean;
  disabled?: boolean;
  lockable?: boolean;
  fieldSources: Record<string, string>;
  lockedFields: Record<string, boolean>;
  fieldErrors: Record<string, string>;
  onToggleFieldLock: (field: string) => void;

  value: string;
  onFieldChange: (field: string, value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}

const FormField: React.FC<FormFieldProps> = ({
  type = 'input',
  field,
  label,
  fieldSources,
  lockedFields,
  fieldErrors,
  isNumber = false,
  required = false,
  lockable = true,
  disabled = false,
  onToggleFieldLock,

  value,
  onFieldChange,
  placeholder,
  rows,
  className,
}) => {
  const _ = useTranslation();
  const isLocked = lockedFields[field]!;
  const source = fieldSources[field]!;
  const error = fieldErrors[field]!;

  return (
    <div className='flex flex-col gap-1'>
      <div className={clsx(labelStyles, 'flex items-center justify-between')}>
        <span>
          {label} {required && '*'}
        </span>
        {isLocked && (
          <span className='flex items-center gap-1 text-xs text-green-500'>
            <MdLock className='h-3 w-3' />
            {_('Locked')}
          </span>
        )}
      </div>
      <div className='relative'>
        {type === 'input' ? (
          <input
            type={isNumber ? 'number' : 'text'}
            min={1}
            value={value}
            onChange={(e) => onFieldChange(field, e.target.value)}
            placeholder={isLocked ? '' : placeholder}
            disabled={disabled || isLocked}
            className={clsx(
              inputBaseStyles,
              inputBackgroundStyles,
              lockable && 'pe-10',
              isLocked ? 'cursor-not-allowed' : 'bg-gray-100 text-gray-500',
              error && 'border-red-500 focus:ring-red-500',
              className,
            )}
          />
        ) : (
          <textarea
            value={value}
            onChange={(e) => onFieldChange(field, e.target.value)}
            placeholder={isLocked ? '' : placeholder}
            rows={rows || 4}
            disabled={disabled || isLocked}
            className={clsx(
              inputBaseStyles,
              inputBackgroundStyles,
              lockable && 'pe-10',
              isLocked ? 'cursor-not-allowed' : 'bg-gray-100 text-gray-500',
              error && 'border-red-500 focus:ring-red-500',
              className,
            )}
          />
        )}
        {lockable && <LockButton isLocked={isLocked} onToggle={() => onToggleFieldLock(field)} />}
      </div>
      {error && (
        <div className='flex items-center gap-1 text-xs text-red-600'>
          <MdError className='h-3 w-3' />
          <span>{error}</span>
        </div>
      )}
      {!error && <SourceIndicator source={source} />}
    </div>
  );
};

export { FormField, SourceIndicator };
