import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Nạp các biến môi trường từ file .env (nếu có) hoặc từ hệ thống
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    base: './',
    server: {
      port: 3000,
      host: true
    },
    define: {
      // Quan trọng: Thay thế trực tiếp chuỗi process.env.API_KEY bằng giá trị thực tế khi build
      'process.env.API_KEY': JSON.stringify(env.API_KEY || process.env.API_KEY),
      '__APP_VERSION__': JSON.stringify("1.2.1")
    }
  };
});