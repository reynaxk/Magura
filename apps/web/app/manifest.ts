import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Magura',
    short_name: 'Magura',
    description: 'Social spot trading terminal. Trade together, copy the best, live in every coin.',
    start_url: '/',
    display: 'standalone',
    background_color: '#08090C',
    theme_color: '#08090C',
    orientation: 'portrait',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
