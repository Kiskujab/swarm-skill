'use client';
/*
 * React / Next.js wrapper for swarm-rebuild.
 *
 * 1) Copy swarm-rebuild.js and swarm-rebuild.css next to this file (e.g. components/swarm-rebuild/).
 * 2) Put <SwarmRebuildHead /> inside <head> of the root layout (app/layout.tsx) or _document.tsx,
 *    and <SwarmRebuild mode="fast" /> once, anywhere inside <body>.
 *    For the App Router also add suppressHydrationWarning to <html> only if you see warnings
 *    (the snippet never touches <html> attributes, so normally nothing is needed).
 *
 * The effect only starts after mount (no SSR work) and never touches React-owned DOM nodes.
 */
import { useEffect } from 'react';
import './swarm-rebuild.css';

// Runs before first paint: hides page content (layout untouched) when the effect will run.
// Visitors without JavaScript never execute it, so they always see the page.
export const SWARM_REBUILD_HEAD_SNIPPET =
  "(function(d,w){w.__swarmRebuildSnippet=1;try{var q=new URLSearchParams(location.search).get('rebuild');if(q==='0')return;if(w.matchMedia&&w.matchMedia('(prefers-reduced-motion: reduce)').matches)return;if(q!=='1'&&sessionStorage.getItem('swarm-rebuild:seen'))return;var s=d.createElement('style');s.id='swarm-rebuild-hide';s.textContent='@layer swarm-rebuild{body *{visibility:hidden!important}}';d.head.appendChild(s);setTimeout(function(){var r=w.SwarmRebuild;if(!(r&&r.active)){var e=d.getElementById('swarm-rebuild-hide');if(e)e.remove()}},5000)}catch(e){}})(document,window);";

export function SwarmRebuildHead() {
  return <script dangerouslySetInnerHTML={{ __html: SWARM_REBUILD_HEAD_SNIPPET }} />;
}

let mounts = 0;

export default function SwarmRebuild(props) {
  useEffect(() => {
    mounts++;
    let alive = true;
    import('./swarm-rebuild.js').then(() => {
      if (alive && window.SwarmRebuild) window.SwarmRebuild.start(props);
    });
    return () => {
      alive = false;
      mounts--;
      // React StrictMode mounts twice in development: only stop on a real unmount.
      setTimeout(() => { if (mounts === 0 && window.SwarmRebuild) window.SwarmRebuild.stop(); }, 0);
    };
    // options are read once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
