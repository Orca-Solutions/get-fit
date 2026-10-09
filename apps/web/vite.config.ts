import { defaultClientConditions, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Build against the engine's TypeScript source, so the app never needs a separate build of it.
  resolve: { conditions: ['source', ...defaultClientConditions] },
  plugins: [
    react(),
    VitePWA({
      // New releases wait for the next launch or an Update tap (lib/update.ts), never reloading an open screen.
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'get-fit',
        short_name: 'get-fit',
        description: 'Personal workout planner and logger',
        theme_color: '#0d0f12',
        background_color: '#0d0f12',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Everything, photos included, is precached so the app works with no signal at the gym.
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Take over on first install, so offline works straight away; updates still wait (see registerType).
        clientsClaim: true,
      },
    }),
  ],
  // Output stays at the repo root, where the server and the deploy expect it.
  build: { outDir: '../../dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
