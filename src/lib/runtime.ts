import type { CommentThread } from '../../shared/types';

/**
 * Where the app runs. The normal build talks to the Node server (API, live updates, preview proxy).
 * The demo build (`npm run build:demo`, for GitHub Pages) runs entirely in the browser: data lives in
 * localStorage and each prototype loads its link directly (no masking proxy).
 */
export const DEMO = import.meta.env.VITE_DEMO === '1';

const BASE = import.meta.env.BASE_URL;

/** Demo: the one line a site needs so comments work without the preview proxy. */
export const BRIDGE_SNIPPET = `<script src="${new URL(`${BASE}bridge.js`, location.href).href}"></script>`;

export function shareUrl(token: string) {
  return DEMO ? `${location.origin}${BASE}#/p/${token}` : `${location.origin}/p/${token}`;
}

export function faviconUrl(p: { shareToken: string; previewKey: string; url: string }) {
  return DEMO ? new URL('/favicon.ico', p.url).href : `/api/share/${p.shareToken}/favicon?k=${p.previewKey}`;
}

/** iframe src for a prototype, optionally reopening a specific page (as reported by the bridge). */
export function previewSrc(o: { proxyOrigin: string; token: string; previewKey?: string; path?: string; siteUrl?: string }) {
  if (DEMO) {
    // No proxy on GitHub Pages: load the site itself.
    const site = o.siteUrl ?? 'about:blank';
    return o.path ? new URL(o.path, site).href : site;
  }
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
