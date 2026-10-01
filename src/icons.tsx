// SF Symbols-style glyphs, drawn inline: the real symbols are not licensed
// for the web. 24-unit grid, stroke and fill both follow currentColor.
import type { ReactNode, SVGProps } from 'react';

function Icon({ children, ...rest }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const KeyboardIcon = () => (
  <Icon>
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
    <path
      d="M6 9.5h.01M9.3 9.5h.01M12.6 9.5h.01M15.9 9.5h.01M18.2 9.5h.01M6 12.5h.01M9.3 12.5h.01M12.6 12.5h.01M15.9 12.5h.01M18.2 12.5h.01M8 15h8"
      strokeWidth={2}
    />
  </Icon>
);

export const MediaIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M10 8.8v6.4l5.2-3.2z" fill="currentColor" />
  </Icon>
);

export const PlayPauseIcon = () => (
  <Icon stroke="none" fill="currentColor">
    <path d="M3 6v12l8.5-6zM14 6h2.6v12H14zM19 6h2.6v12H19z" />
  </Icon>
);

const Speaker = () => <path d="M3.5 9.5h3.2L11 6v12l-4.3-3.5H3.5z" fill="currentColor" />;

export const MuteIcon = () => (
  <Icon>
    <Speaker />
    <path d="m15 9.5 5 5M20 9.5l-5 5" />
  </Icon>
);

export const MenuIcon = () => (
  <Icon>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const WindowIcon = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M3 9h18" />
  </Icon>
);

export const MonitorIcon = () => (
  <Icon>
    <rect x="3" y="4.5" width="18" height="12" rx="2" />
    <path d="M9 20h6M12 16.5V20" />
    <path d="m8.5 10.5 2 2 4-4" />
  </Icon>
);

export const ChevronUp = () => (
  <Icon>
    <path d="m7 14 5-5 5 5" />
  </Icon>
);

export const ChevronDown = () => (
  <Icon>
    <path d="m7 10 5 5 5-5" />
  </Icon>
);

export const ChevronLeft = () => (
  <Icon>
    <path d="m14 7-5 5 5 5" />
  </Icon>
);

export const ChevronRight = () => (
  <Icon>
    <path d="m10 7 5 5-5 5" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="m7 7 10 10M17 7 7 17" />
  </Icon>
);

export const StopIcon = () => (
  <Icon>
    <rect x="7" y="7" width="10" height="10" rx="1.5" />
  </Icon>
);

export const GamepadIcon = () => (
  <Icon>
    <path d="M7.5 7h9a4.5 4.5 0 0 1 4.4 5.5l-.9 4a2.6 2.6 0 0 1-4.4 1.2L13.6 16h-3.2l-2 1.7a2.6 2.6 0 0 1-4.4-1.2l-.9-4A4.5 4.5 0 0 1 7.5 7z" />
    <path d="M8 10v4M6 12h4" />
    <path d="M15.5 11h.01M17.5 13h.01" strokeWidth={2.4} />
  </Icon>
);

export const HomeIcon = () => (
  <Icon>
    <path d="M4 11.5 12 5l8 6.5" />
    <path d="M6.5 10v9h11v-9" />
  </Icon>
);

export const GridIcon = () => (
  <Icon>
    <rect x="4.5" y="4.5" width="6" height="6" rx="1.5" />
    <rect x="13.5" y="4.5" width="6" height="6" rx="1.5" />
    <rect x="4.5" y="13.5" width="6" height="6" rx="1.5" />
    <rect x="13.5" y="13.5" width="6" height="6" rx="1.5" />
  </Icon>
);

export const SlidersIcon = () => (
  <Icon>
    <path d="M5 8h9M18 8h1M5 16h1M10 16h9" />
    <circle cx="16" cy="8" r="2" />
    <circle cx="8" cy="16" r="2" />
  </Icon>
);

export const ClockIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const RotateIcon = () => (
  <Icon>
    <path d="M19 12a7 7 0 1 1-2.1-5" />
    <path d="M19.5 4.5V9H15" />
  </Icon>
);

export const DropIcon = () => (
  <Icon>
    <path d="M12 4v11M7 10.5l5 5 5-5M6 19.5h12" />
  </Icon>
);

export const PaletteIcon = () => (
  <Icon>
    <path d="M12 4a8 8 0 0 0 0 16c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.1-1.6-1.1-2.7 0-.9.7-1.6 1.6-1.6H16a4 4 0 0 0 4-4C20 6.9 16.4 4 12 4z" />
    <path d="M8 11h.01M10.5 7.8h.01M14.5 8h.01" strokeWidth={2.4} />
  </Icon>
);

export const SaveIcon = () => (
  <Icon>
    <path d="m5.5 12.5 4 4 9-9" />
  </Icon>
);
