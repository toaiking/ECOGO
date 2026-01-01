
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Nạp tất cả các biến từ file .env mà không phụ thuộc vào tiền tố VITE_
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [react()],
    base: './',
    server: {
      port: 3000,
      host: true
    },
    define: {
      // Thay thế chính xác process.env.API_KEY bằng giá trị từ file .env
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
      '__APP_VERSION__': JSON.stringify("1.2.2")
    }
  };
});
