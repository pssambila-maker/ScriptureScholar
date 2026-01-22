import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    // Load all env variables (empty prefix '' means load all, not just VITE_ prefixed)
    const env = loadEnv(mode, process.cwd(), '');
    console.log('Building with GOOGLE_API_KEY:', env.GOOGLE_API_KEY ? 'Found' : 'NOT FOUND');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GOOGLE_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GOOGLE_API_KEY),
        'process.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
