'use client';

import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'light' ? 'light' : 'dark');
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('storyright-theme', next);
    setTheme(next);
  }

  return (
    <button className="icon-btn" title="Toggle theme" onClick={toggle}>
      {theme === 'dark' ? '☾' : '☀'}
    </button>
  );
}
