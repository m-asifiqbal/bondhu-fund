import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'chrome120', // Electron's Chromium: no legacy transpilation, smaller bundles
    cssCodeSplit: true,
    reportCompressedSize: false, // faster builds
    rollupOptions: {
      output: {
        // Separate long-lived vendor chunks so they load in parallel with the screen code and parse once.
        manualChunks(id: string) {
          if (id.includes('node_modules/echarts') || id.includes('node_modules/zrender')) return 'vendor-echarts';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'vendor-react';
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-') || id.includes('node_modules/victory-vendor')) return 'vendor-recharts';
          if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});

