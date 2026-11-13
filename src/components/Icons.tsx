import { ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  graph: <><circle cx="4" cy="11.6" r="1.6" /><circle cx="12.2" cy="11" r="1.6" /><circle cx="8.4" cy="4.3" r="1.8" /><path d="M4.9 10.2l2.5-4.2M9.3 5.9l2.1 3.6M5.6 11.5l5-.4" /></>,
  x: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  tabs: <path d="M3 4.5h10M3 8h10M3 11.5h10" />,
  files: <><path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.2 1.5h4.8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" /></>,
  search: <><circle cx="7" cy="7" r="3.8" /><path d="M10 10l3.2 3.2" /></>,
  chevron: <path d="M6 4l4 4-4 4" />,
  splitRight: <><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="M8 3v10" /></>,
  splitDown: <><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="M2.5 8h11" /></>,
  sidebar: <><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="M6 3v10" /></>,
  command: <path d="M5.5 5.5h5v5h-5zM5.5 5.5H4.2a1.7 1.7 0 1 1 1.3-1.3zM10.5 5.5V4.2a1.7 1.7 0 1 1 1.3 1.3zM10.5 10.5h1.3a1.7 1.7 0 1 1-1.3 1.3zM5.5 10.5v1.3a1.7 1.7 0 1 1-1.3-1.3z" />,
  branch: <><circle cx="5" cy="4" r="1.4" /><circle cx="5" cy="12" r="1.4" /><circle cx="11" cy="5.5" r="1.4" /><path d="M5 5.4v5.2M11 6.9c0 2.2-2.6 2-6 3.2" /></>,
  folder: <path d="M2.5 5a1 1 0 0 1 1-1h2.8l1.2 1.4h5a1 1 0 0 1 1 1V11.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />,
  file: <><path d="M4.5 2.5h4.5l3 3v7.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5z" /><path d="M9 2.5v3h3" /></>,
  refresh: <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" />,
  eye: <><path d="M1.8 8s2.2-4 6.2-4 6.2 4 6.2 4-2.2 4-6.2 4-6.2-4-6.2-4z" /><circle cx="8" cy="8" r="1.7" /></>,
  up: <path d="M4 10l4-4 4 4" />,
  down: <path d="M4 6l4 4 4-4" />,
  expand: <path d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9" />,
  collapse: <path d="M13.5 2.5L9.5 6.5M9.5 3v3.5H13M2.5 13.5l4-4M6.5 13V9.5H3" />,
  swap: <path d="M2.5 5.5h11M11 3l2.5 2.5L11 8M13.5 10.5h-11M5 8l-2.5 2.5L5 13" />,
  wrap: <path d="M2.5 4h11M2.5 8h8.5a2 2 0 0 1 0 4H8.5M10 10.5L8.5 12 10 13.5M2.5 12h3" />,
  // Lucide "book-open" and "code" (ISC licence), drawn on a 24 grid and scaled to this 16 box.
  book: <g transform="scale(0.6667)" strokeWidth="2"><path d="M12 5v16" /><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" /></g>,
  code: <g transform="scale(0.6667)" strokeWidth="2"><path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" /></g>,
  // Lucide "settings" (ISC licence), drawn on a 24 grid and scaled to this 16 box.
  gear: <g transform="scale(0.6667)" strokeWidth="2"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /><circle cx="12" cy="12" r="3" /></g>,
};

export function Icon({ name, size = 14 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg className="ico" viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}
