import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export default defineConfig({
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
  plugins: [react()],
  root: '.',
  server: {
    port: 5173,
    strictPort: true, // falla inmediatamente si 5173 está ocupado — nunca migra a 5174/5175
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
