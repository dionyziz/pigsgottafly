import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      // the app, and the page the server prints the W&B and performance sheets with (src/pdf/main.tsx)
      input: { main: 'index.html', pdf: 'pdf.html' },
    },
  },
  server: { port: 5173 },
});
