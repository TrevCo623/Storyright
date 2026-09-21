'use client';

import { useState, type ReactNode } from 'react';
import Sidebar from '@/components/Sidebar/Sidebar';
import { NavContext } from './NavContext';
import type { Character, Entry, OutlineSuggestion, Place } from '@/lib/types';

interface Props {
  subjectId: string;
  subjectTitle: string;
  activeEntryId?: string;
  chapters: Pick<Entry, 'id' | 'title'>[];
  threads: Pick<Entry, 'id' | 'title'>[];
  characters: Pick<Character, 'id' | 'name'>[];
  places: Pick<Place, 'id' | 'name'>[];
  insights: OutlineSuggestion[];
  children: ReactNode;
}

export default function AppShell({
  subjectId,
  subjectTitle,
  activeEntryId,
  chapters,
  threads,
  characters,
  places,
  insights,
  children,
}: Props) {
  const [navOpen, setNavOpen] = useState(true);

  return (
    <NavContext.Provider value={{ navOpen, toggleNav: () => setNavOpen((v) => !v) }}>
      <div className={`app${navOpen ? '' : ' nav-collapsed'}`}>
        <Sidebar
          subjectId={subjectId}
          subjectTitle={subjectTitle}
          activeEntryId={activeEntryId}
          chapters={chapters}
          threads={threads}
          characters={characters}
          places={places}
          insights={insights}
        />
        {children}
      </div>
    </NavContext.Provider>
  );
}
