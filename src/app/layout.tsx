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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
