'use client';

import { useEffect, useState } from 'react';

// Three steps only: current baseline (1em), then +0.2em increments.
// Scales content/prose text via the --text-scale CSS var (see globals.css) —
// deliberately not a full page zoom, so UI chrome (nav, buttons, labels)
// stays fixed size.
const SCALES = [1, 1.2, 1.4];
const STORAGE_KEY = 'storyright-text-scale';

export default function TextSizeControl() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    setIndex(stored === 1 || stored === 2 ? stored : 0);
  }, []);

  function apply(next: number) {
    const clamped = Math.min(SCALES.length - 1, Math.max(0, next));
    setIndex(clamped);
    document.documentElement.style.setProperty('--text-scale', String(SCALES[clamped]));
    localStorage.setItem(STORAGE_KEY, String(clamped));
  }

  const atMin = index === 0;
  const atMax = index === SCALES.length - 1;

  return (
    <div className="text-size-control" title="Adjust text size">
      <button
        type="button"
        className={`text-size-btn${atMin ? ' is-disabled' : ''}`}
        disabled={atMin}
        aria-label="Decrease text size"
        onClick={() => apply(index - 1)}
      >
        −
      </button>
      <span className="text-size-label">A</span>
      <button
        type="button"
        className={`text-size-btn${atMax ? ' is-disabled' : ''}`}
        disabled={atMax}
        aria-label="Increase text size"
        onClick={() => apply(index + 1)}
      >
        +
      </button>
    </div>
  );
}
