/** Line icons for the reader toolbar: 20px grid, currentColor, decorative (buttons carry the names). */
import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const TypeIcon = () => (
  <Icon>
    <path d="M2.5 15.5 6.5 5l4 10.5M4 11.5h5" />
    <path d="M17.5 15.5v-5.2a2.3 2.3 0 0 0-4.4-.9M17.5 12.8c-3.6-.4-4.8.7-4.8 1.6 0 .8.6 1.2 1.5 1.2 1.9 0 3.3-1.3 3.3-2.8" />
  </Icon>
);

export const ContentsIcon = () => (
  <Icon>
    <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="1.5" />
    <path d="M7.5 3.75v12.5M4.5 7h1.2M4.5 9.5h1.2" />
  </Icon>
);

export const PaneIcon = () => (
  <Icon>
    <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="1.5" />
    <path d="M12.5 3.75v12.5M14.3 7h1.2M14.3 9.5h1.2" />
  </Icon>
);

export const FocusIcon = () => (
  <Icon>
    <path d="M3 7V4.5A1.5 1.5 0 0 1 4.5 3H7M13 3h2.5A1.5 1.5 0 0 1 17 4.5V7M17 13v2.5a1.5 1.5 0 0 1-1.5 1.5H13M7 17H4.5A1.5 1.5 0 0 1 3 15.5V13" />
    <path d="M7 8h6M7 10.5h6M7 13h3.5" />
  </Icon>
);

export const ExpandIcon = () => (
  <Icon>
    <path d="M12 3h5v5M8 17H3v-5M17 3l-5.5 5.5M3 17l5.5-5.5" />
  </Icon>
);

export const CollapseIcon = () => (
  <Icon>
    <path d="M16.5 8h-5V3M3.5 12h5v5M11.5 8 17 2.5M8.5 12 3 17.5" />
  </Icon>
);

export const KeyboardIcon = () => (
  <Icon>
    <rect x="2.25" y="5" width="15.5" height="10" rx="1.5" />
    <path d="M5 8h.01M8 8h.01M11 8h.01M14 8h.01M5 11h.01M14 11h.01M7.5 11.5h5" />
  </Icon>
);
