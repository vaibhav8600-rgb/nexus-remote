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

export const TrackpadIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="13" rx="3" />
    <path d="M3 13.5h18M12 13.5V17" />
    <path d="M8 20.5h8" />
  </Icon>
);

export const KeyboardIcon = () => (
  <Icon>
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
    <path d="M6 9.5h.01M9.3 9.5h.01M12.6 9.5h.01M15.9 9.5h.01M18.2 9.5h.01M6 12.5h.01M9.3 12.5h.01M12.6 12.5h.01M15.9 12.5h.01M18.2 12.5h.01M8 15h8" strokeWidth={2} />
  </Icon>
);

export const MediaIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M10 8.8v6.4l5.2-3.2z" fill="currentColor" />
  </Icon>
);

// gearshape: eight flat-topped teeth around a hub.
const GEAR = 'M21.22 10.79 L21.22 13.21 L19.15 13.92 L18.41 15.69 L19.37 17.67 L17.67 19.37 L15.69 18.41 L13.92 19.15 L13.21 21.22 L10.79 21.22 L10.08 19.15 L8.31 18.41 L6.33 19.37 L4.63 17.67 L5.59 15.69 L4.85 13.92 L2.78 13.21 L2.78 10.79 L4.85 10.08 L5.59 8.31 L4.63 6.33 L6.33 4.63 L8.31 5.59 L10.08 4.85 L10.79 2.78 L13.21 2.78 L13.92 4.85 L15.69 5.59 L17.67 4.63 L19.37 6.33 L18.41 8.31 L19.15 10.08Z';

export const GearIcon = () => (
  <Icon>
    <path d={GEAR} />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const LockIcon = () => (
  <Icon>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7" />
  </Icon>
);

export const BackwardIcon = () => (
  <Icon stroke="none" fill="currentColor">
    <path d="M11.5 6.5v11L3.5 12zM20.5 6.5v11l-8-5.5z" />
  </Icon>
);

export const ForwardIcon = () => (
  <Icon stroke="none" fill="currentColor">
    <path d="M12.5 6.5v11l8-5.5zM3.5 6.5v11l8-5.5z" />
  </Icon>
);

export const PlayPauseIcon = () => (
  <Icon stroke="none" fill="currentColor">
    <path d="M3 6v12l8.5-6zM14 6h2.6v12H14zM19 6h2.6v12H19z" />
  </Icon>
);

const Speaker = () => <path d="M3.5 9.5h3.2L11 6v12l-4.3-3.5H3.5z" fill="currentColor" />;

export const VolumeDownIcon = () => (
  <Icon>
    <Speaker />
    <path d="M14.5 12h5" />
  </Icon>
);

export const VolumeUpIcon = () => (
  <Icon>
    <Speaker />
    <path d="M14.5 12h5M17 9.5v5" />
  </Icon>
);

export const MuteIcon = () => (
  <Icon>
    <Speaker />
    <path d="m15 9.5 5 5M20 9.5l-5 5" />
  </Icon>
);

export const SunIcon = ({ big }: { big?: boolean }) => (
  <Icon>
    <circle cx="12" cy="12" r={big ? 4.2 : 3} fill="currentColor" />
    {big ? (
      <path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7 5.3 5.3" />
    ) : (
      <path d="M12 5.5v.5M12 18v.5M18.5 12H18M6 12h-.5M16.6 7.4l-.3.3M7.7 16.3l-.3.3M16.6 16.6l-.3-.3M7.7 7.7l-.3-.3" strokeWidth={2.4} />
    )}
  </Icon>
);
