import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// API_PORT in dev (PORT is reserved for the Vite dev server by some launchers); PORT in production.
export const PORT = Number(process.env.API_PORT || (process.env.NODE_ENV === 'production' && process.env.PORT) || 5181);
export const PROXY_PORT = Number(process.env.PROXY_PORT || 5182);
export const PROXY_ORIGIN = (process.env.PROXY_ORIGIN || '').replace(/\/$/, '');
export const PROXY_HOST = PROXY_ORIGIN ? new URL(PROXY_ORIGIN).host : '';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
export const DATA_FILE = path.resolve(process.env.DATA_FILE || 'data/db.json');

function loadSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(path.dirname(DATA_FILE), '.secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

export const SESSION_SECRET = loadSecret();
