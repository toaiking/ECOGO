import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 3000,
    host: true
  },
  define: {
    'process.env': {},
    '__APP_VERSION__': JSON.stringify("1.2.0")
  }
});