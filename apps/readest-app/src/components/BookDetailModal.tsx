import React from "react";
import { Book } from '@/types/book';

const BookDetailModal = ({ isOpen, onClose, book }: { isOpen: boolean; onClose: () => void; book: Book }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Transparent gray overlay */}
      <div 
        className="fixed inset-0 bg-gray-800 bg-opacity-70" 
        onClick={onClose}
      />
      
      <div className="relative z-50 w-96 bg-white rounded-lg shadow-xl p-6">
        {/* Close button */}
        <button
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 transition-colors"
          onClick={onClose}
          aria-label="Close modal"
        >
          <svg 
            className="w-5 h-5" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2" 
            viewBox="0 0 24 24" 
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>

        <h2 className="text-2xl font-semibold mb-2">{book.title}</h2>
        <p className="text-gray-700 mb-1"><span className="font-medium">Author:</span> {book.author}</p>
        <p className="text-gray-700 mb-1"><span className="font-medium">Format:</span> {book.format}</p>
        <p className="text-gray-700 mb-4"><span className="font-medium">Last Updated:</span> {new Date(book.lastUpdated).toLocaleDateString()}</p>
        
        <button
          className="w-full py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default BookDetailModal;
