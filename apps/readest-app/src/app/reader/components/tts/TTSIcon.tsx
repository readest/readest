import React from 'react';

type TTSIconProps = {
  isPlaying: boolean;
  onClick: () => void;
};

const TTSIcon: React.FC<TTSIconProps> = ({ isPlaying, onClick }) => {
  const bars = [1, 2, 3, 4];

  return (
    <div className='relative h-full w-full cursor-pointer' onClick={onClick}>
      <div className='absolute inset-0 overflow-hidden rounded-full bg-gradient-to-r from-blue-500 via-emerald-500 to-violet-500'>
        <div
          className='absolute -inset-full bg-gradient-to-r from-blue-500 via-emerald-500 to-violet-500'
          style={{
            animation: isPlaying ? 'moveGradient 2s alternate infinite' : 'none',
          }}
        />
      </div>

      <div className='absolute inset-0 flex items-center justify-center'>
        <style>{`
          @keyframes moveGradient {
            0% { transform: translate(0, 0); }
            100% { transform: translate(25%, 25%); }
          }
          @keyframes bounce {
            0%, 100% { transform: scaleY(1); }
            50% { transform: scaleY(0.6); }
          }
        `}</style>
        <div className='flex items-end space-x-1'>
          {bars.map((bar) => (
            <div
              key={bar}
              className='w-1 rounded-t bg-white'
              style={{
                height: '16px',
                animationName: isPlaying ? 'bounce' : 'none',
                animationDuration: isPlaying ? `${1 + bar * 0.1}s` : '0s',
                animationTimingFunction: 'ease-in-out',
                animationIterationCount: 'infinite',
                animationDelay: `${bar * 0.1}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default TTSIcon;
