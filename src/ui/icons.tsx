import React from 'react';

const I = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v10h13V10',
  pipeline: 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v5h-4z',
  company: 'M4 21V5l8-2v18M12 9l8 2v10M8 9h.01M8 13h.01M8 17h.01M16 15h.01M16 18h.01',
  contacts: 'M16 19c0-2.2-1.8-4-4-4s-4 1.8-4 4M12 12a3 3 0 100-6 3 3 0 000 6zM20 19c0-1.7-1-3-2.5-3.6M17 6.5a2.5 2.5 0 010 5',
  quote: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  excel: 'M4 4h16v16H4zM4 9h16M9 4v16M13 13l3 3m0-3l-3 3',
  agent: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z',
  project: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2zM8 13h8',
  tasks: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  docs: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2zM12 11v6M9 14l3-3 3 3',
  time: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  sign: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M8 17c1.5-2 2.5-2 3 0s1.5 1.5 2.5-.5 1.5-1 2.5.5',
  feedback: 'M21 12a8 8 0 01-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1121 12zM12 8v5M12 16h.01',
  pulse: 'M3 12h4l3-8 4 16 3-8h4',
  server: 'M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01M12 8h4M12 16h4',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 010 18M12 3a14 14 0 000 18',
  search: 'M21 21l-4.3-4.3M11 18a7 7 0 100-14 7 7 0 000 14z',
  box: 'M4 7l8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-2.9-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H3a2 2 0 110-4h.1a1.7 1.7 0 001.2-2.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 002.9-1.2V3a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 001.2 2.9H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
};
export const ICONS = I;


export function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

