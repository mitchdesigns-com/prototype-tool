import './env.ts';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApi } from './api.ts';
import { ADMIN_PASSWORD, PORT, PROXY_HOST, PROXY_PORT } from './config.ts';
import { createProxyApp } from './proxy.ts';

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

const proxyApp = createProxyApp();

// Single-port deployments: requests for the preview host go to the proxy.
if (PROXY_HOST) app.use((req, res, next) => (req.headers.host === PROXY_HOST ? proxyApp(req, res, next) : next()));

app.use('/api', createApi());

const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(dist, 'index.html')) : next()));
}

app.listen(PORT, () => console.log(`Prototype API on http://localhost:${PORT}`));
if (!PROXY_HOST) proxyApp.listen(PROXY_PORT, () => console.log(`Preview origin on http://localhost:${PROXY_PORT}`));
if (!ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD is not set — admin sign-in is disabled (local dev only).');

// One misbehaving previewed site must never take the whole app down: log and keep serving.
process.on('uncaughtException', (err) => console.error('Uncaught error (server kept running):', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection (server kept running):', err));
