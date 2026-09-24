import type { CommentThread } from '../../shared/types';

/**
 * Where the app runs. The normal build talks to the Node server (API, live updates, preview proxy).
 * The demo build (`npm run build:demo`, for GitHub Pages) runs entirely in the browser: data lives in
 * localStorage and every prototype previews the bundled sample site in /demo-site.
 */
export const DEMO = import.meta.env.VITE_DEMO === '1';

const BASE = import.meta.env.BASE_URL;
const DEMO_SITE = `${BASE}demo-site/`;

export function shareUrl(token: string) {
  return DEMO ? `${location.origin}${BASE}#/p/${token}` : `${location.origin}/p/${token}`;
}

export function faviconUrl(token: string, previewKey: string) {
  return DEMO ? `${DEMO_SITE}favicon.svg` : `/api/share/${token}/favicon?k=${previewKey}`;
}

/** iframe src for a prototype, optionally reopening a specific page (as reported by the bridge). */
export function previewSrc(o: { proxyOrigin: string; token: string; previewKey?: string; path?: string }) {
  if (DEMO) return o.path?.startsWith(DEMO_SITE) ? o.path : `${DEMO_SITE}index.html`;
  return `${o.proxyOrigin}/__bbp/start?t=${encodeURIComponent(o.token)}${o.previewKey ? `&k=${o.previewKey}` : ''}${
    o.path ? `&path=${encodeURIComponent(o.path)}` : ''
  }`;
}

/** Live comment list for a prototype. Returns an unsubscribe function. */
export function subscribeComments(token: string, previewKey: string | undefined, onChange: (list: CommentThread[]) => void) {
  if (DEMO) {
    let off = () => {};
    let stopped = false;
    import('./demo').then((m) => {
      if (!stopped) off = m.subscribe(token, onChange);
    });
    return () => {
      stopped = true;
      off();
    };
  }
  const es = new EventSource(`/api/share/${token}/stream${previewKey ? `?k=${previewKey}` : ''}`);
  es.addEventListener('comments', (e) => onChange(JSON.parse((e as MessageEvent).data)));
  return () => es.close();
}
