'use client';
/*
 * React / Next.js wrapper for swarm-rebuild.
 *
 * 1) Copy swarm-rebuild.js, swarm-rebuild.css and swarm-rebuild-debug.js next to this file
 *    (e.g. components/swarm-rebuild/).
 * 2) Put <SwarmRebuildHead /> inside <head> of the root layout (app/layout.tsx) or _document.tsx,
 *    and <SwarmRebuild /> once, anywhere inside <body>. Options are props (mode, exclude, ...).
 *
 * The effect only starts after mount (no SSR work) and never touches React-owned DOM nodes.
 * The debug add-on (control bar, tour, test hooks) is a separate chunk: it is fetched only with
 * ?rebuild-debug=1 or the debug prop, so visitors never download it.
 */
import { useEffect } from 'react';
import './swarm-rebuild.css';

// Runs before first paint: hides page content (layout untouched) when the effect will run and starts the
// safety timer that shows the page again if the module never starts. Visitors without JavaScript never
// execute it, so they always see the page. (Same text as SwarmRebuild.headSnippet().)
export const SWARM_REBUILD_HEAD_SNIPPET =
  "(function(d,w){w.__swarmRebuildSnippet=1;try{var q=new URLSearchParams(location.search).get('rebuild');if(q==='0')return;if(/bot\\b|crawl|spider|slurp|mediapartners|inspectiontool|facebookexternalhit|embedly|preview|whatsapp|telegram|discord|semrush|ahrefs|yandex|baidu|duckduck|petal|bytespider/i.test(navigator.userAgent||''))return;if(w.matchMedia&&w.matchMedia('(prefers-reduced-motion: reduce)').matches)return;if(q!=='1'&&sessionStorage.getItem('swarm-rebuild:seen'))return;var s=d.createElement('style');s.id='swarm-rebuild-hide';s.textContent='@layer swarm-rebuild{body *{visibility:var(--sr-v,hidden)!important}#swarm-rebuild-root{opacity:var(--sr-o,1)!important}}';d.head.appendChild(s);try{w.__srDms=d.documentElement.animate([{'--sr-v':'visible','--sr-o':'0'}],{duration:1,delay:5000,fill:'forwards'})}catch(e){}setTimeout(function(){var r=w.SwarmRebuild;if(!(r&&r.active)){var e=d.getElementById('swarm-rebuild-hide');if(e)e.remove()}},5000)}catch(e){}})(document,window);";

export function SwarmRebuildHead() {
  return <script dangerouslySetInnerHTML={{ __html: SWARM_REBUILD_HEAD_SNIPPET }} />;
}

let mounts = 0;

export default function SwarmRebuild(props) {
  useEffect(() => {
    mounts++;
    let alive = true;
    const debug = props.debug || /[?&]rebuild-debug=1(&|$)/.test(window.location.search);
    (debug ? import('./swarm-rebuild-debug.js') : Promise.resolve())
      .then(() => import('./swarm-rebuild.js'))
      .then(() => { if (alive && window.SwarmRebuild) window.SwarmRebuild.start(props); })
      .catch(() => { const e = document.getElementById('swarm-rebuild-hide'); if (e) e.remove(); });
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
