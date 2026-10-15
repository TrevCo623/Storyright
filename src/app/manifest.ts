import type { MetadataRoute } from 'next';

// Install / "Add to Home Screen" / "Install app" details. Served at
// /manifest.webmanifest; Next adds the <link rel="manifest"> automatically.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Storyright',
    short_name: 'Storyright',
    description: 'A quiet place to write, with feedback tuned to your own voice.',
    start_url: '/subjects',
    display: 'standalone',
    background_color: '#17181b',
    theme_color: '#17181b',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Full-bleed version so Android can crop it into its own shape.
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
