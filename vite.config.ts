import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Quan trọng: Giúp đường dẫn file tương đối, tránh lỗi màn hình trắng khi deploy
  server: {
    port: 3000,
    host: true // Mở kết nối ra ngoài container
  },
  define: {
    // Polyfill để tránh lỗi khi code cũ gọi process.env
    'process.env': {}
  }
});