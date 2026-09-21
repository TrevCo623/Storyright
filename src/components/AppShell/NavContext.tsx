'use client';

import { createContext, useContext } from 'react';

// The prototype keeps its nav-toggle button in the chapter editor's own
// topbar (always visible, regardless of whether the nav is open), rather
// than inside the nav itself. This context lets EntryEditor's topbar button
// drive the collapse state that AppShell/Sidebar own.
interface NavContextValue {
  navOpen: boolean;
  toggleNav: () => void;
}

export const NavContext = createContext<NavContextValue>({
  navOpen: true,
  toggleNav: () => {},
});

export function useNav() {
  return useContext(NavContext);
}
