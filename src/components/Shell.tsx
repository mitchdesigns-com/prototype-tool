import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';

const BACKBONE = import.meta.env.VITE_BACKBONE_ORIGIN ?? 'https://backbone.mitchdesigns.com';

// Existing Backbone tabs, shown for context; Prototype is the new one.
const TABS = [
  { key: 'orbit', label: 'CRM', href: `${BACKBONE}/orbit` },
  { key: 'tm', label: 'Timetable', href: `${BACKBONE}/tm` },
  { key: 'team', label: 'Team', href: `${BACKBONE}/team` },
  { key: 'sitemaps', label: 'Sitemaps', href: `${BACKBONE}/sitemaps` },
  { key: 'prototype', label: 'Prototype', href: '/prototype' },
];

const pill =
  'inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors max-sm:px-2.5 xl:min-h-0 xl:py-1.5';

export function Shell({ active = 'prototype', children }: { active?: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-spaceGrey">
      <header className="flex min-h-11 flex-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 text-white xl:h-11 xl:flex-nowrap xl:gap-3 xl:py-0">
        <span className="select-none text-[15px] font-extrabold tracking-[-0.04em] text-brand">Backbone.</span>
        <nav className="flex flex-wrap items-center gap-1.5" aria-label="Workspaces">
          {TABS.map((t) =>
            t.key === active ? (
              <a key={t.key} href={t.href} aria-current="page" className={`${pill} bg-brand text-brand-foreground`}>
                {t.label}
                <span className="rounded-full bg-black/10 px-1.5 py-px text-[10px] font-semibold">Active</span>
              </a>
            ) : (
              <a
                key={t.key}
                href={t.href}
                target={t.href.startsWith('http') ? '_blank' : undefined}
                rel="noreferrer"
                className={`${pill} bg-white/10 text-white/85 hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 active:scale-[0.98]`}
              >
                {t.label}
                {t.href.startsWith('http') && <ExternalLink className="size-3 opacity-70" aria-hidden />}
              </a>
            ),
          )}
        </nav>
      </header>
      <main className="mx-2 mb-2 min-h-0 flex-1 overflow-auto rounded-xl bg-background">{children}</main>
    </div>
  );
}
