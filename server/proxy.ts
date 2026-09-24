import fs from 'node:fs';
import { Readable, pipeline } from 'node:stream';
import express, { type Request, type Response } from 'express';
import { checkPreviewKey } from './auth.ts';
import { db, type Project } from './db.ts';

/**
 * Masked preview origin.
 *
 * The prototype iframe never points at the real website. It loads this origin, which forwards
 * every request to the project's target and rewrites references to the target host, so viewers
 * only ever see the preview host. A cookie (set by /__bbp/start from the share token) says which
 * project a request belongs to; paths are passed through 1:1 so client-side routers keep working.
 * Every HTML page gets the comment bridge (bridge.js) injected.
 */

const COOKIE = '__bbp';
const BRIDGE_FILE = new URL('./bridge.js', import.meta.url);
const BRIDGE = fs.readFileSync(BRIDGE_FILE, 'utf8');
// Re-read in dev so bridge edits apply on the next page load.
const bridgeSource = () => (process.env.NODE_ENV === 'production' ? BRIDGE : fs.readFileSync(BRIDGE_FILE, 'utf8'));

const DROP_REQUEST = new Set([
  'host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer',
  'content-length', 'accept-encoding', 'cookie', 'origin', 'referer', 'if-none-match', 'if-modified-since',
  'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'x-real-ip', 'forwarded',
  'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'cf-ipcountry', 'cdn-loop',
]);

const DROP_RESPONSE = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length', 'x-frame-options',
  'content-security-policy', 'content-security-policy-report-only', 'strict-transport-security',
  'cross-origin-embedder-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'set-cookie',
  'location', 'etag', 'last-modified', 'alt-svc', 'report-to', 'reporting-endpoints', 'nel', 'link', 'refresh',
]);

const TEXT_TYPES = /text\/html|text\/css|javascript|ecmascript|json|text\/x-component|xml/;

function parseCookies(header?: string) {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Cookie value is `<shareToken>` or `<shareToken>~<previewKey>` (admin preview of a disabled link). */
function lookup(value: string | undefined): Project | null {
  if (!value) return null;
  const [token, key] = value.split('~');
  const p = db.data.projects.find((x) => x.shareToken === token);
  if (!p || (!p.shareEnabled && !checkPreviewKey(token, key))) return null;
  return p;
}

const isSecure = (req: Request) => req.protocol === 'https';
const bareHost = (host: string) => host.replace(/^www\./i, '').toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const rewriteCache = new Map<string, RegExp>();
function hostPattern(targetOrigin: string) {
  let re = rewriteCache.get(targetOrigin);
  if (!re) {
    const host = escapeRe(bareHost(new URL(targetOrigin).host));
    // https://host, //host, and JSON-escaped https:\/\/host — with or without www.
    re = new RegExp(String.raw`(?:https?:)?(\/\/|\\\/\\\/)(?:www\.)?${host}(?![\w-]|\.[\w-])`, 'gi');
    rewriteCache.set(targetOrigin, re);
  }
  return re;
}

function rewriteText(text: string, targetOrigin: string, proxyOrigin: string) {
  const escaped = proxyOrigin.replace(/\//g, '\\/');
  return text.replace(hostPattern(targetOrigin), (_m, slashes: string) => (slashes === '//' ? proxyOrigin : escaped));
}

function rewriteLocation(location: string, targetOrigin: string, proxyOrigin: string) {
  try {
    const u = new URL(location, targetOrigin);
    if (bareHost(u.host) !== bareHost(new URL(targetOrigin).host)) return location;
    return proxyOrigin + u.pathname + u.search + u.hash;
  } catch {
    return location;
  }
}

function rewriteSetCookie(cookie: string, secure: boolean) {
  let parts = cookie.split(';').map((s) => s.trim()).filter((s) => s && !/^domain=/i.test(s));
  if (!secure) {
    parts = parts
      .filter((s) => !/^(secure|partitioned)$/i.test(s))
      .map((s) => (/^samesite=none$/i.test(s) ? 'SameSite=Lax' : s));
  }
  return parts.join('; ');
}

function injectBridge(html: string, cookieValue: string) {
  if (!/<(!doctype|html|head|body)\b/i.test(html.slice(0, 4000))) return html; // fragment, not a page
  html = html
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '')
    .replace(/\sintegrity=("[^"]*"|'[^']*')/gi, '');
  const tag =
    `<meta name="robots" content="noindex, nofollow">` +
    // Phones and trackpad Macs use overlay scrollbars; hide the classic gutter so the viewport is true to size.
    `<style>html{scrollbar-width:none}html::-webkit-scrollbar{display:none}</style>` +
    `<script>window.__BBP__=${JSON.stringify({ c: cookieValue })};\n${bridgeSource()}</script>`;
  const head = /<head\b[^>]*>/i.exec(html) ?? /<html\b[^>]*>/i.exec(html);
  if (!head) return tag + html;
  const at = head.index + head[0].length;
  return html.slice(0, at) + tag + html.slice(at);
}

function messagePage(res: Response, status: number, message: string) {
  res
    .status(status)
    .set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' })
    .send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Preview</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#f5f5f5;
font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#525252;text-align:center">
<div style="padding:24px"><div style="font-weight:700;color:#171717;margin-bottom:4px">Preview unavailable</div>${message}</div>`);
}

function readBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createProxyApp() {
  const app = express();
  app.set('trust proxy', true);
  app.set('etag', false);
  app.disable('x-powered-by');

  app.get('/__bbp/start', (req, res) => {
    const t = String(req.query.t ?? '');
    const k = String(req.query.k ?? '');
    const value = k ? `${t}~${k}` : t;
    const p = lookup(value);
    if (!p) return messagePage(res, 404, 'This prototype link is no longer active.');
    const q = typeof req.query.path === 'string' ? req.query.path : '';
    const to = /^\/(?!\/)/.test(q) ? q : p.startPath || '/';
    res.append('Set-Cookie', `${COOKIE}=${value}; Path=/; SameSite=Lax${isSecure(req) ? '; Secure' : ''}`);
    res.set('cache-control', 'no-store').redirect(302, to);
  });

  app.use(async (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const cookieValue = cookies[COOKIE];
    const p = lookup(cookieValue);
    if (!p) return messagePage(res, 404, 'Open this preview from its prototype link.');

    const proxyOrigin = `${req.protocol}://${req.get('host')}`;
    const target = new URL(req.originalUrl, p.targetOrigin);

    const headers: Record<string, string> = { 'accept-encoding': 'gzip, deflate, br' };
    for (const [k, v] of Object.entries(req.headers)) {
      if (v != null && !DROP_REQUEST.has(k)) headers[k] = Array.isArray(v) ? v.join(', ') : v;
    }
    const siteCookies = (req.headers.cookie ?? '')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith(`${COOKIE}=`))
      .join('; ');
    if (siteCookies) headers.cookie = siteCookies;
    if (req.headers.origin) headers.origin = p.targetOrigin;
    if (req.headers.referer) headers.referer = req.headers.referer.replace(proxyOrigin, p.targetOrigin);

    // The timeout covers waiting for the site to respond, not the body: large media can stream for minutes.
    // Aborting when the viewer goes away stops us downloading bodies nobody will read.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30000);
    res.on('close', () => abort.abort());

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(target, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : new Uint8Array(await readBody(req)),
        redirect: 'manual',
        signal: abort.signal,
      });
    } catch {
      return messagePage(res, 502, 'The preview is taking too long to respond. Try again in a moment.');
    } finally {
      clearTimeout(timer);
    }

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!DROP_RESPONSE.has(key)) res.setHeader(key, value);
    });
    const location = upstream.headers.get('location');
    if (location) res.setHeader('location', rewriteLocation(location, p.targetOrigin, proxyOrigin));
    const setCookies = upstream.headers.getSetCookie().map((c) => rewriteSetCookie(c, isSecure(req)));
    if (setCookies.length) res.setHeader('set-cookie', setCookies);
    res.setHeader('x-robots-tag', 'noindex, nofollow');

    if (req.method === 'HEAD' || upstream.status === 204 || upstream.status === 304 || !upstream.body) {
      return res.end();
    }

    const type = (upstream.headers.get('content-type') ?? '').toLowerCase();
    const size = Number(upstream.headers.get('content-length') ?? 0);
    if (TEXT_TYPES.test(type) && size < 20_000_000) {
      let body: string;
      try {
        body = await upstream.text();
      } catch {
        return res.headersSent ? res.destroy() : messagePage(res, 502, 'The preview didn’t finish loading. Try again in a moment.');
      }
      let text = rewriteText(body, p.targetOrigin, proxyOrigin);
      if (type.includes('text/html')) {
        text = injectBridge(text, cookieValue!);
        res.setHeader('cache-control', 'no-store');
      }
      res.setHeader('content-type', /charset=/.test(type) ? type.replace(/charset=[^;]+/, 'charset=utf-8') : type);
      return res.send(text);
    }

    // pipeline (unlike pipe) handles a failed or cancelled stream instead of crashing the process.
    pipeline(Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream), res, (err) => {
      if (err) res.destroy();
    });
  });

  return app;
}
