import type { ReactNode } from 'react';

const PATHS: Record<string, ReactNode> = {
  square: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" />
      <path d="M2.5 8h11M8 2.5v11" />
    </>
  ),
  'hex-flat': (
    <polygon points="14,8 11,13.2 5,13.2 2,8 5,2.8 11,2.8" />
  ),
  'hex-flat-diamond': (
    <>
      <polygon points="14,8 11,13.2 5,13.2 2,8 5,2.8 11,2.8" />
      <path d="M8 8V2.8M8 8H2M8 8l3 5.2" />
    </>
  ),
  'hex-pointy': (
    <polygon points="13.2,5 13.2,11 8,14 2.8,11 2.8,5 8,2" />
  ),
  'tri-horiz': (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" />
      <path d="M2.5 8h11M2.5 2.5L8 8l5.5-5.5M2.5 13.5L8 8l5.5 5.5" />
    </>
  ),
  'tri-vert': (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" />
      <path d="M8 2.5v11M2.5 2.5L8 8l-5.5 5.5M13.5 2.5L8 8l5.5 5.5" />
    </>
  ),
};

const ALIAS: Record<string, string> = {
  hex: 'hex-flat',
  triangle: 'tri-horiz',
};

const MODE_PATHS: Record<string, ReactNode> = {
  'cell-paint': (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" />
      <path d="M2.5 8h11M8 2.5v11" />
      <rect x="8" y="2.5" width="5.5" height="5.5" fill="currentColor" stroke="none" />
    </>
  ),
  metaball: (
    <>
      <circle cx="6" cy="9.5" r="3.5" />
      <circle cx="10.5" cy="6.5" r="2.6" />
    </>
  ),
  'vector-field': (
    <>
      <path d="M3 13L13 3" />
      <path d="M7 3h6v6" />
    </>
  ),
  'dot-shading': (
    <>
      <circle cx="4" cy="4" r="0.9" />
      <circle cx="8" cy="4" r="0.9" />
      <circle cx="12" cy="4" r="0.9" />
      <circle cx="4" cy="8" r="0.9" />
      <circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="0.9" />
      <circle cx="4" cy="12" r="0.9" />
      <circle cx="8" cy="12" r="0.9" />
      <circle cx="12" cy="12" r="0.9" />
    </>
  ),
};

export function ModeIcon({ value }: { value: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {MODE_PATHS[value] ?? MODE_PATHS['cell-paint']}
    </svg>
  );
}

export function GridIcon({ value }: { value: string }) {
  const key = ALIAS[value] ?? value;
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {PATHS[key] ?? PATHS.square}
    </svg>
  );
}
