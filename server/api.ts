import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { Anchor, CommentThread, Device, ProjectAdmin, ProjectPublic, Role } from '../shared/types.ts';
import { checkPreviewKey, isAdmin, issueAdminToken, previewKeyFor, requireAdmin, safeEqual } from './auth.ts';
import { ADMIN_PASSWORD, PROXY_ORIGIN, PROXY_PORT } from './config.ts';
import { db, hashSecret, newId, type Project, type StoredComment } from './db.ts';

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

const now = () => new Date().toISOString();
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isDevice = (v: unknown): v is Device => v === 'desktop' || v === 'mobile';

export function proxyOriginFor(req: Request) {
  return PROXY_ORIGIN || `${req.protocol}://${req.hostname}:${PROXY_PORT}`;
}

/** Normalises what the admin typed and follows redirects so the proxy targets the final origin. */
async function resolveTarget(input: unknown) {
  let s = str(input, 2000);
  if (!s) throw new HttpError(400, 'Add the website link for this prototype');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new HttpError(400, 'That website link doesn’t look valid');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new HttpError(400, 'Use an http or https link');

  let final = url;
  let reachable = false;
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000), headers: { 'user-agent': UA } });
    final = new URL(r.url);
    reachable = r.ok;
    await r.body?.cancel();
  } catch {
    // Site may be down right now; keep the link as typed.
  }
  return { url: url.toString(), targetOrigin: final.origin, startPath: final.pathname + final.search, reachable };
}

function counts(projectId: string) {
  const cs = db.data.comments.filter((c) => c.projectId === projectId);
  return { openComments: cs.filter((c) => !c.resolved).length, totalComments: cs.length };
}

function toAdmin(p: Project): ProjectAdmin {
  const { nextNumber: _n, ...rest } = p;
  return { ...rest, lockDevice: !!p.lockDevice, ...counts(p.id), previewKey: previewKeyFor(p.shareToken) };
}

const toPublic = (p: Project): ProjectPublic => ({
  name: p.name,
  device: p.device,
  allowComments: p.allowComments,
  lockDevice: !!p.lockDevice,
});

function toThread(c: StoredComment): CommentThread {
  const { projectId: _p, secretHash: _s, replies, ...rest } = c;
  return { ...rest, replies: replies.map(({ secretHash: _h, ...r }) => r) };
}

const threadsFor = (projectId: string) =>
  db.data.comments.filter((c) => c.projectId === projectId).map(toThread);

function findProject(id: string) {
  const p = db.data.projects.find((x) => x.id === id);
  if (!p) throw new HttpError(404, 'Prototype not found');
  return p;
}

/** Share access: public link switched on, or an admin (bearer token or preview key). */
function shareProject(req: Request) {
  const p = db.data.projects.find((x) => x.shareToken === req.params.token);
  const key = req.get('x-preview-key') ?? req.query.k;
  if (!p || (!p.shareEnabled && !isAdmin(req) && !checkPreviewKey(p.shareToken, key))) {
    throw new HttpError(404, 'This prototype link isn’t available');
  }
  return p;
}

function findComment(p: Project, id: string) {
  const c = db.data.comments.find((x) => x.projectId === p.id && x.id === id);
  if (!c) throw new HttpError(404, 'Comment not found');
  return c;
}

function readAnchor(v: unknown): Anchor {
  const a = (v ?? {}) as Record<string, unknown>;
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : undefined);
  const x = num(a.x);
  const y = num(a.y);
  if (x === undefined || y === undefined) throw new HttpError(400, 'Missing comment position');
  const anchor: Anchor = { x, y, vw: num(a.vw) ?? 0 };
  const selector = str(a.selector, 1200);
  if (selector && num(a.ox) !== undefined && num(a.oy) !== undefined) {
    anchor.selector = selector;
    anchor.ox = num(a.ox);
    anchor.oy = num(a.oy);
  }
  const w = num(a.w);
  const h = num(a.h);
  if (w !== undefined && h !== undefined && w > 0 && h > 0) {
    anchor.w = Math.min(w, 20000);
    anchor.h = Math.min(h, 50000);
  }
  return anchor;
}

function author(req: Request) {
  const body = req.body ?? {};
  const name = str(body.author, 60);
  const authorId = str(body.authorId, 64);
  const secret = str(body.secret, 128);
  if (!name) throw new HttpError(400, 'Add your name so the team knows who commented');
  if (!authorId || secret.length < 16) throw new HttpError(400, 'Missing commenter identity');
  const role: Role = isAdmin(req) ? 'team' : 'guest';
  return { author: name, authorId, secretHash: hashSecret(secret), role };
}

function canModify(req: Request, secretHash: string) {
  const secret = str(req.body?.secret ?? req.get('x-comment-secret'), 128);
  return isAdmin(req) || (!!secret && safeEqual(hashSecret(secret), secretHash));
}

// --- Live updates -----------------------------------------------------------

const streams = new Map<string, Set<Response>>();

function broadcast(projectId: string) {
  const subs = streams.get(projectId);
  if (!subs?.size) return;
  const payload = `event: comments\ndata: ${JSON.stringify(threadsFor(projectId))}\n\n`;
  for (const res of subs) res.write(payload);
}

function changed(projectId: string) {
  const p = db.data.projects.find((x) => x.id === projectId);
  if (p) p.updatedAt = now();
  db.save();
  broadcast(projectId);
}

// --- Router -----------------------------------------------------------------

export function createApi() {
  const r = Router();
  r.use(express.json({ limit: '200kb' }));

  r.get('/config', (req, res) => {
    res.json({ proxyOrigin: proxyOriginFor(req), authRequired: !!ADMIN_PASSWORD });
  });

  r.post('/admin/login', (req, res) => {
    const pw = str(req.body?.password, 200);
    if (ADMIN_PASSWORD && !safeEqual(pw, ADMIN_PASSWORD)) throw new HttpError(401, 'That password isn’t right');
    res.json({ token: issueAdminToken() });
  });

  r.get('/admin/me', requireAdmin, (_req, res) => {
    res.json({ ok: true });
  });

  // Projects (admin only — these are the only responses that include the URL)

  r.get('/projects', requireAdmin, (_req, res) => {
    const list = [...db.data.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json(list.map(toAdmin));
  });

  r.post('/projects', requireAdmin, async (req, res) => {
    const name = str(req.body?.name, 120);
    if (!name) throw new HttpError(400, 'Give the prototype a name');
    const device = isDevice(req.body?.device) ? req.body.device : 'desktop';
    const target = await resolveTarget(req.body?.url);
    const p: Project = {
      id: newId(6),
      name,
      url: target.url,
      targetOrigin: target.targetOrigin,
      startPath: target.startPath,
      device,
      shareToken: newId(12),
      shareEnabled: true,
      allowComments: true,
      lockDevice: req.body?.lockDevice === true,
      createdAt: now(),
      updatedAt: now(),
      nextNumber: 1,
    };
    db.data.projects.push(p);
    db.save();
    res.status(201).json({ ...toAdmin(p), reachable: target.reachable });
  });

  r.get('/projects/:id', requireAdmin, (req, res) => {
    res.json(toAdmin(findProject(req.params.id as string)));
  });

  r.patch('/projects/:id', requireAdmin, async (req, res) => {
    const p = findProject(req.params.id as string);
    const b = req.body ?? {};
    if (b.name !== undefined) {
      const name = str(b.name, 120);
      if (!name) throw new HttpError(400, 'Give the prototype a name');
      p.name = name;
    }
    if (isDevice(b.device)) p.device = b.device;
    if (typeof b.shareEnabled === 'boolean') p.shareEnabled = b.shareEnabled;
    if (typeof b.allowComments === 'boolean') p.allowComments = b.allowComments;
    if (typeof b.lockDevice === 'boolean') p.lockDevice = b.lockDevice;
    let reachable: boolean | undefined;
    if (b.url !== undefined && str(b.url, 2000) !== p.url) {
      const t = await resolveTarget(b.url);
      Object.assign(p, { url: t.url, targetOrigin: t.targetOrigin, startPath: t.startPath });
      reachable = t.reachable;
    }
    p.updatedAt = now();
    db.save();
    res.json({ ...toAdmin(p), reachable });
  });

  r.post('/projects/:id/rotate-link', requireAdmin, (req, res) => {
    const p = findProject(req.params.id as string);
    p.shareToken = newId(12);
    p.updatedAt = now();
    db.save();
    res.json(toAdmin(p));
  });

  r.delete('/projects/:id', requireAdmin, (req, res) => {
    const p = findProject(req.params.id as string);
    db.data.projects.splice(db.data.projects.indexOf(p), 1);
    for (let i = db.data.comments.length - 1; i >= 0; i--) {
      if (db.data.comments[i].projectId === p.id) db.data.comments.splice(i, 1);
    }
    db.save();
    res.json({ ok: true });
  });

  // Share (anyone holding the link)

  r.get('/share/:token', (req, res) => {
    res.json(toPublic(shareProject(req)));
  });

  r.get('/share/:token/favicon', async (req, res) => {
    const p = shareProject(req);
    const icon = await favicon(p);
    if (!icon) throw new HttpError(404, 'No icon');
    res.set({ 'content-type': icon.type, 'cache-control': 'private, max-age=3600' }).send(icon.body);
  });

  r.get('/share/:token/comments', (req, res) => {
    res.json(threadsFor(shareProject(req).id));
  });

  r.get('/share/:token/stream', (req, res) => {
    const p = shareProject(req);
    res.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.flushHeaders();
    res.write(`event: comments\ndata: ${JSON.stringify(threadsFor(p.id))}\n\n`);
    const set = streams.get(p.id) ?? new Set();
    streams.set(p.id, set);
    set.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      set.delete(res);
    });
  });

  r.post('/share/:token/comments', (req, res) => {
    const p = shareProject(req);
    if (!p.allowComments) throw new HttpError(403, 'Comments are turned off for this prototype');
    const text = str(req.body?.text, 4000);
    if (!text) throw new HttpError(400, 'Write a comment first');
    const c: StoredComment = {
      id: newId(8),
      projectId: p.id,
      number: p.nextNumber++,
      path: str(req.body?.path, 600) || '/',
      pageTitle: str(req.body?.pageTitle, 200),
      device: isDevice(req.body?.device) && (!p.lockDevice || isAdmin(req)) ? req.body.device : p.device,
      anchor: readAnchor(req.body?.anchor),
      ...author(req),
      text,
      createdAt: now(),
      resolved: false,
      resolvedBy: null,
      replies: [],
    };
    db.data.comments.push(c);
    changed(p.id);
    res.status(201).json(toThread(c));
  });

  r.post('/share/:token/comments/:cid/replies', (req, res) => {
    const p = shareProject(req);
    if (!p.allowComments) throw new HttpError(403, 'Comments are turned off for this prototype');
    const c = findComment(p, req.params.cid as string);
    const text = str(req.body?.text, 4000);
    if (!text) throw new HttpError(400, 'Write a reply first');
    c.replies.push({ id: newId(8), ...author(req), text, createdAt: now() });
    changed(p.id);
    res.status(201).json(toThread(c));
  });

  r.patch('/share/:token/comments/:cid', (req, res) => {
    const p = shareProject(req);
    const c = findComment(p, req.params.cid as string);
    if (typeof req.body?.resolved === 'boolean') {
      c.resolved = req.body.resolved;
      c.resolvedBy = c.resolved ? str(req.body?.by, 60) || null : null;
    }
    changed(p.id);
    res.json(toThread(c));
  });

  r.delete('/share/:token/comments/:cid', (req, res) => {
    const p = shareProject(req);
    const c = findComment(p, req.params.cid as string);
    if (!canModify(req, c.secretHash)) throw new HttpError(403, 'Only the author or the team can delete this');
    db.data.comments.splice(db.data.comments.indexOf(c), 1);
    changed(p.id);
    res.json({ ok: true });
  });

  r.delete('/share/:token/comments/:cid/replies/:rid', (req, res) => {
    const p = shareProject(req);
    const c = findComment(p, req.params.cid as string);
    const reply = c.replies.find((x) => x.id === req.params.rid);
    if (!reply) throw new HttpError(404, 'Reply not found');
    if (!canModify(req, reply.secretHash)) throw new HttpError(403, 'Only the author or the team can delete this');
    c.replies.splice(c.replies.indexOf(reply), 1);
    changed(p.id);
    res.json(toThread(c));
  });

  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return r;
}

// --- Favicon (fetched server-side so the site's host never reaches the browser) ---

const iconCache = new Map<string, { at: number; icon: { type: string; body: Buffer } | null }>();

async function favicon(p: Project) {
  const key = p.targetOrigin + p.startPath;
  const hit = iconCache.get(key);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.icon;

  let icon: { type: string; body: Buffer } | null = null;
  try {
    const home = await fetch(key, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': UA } });
    const html = (await home.text()).slice(0, 200_000);
    const tags = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /rel=["']?[^"'>]*icon/i.test(t));
    const pick = tags.find((t) => /apple-touch-icon/i.test(t)) ?? tags.find((t) => /\.(png|svg)/i.test(t)) ?? tags[0];
    const href = pick && /href=["']([^"']+)["']/i.exec(pick)?.[1];
    const candidates = [href ? new URL(href, home.url) : null, new URL('/favicon.ico', p.targetOrigin)];
    for (const u of candidates) {
      if (!u) continue;
      const r = await fetch(u, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': UA } });
      const type = r.headers.get('content-type') ?? '';
      if (r.ok && type.startsWith('image/')) {
        icon = { type, body: Buffer.from(await r.arrayBuffer()) };
        break;
      }
    }
  } catch {
    // leave icon null
  }
  iconCache.set(key, { at: Date.now(), icon });
  return icon;
}
