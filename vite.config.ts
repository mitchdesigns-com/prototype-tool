import fs from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `npm run build:demo`: static build for GitHub Pages (see src/lib/runtime.ts).
const demo = process.env.VITE_DEMO === '1';

export default defineConfig({
  base: demo ? '/prototype-tool/' : '/',
  build: { outDir: demo ? 'dist-demo' : 'dist' },
  plugins: [react(), tailwindcss(), demo && demoSite()],
  server: {
    port: 5180,
    strictPort: true,
    host: true,
    proxy: { '/api': { target: 'http://localhost:5181' } },
  },
});

/** Copies the sample website (+ the comment bridge it loads) into the demo build. */
function demoSite(): Plugin {
  return {
    name: 'demo-site',
    apply: 'build',
    closeBundle() {
      fs.cpSync('demo/site', 'dist-demo/demo-site', { recursive: true });
      fs.copyFileSync('server/bridge.js', 'dist-demo/demo-site/bridge.js');
      fs.writeFileSync('dist-demo/.nojekyll', '');
    },
  };
}
