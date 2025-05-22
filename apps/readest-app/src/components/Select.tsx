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
  className?: string;
};

export default function Select({ value, onChange, options, className }: SelectProps) {
  return (
    <select
      value={value}
      onChange={onChange}
      className={clsx(
        'select h-8 min-h-8 rounded-md border-none text-end text-sm',
        'bg-gray-600 text-white/75 focus:outline-none focus:ring-0',
        className,
      )}
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
