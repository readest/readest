import React from 'react';

interface NotePreviewProps {
  text: string;
  width: number;
  left: number;    
  top: number;     
}

const NotePreview: React.FC<NotePreviewProps> = ({ text, width, left, top }) => {
  return (
    <div
      className="absolute z-[9999] bg-gray-800 text-white text-sm rounded-md shadow-xl p-3"
      style={{
        width,
        left,
        top,
        whiteSpace: "pre-wrap",
      }}
    >
      {text}
    </div>
  );
};

export default NotePreview;