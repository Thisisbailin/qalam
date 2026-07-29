import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const readWebSocketCredential = (header: string | string[] | undefined) => {
  const rawHeader = Array.isArray(header) ? header.join(',') : header || '';
  const protocol = rawHeader
    .split(',')
    .map((value) => value.trim())
    .find((value) => value.startsWith('stylo-auth.') || value.startsWith('qalam-auth.'));
  const encoded = protocol?.slice(
    protocol.startsWith('stylo-auth.') ? 'stylo-auth.'.length : 'qalam-auth.'.length
  );
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length > 8_192) return '';
  try {
    return Buffer.from(encoded, 'base64url').toString('utf8').trim();
  } catch {
    return '';
  }
};

const createQwenWebSocketProxy = (routePrefix: RegExp): ProxyOptions => ({
  target: 'wss://dashscope.aliyuncs.com',
  ws: true,
  changeOrigin: true,
  rewrite: (requestPath) => requestPath.replace(routePrefix, '/api-ws'),
  configure: (proxy) => {
    proxy.on('proxyReqWs', (proxyRequest, request) => {
      const credential = readWebSocketCredential(request.headers['sec-websocket-protocol']);
      proxyRequest.removeHeader('sec-websocket-protocol');
      if (!credential) {
        proxyRequest.destroy(new Error('Missing DashScope WebSocket credential'));
        return;
      }
      proxyRequest.setHeader('authorization', `Bearer ${credential}`);
    });
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const devApiTarget = (env.STYLO_DEV_API_BASE || env.VITE_API_BASE || 'https://node-qalam.pages.dev')
    .trim()
    .replace(/\/+$/, '');
  return {
    server: {
      port: 3000,
      strictPort: true,
      host: '0.0.0.0',
      proxy: {
        '/api/qwen-ws': createQwenWebSocketProxy(/^\/api\/qwen-ws/),
        '/api/qwen-tts-ws': createQwenWebSocketProxy(/^\/api\/qwen-tts-ws/),
        '/api': {
          target: devApiTarget,
          changeOrigin: true,
          secure: true,
        },
      },
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (!id.includes('/node_modules/')) {
              if (id.includes('/agents/')) return 'stylo-core';
              if (id.includes('/services/')) return 'provider-services';
              if (id.includes('/interactive-35mm-film-roll/')) return 'film-roll';
              if (id.includes('/node-workspace/nodes/')) return 'flow-nodes';
              if (id.includes('/node-workspace/foundation/')) return 'stylo-core';
              if (
                id.includes('/node-workspace/components/StyloAgent') ||
                id.includes('/node-workspace/components/stylo/')
              ) return 'stylo-core';
              if (
                id.includes('/node-workspace/components/FlowSurface') ||
                id.includes('/node-workspace/components/canvas/')
              ) return 'flow-surface';
              return undefined;
            }
            if (/node_modules\/(react|react-dom|react-is|scheduler)\//.test(id)) return 'react-vendor';
            if (id.includes('/node_modules/three/')) return 'cinewor-vendor';
            if (id.includes('/node_modules/@xyflow/')) return 'flow-vendor';
            if (id.includes('/node_modules/@clerk/')) return 'auth-vendor';
            if (id.includes('/node_modules/@openai/') || id.includes('/node_modules/openai/')) return 'agent-vendor';
            if (id.includes('/node_modules/recharts/') || id.includes('/node_modules/d3-')) return 'charts-vendor';
            if (id.includes('/node_modules/konva/') || id.includes('/node_modules/react-konva/')) return 'canvas-vendor';
            if (id.includes('/node_modules/@supabase/')) return 'storage-vendor';
            if (id.includes('/node_modules/framer-motion/') || id.includes('/node_modules/motion-dom/')) return 'motion-vendor';
            if (id.includes('/node_modules/pdfjs-dist/')) return 'pdf-vendor';
            return 'vendor';
          },
        },
      },
    },
    define: {
      'process.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify(env.VITE_CLERK_PUBLISHABLE_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
