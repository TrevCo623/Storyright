'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronLeftIcon, MenuIcon } from '@/components/icons';

// Shared project top bar for the Outline pages and the chapter editor
// (ported from editoir-editor-topnav-prototype.html / Figma 268:1161 + 267:167).
//
//  - Left: "‹ {story}" back to the Projects page.
//  - Center: the project tabs. On the Outline they're always visible ("static");
//    in the editor they only appear while hovering the center zone ("hover"),
//    otherwise the chapter crumb sits there.
//  - Right: page-specific controls, passed in as `right`.
//
// The tab bar's position/width come from --content-left / --tabs-width in
// globals.css, which the editor's writing column also uses, so the text's
// left edge always lines up with "Chapters". When the tabs would collide with
// the story name or the right-hand controls, the bar switches to a menu icon
// + dropdown ("compact").

export type ProjectTab = 'chapters' | 'characters' | 'places' | 'threads' | 'insights' | 'overview';

export const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
  { id: 'overview', label: 'Summary' },
  { id: 'chapters', label: 'Chapters' },
  { id: 'characters', label: 'Characters' },
  { id: 'places', label: 'Places' },
  { id: 'threads', label: 'Threads' },
  { id: 'insights', label: 'Insights' },
];

export function isProjectTab(value: string | null | undefined): value is ProjectTab {
  return PROJECT_TABS.some((t) => t.id === value);
}

// Width of the editor's top-right cluster (word count, text size, search,
// theme, notes) at the 1160px design width. The Outline's cluster is
// narrower, so it reserves this much instead — that way both pages switch
// to the compact menu at the same window width.
const EDITOR_RIGHT_CLUSTER_W = 311;
const COLLISION_GAP = 24;
const MENU_BTN_W = 30; // 26px icon button + 4px gap

interface Props {
  subjectTitle: string;
  mode: 'static' | 'hover';
  activeTab?: ProjectTab;
  /** Hover mode only: shown in the center when the tabs are hidden. */
  crumb?: string;
  onSelectTab: (tab: ProjectTab) => void;
  right: ReactNode;
  /** Use the editor's collision point even though this page's right cluster is narrower. */
  matchEditorBreakpoint?: boolean;
}

interface CompactState {
  compact: boolean;
  crumbLeft: number;
  crumbRight: number;
  crumbHidden: boolean;
}

export default function TopNav({
  subjectTitle,
  mode,
  activeTab,
  crumb,
  onSelectTab,
  right,
  matchEditorBreakpoint = false,
}: Props) {
  const probeRef = useRef<HTMLDivElement | null>(null);
  const backRef = useRef<HTMLAnchorElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [layout, setLayout] = useState<CompactState>({
    compact: false,
    crumbLeft: 0,
    crumbRight: 0,
    crumbHidden: false,
  });

  const measure = useCallback(() => {
    const probe = probeRef.current?.getBoundingClientRect();
    const back = backRef.current?.getBoundingClientRect();
    const rightBox = rightRef.current?.getBoundingClientRect();
    if (!probe || !back || !rightBox) return;
    const vw = window.innerWidth;
    const rightEdge = matchEditorBreakpoint
      ? Math.min(rightBox.left, vw - EDITOR_RIGHT_CLUSTER_W - 16)
      : rightBox.left;
    const compact = probe.left < back.right + COLLISION_GAP || probe.right > rightEdge - COLLISION_GAP;
    const crumbLeft = back.right + MENU_BTN_W + COLLISION_GAP;
    const crumbRight = vw - rightBox.left + COLLISION_GAP;
    setLayout((prev) => {
      const next = { compact, crumbLeft, crumbRight, crumbHidden: vw - crumbLeft - crumbRight < 140 };
      return prev.compact === next.compact &&
        prev.crumbLeft === next.crumbLeft &&
        prev.crumbRight === next.crumbRight &&
        prev.crumbHidden === next.crumbHidden
        ? prev
        : next;
    });
  }, [matchEditorBreakpoint]);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    // The right cluster changes width as the word count grows.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro && rightRef.current) ro.observe(rightRef.current);
    // Fonts loading can shift the story name's width.
    void document.fonts?.ready.then(measure);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    if (!layout.compact) setMenuOpen(false);
  }, [layout.compact]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || menuBtnRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuBtnRef.current?.focus();
      }
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const className = [
    'topnav',
    mode === 'static' ? 'is-static' : 'is-hover',
    layout.compact ? 'is-compact' : '',
    layout.crumbHidden ? 'crumb-hidden' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const style = {
    '--crumb-left': `${layout.crumbLeft}px`,
    '--crumb-right': `${layout.crumbRight}px`,
  } as CSSProperties;

  return (
    <header className={className} style={style}>
      <div className="topnav-probe" ref={probeRef} aria-hidden="true" />
      <div className="topnav-left">
        <Link href="/subjects" className="topnav-back" ref={backRef} title="Back to all projects">
          <ChevronLeftIcon />
          <span className="topnav-back-name">{subjectTitle || 'Untitled'}</span>
        </Link>
        <div className="topnav-menu-wrap">
          <button
            ref={menuBtnRef}
            type="button"
            className={`icon-btn${menuOpen ? ' active' : ''}`}
            title="Project sections"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MenuIcon />
          </button>
          {menuOpen && (
            <div className="topnav-menu" role="menu" ref={menuRef}>
              {PROJECT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="menuitem"
                  className={`topnav-menu-item${activeTab === tab.id ? ' active' : ''}`}
                  onClick={() => {
                    setMenuOpen(false);
                    onSelectTab(tab.id);
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="topnav-center">
        {mode === 'hover' && <div className="topnav-crumb">{crumb}</div>}
        <nav className="topnav-tabs">
          {PROJECT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`topnav-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => onSelectTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="topnav-right" ref={rightRef}>
        {right}
      </div>
    </header>
  );
}
