import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Storyright',
  description: 'A quiet place to write, with feedback tuned to your own voice.',
};

// Sets data-theme before paint (dark by default, per the locked visual
// direction) so toggling later never causes a flash of the wrong theme.
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('storyright-theme');
    document.documentElement.setAttribute('data-theme', stored === 'light' ? 'light' : 'dark');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

// Same flash-avoidance approach as the theme script, for the persisted
// content text-size (see TextSizeControl.tsx) — 3 steps: 1 / 1.2 / 1.4.
const textScaleInitScript = `
(function () {
  try {
    var idx = Number(localStorage.getItem('storyright-text-scale'));
    var scale = idx === 1 ? 1.2 : idx === 2 ? 1.4 : 1;
    document.documentElement.style.setProperty('--text-scale', String(scale));
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: textScaleInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
