import React from 'react';
import * as Select from '@radix-ui/react-select';
import { MdCheck, MdKeyboardArrowDown, MdKeyboardArrowUp } from 'react-icons/md';

const EMPTY_VALUE = '__readest_empty_select_value__';

interface SettingsSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SettingsSelectProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: SettingsSelectOption[];
  disabled?: boolean;
  ariaLabel?: string;
}

const toRadixValue = (optionValue: string) => optionValue || EMPTY_VALUE;
const fromRadixValue = (optionValue: string) =>
  optionValue === EMPTY_VALUE ? '' : optionValue;

const SettingsSelect: React.FC<SettingsSelectProps> = ({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
}) => {
  const handleValueChange = (nextValue: string) => {
    onChange({
      target: { value: fromRadixValue(nextValue) },
    } as React.ChangeEvent<HTMLSelectElement>);
  };

  return (
    <Select.Root
      value={toRadixValue(value)}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <Select.Trigger
        aria-label={ariaLabel}
        onKeyDown={(event) => event.stopPropagation()}
        className='text-base-content hover:bg-base-200/70 data-[state=open]:bg-base-200/70 flex h-9 max-w-[60%] min-w-0 cursor-pointer items-center justify-end gap-1 rounded-md px-2 text-end text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-45'
      >
        <Select.Value className='truncate' />
        <Select.Icon asChild>
          <MdKeyboardArrowDown className='text-base-content/55 h-5 w-5 flex-shrink-0 transition-transform duration-150 [[data-state=open]>&]:rotate-180' />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content
          position='popper'
          side='bottom'
          align='end'
          sideOffset={6}
          collisionPadding={12}
          className='border-base-300 bg-base-100 text-base-content z-[1000] max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border shadow-xl'
        >
          <Select.ScrollUpButton className='bg-base-100 text-base-content/60 flex h-7 cursor-default items-center justify-center'>
            <MdKeyboardArrowUp className='h-5 w-5' />
          </Select.ScrollUpButton>

          <Select.Viewport className='p-1'>
            {options.map((option) => (
              <Select.Item
                key={option.value || EMPTY_VALUE}
                value={toRadixValue(option.value)}
                disabled={option.disabled}
                className='data-[highlighted]:bg-primary/10 data-[highlighted]:text-base-content data-[state=checked]:bg-primary/10 relative flex min-h-9 cursor-pointer select-none items-center rounded px-8 py-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40'
              >
                <Select.ItemIndicator className='text-primary absolute start-2 flex h-5 w-5 items-center justify-center'>
                  <MdCheck className='h-4 w-4' />
                </Select.ItemIndicator>
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>

          <Select.ScrollDownButton className='bg-base-100 text-base-content/60 flex h-7 cursor-default items-center justify-center'>
            <MdKeyboardArrowDown className='h-5 w-5' />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
};

export default SettingsSelect;
