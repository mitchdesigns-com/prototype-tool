import crypto from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { SESSION_SECRET } from './config.ts';

const sign = (s: string) => crypto.createHmac('sha256', SESSION_SECRET).update(s).digest('base64url');

export function safeEqual(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

export function issueAdminToken() {
  const body = `adm.${Date.now() + 30 * 24 * 60 * 60 * 1000}`;
  return `${body}.${sign(body)}`;
}

function verifyAdminToken(token: string | null) {
  if (!token) return false;
  const i = token.lastIndexOf('.');
  if (i < 0) return false;
  const body = token.slice(0, i);
  if (!safeEqual(token.slice(i + 1), sign(body))) return false;
  return Number(body.split('.')[1]) > Date.now();
}

export function isAdmin(req: Request) {
  const h = req.headers.authorization;
  return verifyAdminToken(h?.startsWith('Bearer ') ? h.slice(7) : null);
}

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'Admin sign-in required' });
};

/** Lets admins open a prototype whose public link is switched off. */
export const previewKeyFor = (shareToken: string) => sign(`preview:${shareToken}`).slice(0, 22);

export const checkPreviewKey = (shareToken: string, key: unknown) =>
  typeof key === 'string' && key.length > 0 && safeEqual(key, previewKeyFor(shareToken));
