import React from 'react';

interface HighlightCharsProps {
  str: string;
  indices: Set<number>;
  highlightClassName?: string;
}

const HighlightChars: React.FC<HighlightCharsProps> = ({
  str,
  indices,
  highlightClassName = 'bg-primary/30 text-primary rounded-sm',
}) => {
  if (indices.size === 0) {
    return <>{str}</>;
  }

  const chars = str.normalize().split('');

  return (
    <>
      {chars.map((char, i) =>
        indices.has(i) ? (
          <mark key={i} className={highlightClassName}>
            {char}
          </mark>
        ) : (
          <span key={i}>{char}</span>
        ),
      )}
    </>
  );
};

export default HighlightChars;
