import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'descarga-removebg-preview.png'],
        manifest: {
          name: 'Gran Rifa Premium',
          short_name: 'RifaPremium',
          description: 'Participa en la Gran Rifa Premium y gana premios increíbles.',
          theme_color: '#D4AF37',
          background_color: '#0a0a0c',
          display: 'standalone',
          icons: [
            {
              src: 'descarga-removebg-preview.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'descarga-removebg-preview.png',
              sizes: '512x512',
              type: 'image/png'
            },
            {
              src: 'descarga-removebg-preview.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        }
      })
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
