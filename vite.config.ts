import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  cacheDir: `node_modules/.vite-${loadEnv(mode, '.', '').WEB_PORT || 5173}`,
  optimizeDeps: { entries: ['index.html'] },
  server: {
    watch: { ignored: ['**/data/**', '**/.pnpm-store/**', '**/dist/**', '**/artifacts/**'] },
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${loadEnv(mode, '.', '').API_PORT || 3001}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules') &&
            /remark|rehype|micromark|mdast|hast|unified|react-markdown|parse5|entities/.test(id)
          )
            return 'markdown';
        },
      },
    },
  },
}));
