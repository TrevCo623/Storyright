// Shared icon set — stroke 2, 24×24 viewBox, round caps/joins, sourced from
// Lucide's canonical geometry. Replaces the app's old mix of custom 16px SVGs
// (stroke 1.3), a mismatched 24px SVG (stroke 1.8), and plain Unicode glyphs
// standing in for icons with one consistent system. See the Figma Style Guide
// → "Icons — Proposed (Lucide)" section for the reference sheet this was
// built from.

interface IconProps {
  size?: number;
  className?: string;
}

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function PanelLeftIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

export function SearchIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function MessageSquareIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function MoonIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

export function SunIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

export function XIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function GripVerticalIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <circle cx="9" cy="12" r="1" />
      <circle cx="9" cy="5" r="1" />
      <circle cx="9" cy="19" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="15" cy="5" r="1" />
      <circle cx="15" cy="19" r="1" />
    </svg>
  );
}

export function MinusIcon({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function PlusIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 11, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function ListIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
      <path d="M3 6h.01" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M8 6h13" />
    </svg>
  );
}

export function ArrowDownIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function MenuIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}
