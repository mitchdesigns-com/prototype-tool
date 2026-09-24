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

/** Publishes the comment bridge with the demo so real sites can include it. */
function demoSite(): Plugin {
  return {
    name: 'demo-bridge',
    apply: 'build',
    closeBundle() {
      // Public copy real sites can include (<script src=".../bridge.js">) so comments work without the proxy.
      fs.copyFileSync('server/bridge.js', 'dist-demo/bridge.js');
      fs.writeFileSync('dist-demo/.nojekyll', '');
    },
  };
}
