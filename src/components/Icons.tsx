// src/components/Icons.tsx
// Iconos lineales (estilo Lucide), sin dependencias. stroke = currentColor.
import React from "react";

type P = React.SVGProps<SVGSVGElement> & { size?: number };

const Svg = ({ size = 16, children, ...p }: P & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    {children}
  </svg>
);

export const ChevronLeft = (p: P) => <Svg {...p}><path d="m15 18-6-6 6-6" /></Svg>;
export const ChevronRight = (p: P) => <Svg {...p}><path d="m9 18 6-6-6-6" /></Svg>;
export const Check = (p: P) => <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>;
// Nota con esquina doblada — metáfora clara de "abrir como nota adhesiva"
export const NoteIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v9l-6 6H5a1 1 0 0 1-1-1V5Z" />
    <path d="M20 14h-5a1 1 0 0 0-1 1v5" />
  </Svg>
);
export const Close = (p: P) => <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>;
export const Bell = (p: P) => (
  <Svg {...p}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </Svg>
);
export const Pin = (p: P) => (
  <Svg {...p}>
    <path d="M9 4h6" />
    <path d="M10 4v5L7.5 13h9L14 9V4" />
    <path d="M12 13v7" />
  </Svg>
);
export const Clock = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
export const Plus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const UpDown = (p: P) => <Svg {...p}><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></Svg>;
export const Calendar = (p: P) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></Svg>
);

export const Expand = (p: P) => (
  <Svg {...p}><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></Svg>
);
export const Minimize = (p: P) => <Svg {...p}><path d="M5 12h14" /></Svg>;
