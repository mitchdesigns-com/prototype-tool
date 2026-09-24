import type { Anchor, CommentThread, Device, ProjectAdmin, ProjectPublic, Reply, Role } from '../../shared/types';

/**
 * In-browser stand-in for server/api.ts, used by the GitHub Pages demo build only.
 * Same endpoints and shapes; data is kept in this browser's localStorage.
 */

const KEY = 'bbp_demo_v1';
const SITE_PATH = `${import.meta.env.BASE_URL}demo-site/`;

interface DemoProject extends Omit<ProjectAdmin, 'openComments' | 'totalComments'> {
  nextNumber: number;
}
type DemoReply = Reply & { secret?: string };
interface DemoComment extends Omit<CommentThread, 'replies'> {
  projectId: string;
  secret?: string;
  replies: DemoReply[];
}
interface Store {
  projects: DemoProject[];
  comments: DemoComment[];
}

export class DemoError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// --- Storage ---------------------------------------------------------------

const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
const id = () => Math.random().toString(36).slice(2, 10);

function seed(): Store {
  const home = `${SITE_PATH}index.html`;
  const story = `${SITE_PATH}story.html`;
  const project = (p: Partial<DemoProject> & Pick<DemoProject, 'id' | 'name' | 'url' | 'device' | 'shareToken'>): DemoProject => ({
    targetOrigin: new URL(p.url).origin,
    startPath: '/',
    shareEnabled: true,
    allowComments: true,
    lockDevice: false,
    createdAt: ago(30),
    updatedAt: ago(1),
    previewKey: 'demo',
    nextNumber: 1,
    ...p,
  });
  const comment = (c: Omit<DemoComment, 'id' | 'resolvedBy' | 'replies'> & { replies?: DemoReply[]; resolvedBy?: string | null }): DemoComment => ({
    id: id(),
    resolvedBy: null,
    replies: [],
    ...c,
  });
  const client = { author: 'Sarah (Client)', authorId: 'demo-sarah', role: 'guest' as Role };
  const team = { author: 'Mark — Mitch Designs', authorId: 'demo-mark', role: 'team' as Role };

  return {
    projects: [
      project({ id: 'nile-web', name: 'Nile Coffee — Website redesign', url: 'https://staging.nilecoffee.co', device: 'desktop', shareToken: 'nile-web-demo', nextNumber: 4 }),
      project({ id: 'nile-app', name: 'Nile Coffee — Ordering flow', url: 'https://preview.nilecoffee.co/order', device: 'mobile', lockDevice: true, shareToken: 'nile-app-demo', nextNumber: 2, updatedAt: ago(5) }),
    ],
    comments: [
      comment({
        projectId: 'nile-web', number: 1, path: home, pageTitle: 'Nile Coffee — Slow coffee, Cairo', device: 'desktop',
        anchor: { x: 0, y: 0, vw: 1512, selector: '#hero-title', ox: 60, oy: 30 },
        ...client, text: 'Love this headline! Could we try the second line in our brand green?', createdAt: ago(20), resolved: false,
        replies: [{ id: id(), ...team, text: 'Sure, I’ll send you two options tomorrow.', createdAt: ago(18) }],
      }),
      comment({
        projectId: 'nile-web', number: 2, path: home, pageTitle: 'Nile Coffee — Slow coffee, Cairo', device: 'desktop',
        anchor: { x: 0, y: 0, vw: 1512, selector: '#menu-grid', ox: 0, oy: 0, w: 1132, h: 310 },
        ...client, text: 'These prices are from last year. We’ll send the new menu before launch.', createdAt: ago(6), resolved: false,
      }),
      comment({
        projectId: 'nile-web', number: 3, path: story, pageTitle: 'Our story — Nile Coffee', device: 'desktop',
        anchor: { x: 0, y: 0, vw: 1512, selector: '#story-photo', ox: 120, oy: 90 },
        ...client, text: 'Please swap this for the new shop interior photo.', createdAt: ago(3), resolved: true, resolvedBy: 'Mark — Mitch Designs',
      }),
      comment({
        projectId: 'nile-app', number: 1, path: home, pageTitle: 'Nile Coffee — Slow coffee, Cairo', device: 'mobile',
        anchor: { x: 0, y: 0, vw: 430, selector: '#order-btn', ox: 40, oy: 12 },
        ...client, text: 'On my phone this button is a bit hard to find, can it stick to the bottom?', createdAt: ago(5), resolved: false,
      }),
    ],
  };
}

function read(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s?.projects && s?.comments) return s;
  } catch {
    // fall through to seed
  }
  const s = seed();
  write(s);
  return s;
}

function write(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable — demo data lasts for this page view
  }
}

let store = read();

// --- Live updates (this tab + other tabs of the same browser) ----------------

const subs = new Map<string, Set<(list: CommentThread[]) => void>>();

function threads(projectId: string): CommentThread[] {
  return store.comments
    .filter((c) => c.projectId === projectId)
    .map(({ projectId: _p, secret: _s, replies, ...c }) => ({ ...c, replies: replies.map(({ secret: _r, ...r }) => r) }));
}

function notify(projectId: string) {
  const p = store.projects.find((x) => x.id === projectId);
  if (!p) return;
  const list = threads(projectId);
  subs.get(p.shareToken)?.forEach((cb) => cb(list));
}

window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  store = read();
  store.projects.forEach((p) => notify(p.id));
});

export function subscribe(token: string, cb: (list: CommentThread[]) => void) {
  const set = subs.get(token) ?? new Set();
  subs.set(token, set);
  set.add(cb);
  const p = store.projects.find((x) => x.shareToken === token);
  if (p) cb(threads(p.id));
  return () => set.delete(cb);
}

function commit(projectId?: string) {
  if (projectId) {
    const p = store.projects.find((x) => x.id === projectId);
    if (p) p.updatedAt = new Date().toISOString();
  }
  write(store);
  if (projectId) notify(projectId);
}

// --- Endpoints ------------------------------------------------------------------

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isDevice = (v: unknown): v is Device => v === 'desktop' || v === 'mobile';

function toAdmin(p: DemoProject): ProjectAdmin {
  const { nextNumber: _n, ...rest } = p;
  const cs = store.comments.filter((c) => c.projectId === p.id);
  return { ...rest, openComments: cs.filter((c) => !c.resolved).length, totalComments: cs.length };
}

const toPublic = (p: DemoProject): ProjectPublic => ({ name: p.name, device: p.device, allowComments: p.allowComments, lockDevice: p.lockDevice });

function toThread(c: DemoComment): CommentThread {
  return threads(c.projectId).find((t) => t.id === c.id)!;
}

function project(pid: string) {
  const p = store.projects.find((x) => x.id === pid);
  if (!p) throw new DemoError(404, 'Prototype not found');
  return p;
}

function share(token: string, admin: boolean) {
  const p = store.projects.find((x) => x.shareToken === token);
  if (!p || (!p.shareEnabled && !admin)) throw new DemoError(404, 'This prototype link isn’t available');
  return p;
}

function findComment(p: DemoProject, cid: string) {
  const c = store.comments.find((x) => x.projectId === p.id && x.id === cid);
  if (!c) throw new DemoError(404, 'Comment not found');
  return c;
}

function author(body: Record<string, unknown>, admin: boolean) {
  const name = str(body.author, 60);
  if (!name) throw new DemoError(400, 'Add your name so the team knows who commented');
  return { author: name, authorId: str(body.authorId, 64), secret: str(body.secret, 128), role: (admin ? 'team' : 'guest') as Role };
}

function url(input: unknown) {
  let s = str(input, 2000);
  if (!s) throw new DemoError(400, 'Add the website link for this prototype');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    return new URL(s);
  } catch {
    throw new DemoError(400, 'That website link doesn’t look valid');
  }
}

export async function demoApi<T>(path: string, opts: { method?: string; body?: unknown }, admin: boolean): Promise<T> {
  const method = opts.method ?? 'GET';
  const b = (opts.body ?? {}) as Record<string, unknown>;
  const m = (re: RegExp) => re.exec(path);
  let r: RegExpExecArray | null;
  const out = (v: unknown) => v as T;

  if (path === '/config') return out({ proxyOrigin: location.origin, authRequired: false });
  if (path === '/admin/login') return out({ token: 'demo' });
  if (path === '/admin/me') return out({ ok: true });

  if (path === '/projects' && method === 'GET') {
    return out([...store.projects].sort((a, z) => z.updatedAt.localeCompare(a.updatedAt)).map(toAdmin));
  }
  if (path === '/projects' && method === 'POST') {
    const name = str(b.name, 120);
    if (!name) throw new DemoError(400, 'Give the prototype a name');
    const u = url(b.url);
    const now = new Date().toISOString();
    const p: DemoProject = {
      id: id(), name, url: u.toString(), targetOrigin: u.origin, startPath: u.pathname,
      device: isDevice(b.device) ? b.device : 'desktop', shareToken: id() + id(), shareEnabled: true,
      allowComments: true, lockDevice: b.lockDevice === true, createdAt: now, updatedAt: now, previewKey: 'demo', nextNumber: 1,
    };
    store.projects.push(p);
    commit();
    return out(toAdmin(p));
  }
  if ((r = m(/^\/projects\/([^/]+)$/))) {
    const p = project(r[1]);
    if (method === 'GET') return out(toAdmin(p));
    if (method === 'DELETE') {
      store.projects = store.projects.filter((x) => x !== p);
      store.comments = store.comments.filter((c) => c.projectId !== p.id);
      commit();
      return out({ ok: true });
    }
    if (method === 'PATCH') {
      if (b.name !== undefined) {
        const name = str(b.name, 120);
        if (!name) throw new DemoError(400, 'Give the prototype a name');
        p.name = name;
      }
      if (isDevice(b.device)) p.device = b.device;
      for (const k of ['shareEnabled', 'allowComments', 'lockDevice'] as const) if (typeof b[k] === 'boolean') p[k] = b[k] as boolean;
      if (b.url !== undefined && str(b.url, 2000) !== p.url) {
        const u = url(b.url);
        Object.assign(p, { url: u.toString(), targetOrigin: u.origin, startPath: u.pathname });
      }
      commit(p.id);
      return out(toAdmin(p));
    }
  }
  if ((r = m(/^\/projects\/([^/]+)\/rotate-link$/))) {
    const p = project(r[1]);
    p.shareToken = id() + id();
    commit();
    return out(toAdmin(p));
  }

  if ((r = m(/^\/share\/([^/]+)$/))) return out(toPublic(share(r[1], admin)));
  if ((r = m(/^\/share\/([^/]+)\/comments$/))) {
    const p = share(r[1], admin);
    if (method === 'GET') return out(threads(p.id));
    if (!p.allowComments) throw new DemoError(403, 'Comments are turned off for this prototype');
    const text = str(b.text, 4000);
    if (!text) throw new DemoError(400, 'Write a comment first');
    const c: DemoComment = {
      id: id(), projectId: p.id, number: p.nextNumber++, path: str(b.path, 600) || '/', pageTitle: str(b.pageTitle, 200),
      device: isDevice(b.device) && (!p.lockDevice || admin) ? b.device : p.device, anchor: b.anchor as Anchor,
      ...author(b, admin), text, createdAt: new Date().toISOString(), resolved: false, resolvedBy: null, replies: [],
    };
    store.comments.push(c);
    commit(p.id);
    return out(toThread(c));
  }
  if ((r = m(/^\/share\/([^/]+)\/comments\/([^/]+)\/replies$/))) {
    const p = share(r[1], admin);
    const c = findComment(p, r[2]);
    const text = str(b.text, 4000);
    if (!text) throw new DemoError(400, 'Write a reply first');
    c.replies.push({ id: id(), ...author(b, admin), text, createdAt: new Date().toISOString() });
    commit(p.id);
    return out(toThread(c));
  }
  if ((r = m(/^\/share\/([^/]+)\/comments\/([^/]+)\/replies\/([^/]+)$/))) {
    const p = share(r[1], admin);
    const c = findComment(p, r[2]);
    const reply = c.replies.find((x) => x.id === r![3]);
    if (!reply) throw new DemoError(404, 'Reply not found');
    if (!admin && reply.secret !== b.secret) throw new DemoError(403, 'Only the author or the team can delete this');
    c.replies = c.replies.filter((x) => x !== reply);
    commit(p.id);
    return out(toThread(c));
  }
  if ((r = m(/^\/share\/([^/]+)\/comments\/([^/]+)$/))) {
    const p = share(r[1], admin);
    const c = findComment(p, r[2]);
    if (method === 'PATCH') {
      if (typeof b.resolved === 'boolean') {
        c.resolved = b.resolved;
        c.resolvedBy = c.resolved ? str(b.by, 60) || null : null;
      }
      commit(p.id);
      return out(toThread(c));
    }
    if (method === 'DELETE') {
      if (!admin && c.secret !== b.secret) throw new DemoError(403, 'Only the author or the team can delete this');
      store.comments = store.comments.filter((x) => x !== c);
      commit(p.id);
      return out({ ok: true });
    }
  }
  throw new DemoError(404, 'Not found');
}

/** Resets the demo to its sample data. */
export function resetDemo() {
  store = seed();
  write(store);
  store.projects.forEach((p) => notify(p.id));
}
