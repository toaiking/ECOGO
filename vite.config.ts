import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Quan trọng: Giúp đường dẫn file tương đối
  server: {
    port: 3000,
    host: true
  },
  define: {
    'process.env': {},
    // Định nghĩa biến version an toàn
    '__APP_VERSION__': JSON.stringify("1.0.1")
  }
});