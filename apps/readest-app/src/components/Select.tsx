import clsx from 'clsx';
import React from 'react';

type Option = {
  value: string;
  label: string;
};

type SelectProps = {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: Option[];
  disabled?: boolean;
  className?: string;
};

export default function Select({
  value,
  onChange,
  options,
  className,
  disabled = false,
}: SelectProps) {
  return (
    <select
      value={value}
      onChange={onChange}
      onKeyDown={(e) => e.stopPropagation()}
      className={clsx(
        'select bg-base-200 h-8 min-h-8 max-w-[60%] truncate rounded-md border-none text-sm',
        className,
      )}
      disabled={disabled}
      style={{
        textAlignLast: 'end',
      }}
    >
      {options.map(({ value, label }) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}
