import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
