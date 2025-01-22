import React, { useState } from 'react';

interface PopupButtonProps {
  showTooltip: boolean;
  tooltipText: string;
  Icon: React.ElementType;
  onClick: () => void;
}

const PopupButton: React.FC<PopupButtonProps> = ({ showTooltip, tooltipText, Icon, onClick }) => {
  const [buttonClicked, setButtonClicked] = useState(false);
  const handleClick = () => {
    setButtonClicked(true);
    onClick();
  };
  return (
    <div
      className='lg:tooltip lg:tooltip-bottom'
      data-tip={!buttonClicked && showTooltip ? tooltipText : null}
    >
      <button
        onClick={handleClick}
        className='my-2 flex h-8 min-h-8 w-8 items-center justify-center p-0'
      >
        <Icon />
      </button>
    </div>
  );
};

export default PopupButton;
