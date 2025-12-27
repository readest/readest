import clsx from 'clsx';
import React, { useState } from 'react';

interface PopupButtonProps {
  showTooltip: boolean;
  tooltipText: string;
  disabled?: boolean;
  Icon: React.ElementType;
  onClick: () => void;
}

const PopupButton: React.FC<PopupButtonProps> = ({
  showTooltip,
  tooltipText,
  disabled,
  Icon,
  onClick,
}) => {
  const [buttonClicked, setButtonClicked] = useState(false);
  const handleClick = () => {
    setButtonClicked(true);
    onClick();
  };
  return (
    <div
      className='lg:tooltip lg:tooltip-bottom'
      title={!buttonClicked && showTooltip ? tooltipText : undefined}
    >
      <button
        onClick={handleClick}
        className={clsx(
          'flex h-8 min-h-8 w-8 items-center justify-center p-0',
          disabled ? 'cursor-not-allowed opacity-50' : 'rounded-md hover:bg-gray-500',
        )}
        disabled={disabled}
      >
        <Icon />
      </button>
    </div>
  );
};

export default PopupButton;
