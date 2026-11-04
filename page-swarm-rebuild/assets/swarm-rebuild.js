/*!
 * swarm-rebuild v1.0.0
 * "The page rebuilds itself": a swarm of agent cursors re-creates an existing
 * page layer by layer (frames, typing, image reveals, clone-and-rewrite),
 * with an auto-scrolling tour and a small control bar.
 *
 * - No dependencies, no network requests.
 * - Presentation only: the page's own DOM (everything inside <body>) is never
 *   modified. Hiding/revealing is done with one cascade-layered stylesheet in
 *   <head>; animation happens in an overlay appended to <html>. When the effect
 *   ends, both are removed and the document is back to its original state.
 * - Works as a classic <script> (window.SwarmRebuild) or as a side-effect
 *   import from a bundler (React / Next.js client component).
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.SwarmRebuild && window.SwarmRebuild.version) return;

  var VERSION = '1.0.0';
  var LAYER = 'swarm-rebuild';
  var HIDE_ID = 'swarm-rebuild-hide';
  var REVEAL_ID = 'swarm-rebuild-reveal';
  var ROOT_ID = 'swarm-rebuild-root';
  var SEEN_KEY = 'swarm-rebuild:seen';
  var HUD_KEY = 'swarm-rebuild:hud';      // visitor's collapse choice for the control bar (this session)
  var AHEAD = 0.5;                        // visitor-driven: build at most half a viewport below the visible area
  var HIDE_CSS = '@layer ' + LAYER + '{body *{visibility:hidden!important}}';
  var PALETTE = ['#5fd6e8', '#f4a3b8', '#f6c48d', '#a99cf5', '#6aa7ff', '#8fe3b5', '#f2f4f8'];
  var MODE_SPEED = { tour: 1, fast: 6, scroll: 3 };
  var LAYERS_PER_SEC = 7.1; // video: 364 layers in 51.4 s at 1x

  var DEFAULTS = {
    mode: 'fast',            // 'tour' | 'fast' | 'scroll'
    speed: null,             // base time scale; null = per mode (tour 1, fast 6, scroll 3)
    agents: null,            // max agents; null = auto (layers/8, clamped 10..30)
    colors: PALETTE,
    exclude: '',             // CSS selector: shown immediately, never animated
    instant: 'a[href^="tel:"],[data-swarm-instant]', // shown immediately (phone, booking...)
    sectionSelector: 'header,section,footer,[data-swarm-section]',
    motionOffSelector: '[data-motion="off"],.motion-off,.reduce-motion',
    skipIf: null,            // function returning true to skip the effect
    monogram: null,          // text shown while scanning; null = first letter of <title>
    once: true,              // run once per browser session (sessionStorage)
    autoExit: null,          // seconds after finishing to "Go live" automatically; null = per mode
    groupMin: 3,             // min. repeated siblings to use clone-and-rewrite
    rulers: true,
    controlsPosition: 'right', // control bar: 'right' | 'left' | 'bottom' (mobile: a small tab near a free corner)
    avoid: 'a[href^="tel:"],a[href^="mailto:"],button,[role="button"],input,select,textarea,[data-swarm-avoid]', // the mobile tab never covers these
    force: false,
    onDone: null
  };

  // ---------------------------------------------------------------- helpers
  function now() { return performance.now() / 1000; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function mk(tag, cls, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }
  function alphaOf(c) {
    if (!c || c === 'transparent') return 0;
    var m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return 1;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean);
    return p.length > 3 ? parseFloat(p[3]) : 1;
  }
  function params() {
    try { return new URLSearchParams(location.search); } catch (e) { return { get: function () { return null; } }; }
  }
  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function store(k, v) {
    try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; }
  }
  function assign(t) {
    for (var i = 1; i < arguments.length; i++) {
      var s = arguments[i];
      if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k) && s[k] !== undefined) t[k] = s[k];
    }
    return t;
  }
  function pathOf(el) {
    var parts = [];
    while (el && el !== document.body && el.parentElement) {
      var i = 1, s = el;
      while ((s = s.previousElementSibling)) i++;
      parts.unshift(':nth-child(' + i + ')');
      el = el.parentElement;
    }
    return 'body>' + parts.join('>');
  }
  function shortAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICON_ARROW = '<svg class="sr-i-arrow" width="22" height="22" viewBox="0 0 24 24"><path d="M3.3 2.6 21 10.1c.7.3.6 1.3-.1 1.5l-7.4 1.9-1.9 7.4c-.2.7-1.2.8-1.5.1L2.6 3.3c-.2-.5.2-.9.7-.7Z" fill="currentColor" stroke="rgba(255,255,255,.85)" stroke-width="1.1" stroke-linejoin="round"/></svg>';
  var ICON_CROSS = '<svg class="sr-i-cross" width="18" height="18" viewBox="0 0 18 18"><path d="M9 1v16M1 9h16" stroke="rgba(6,10,18,.75)" stroke-width="4" stroke-linecap="round"/><path d="M9 1.5v15M1.5 9h15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var ICON_IBEAM = '<svg class="sr-i-ibeam" width="10" height="20" viewBox="0 0 10 20"><path d="M2 1.5c1.6 0 3 .6 3 2v13c0 1.4-1.4 2-3 2M8 1.5c-1.6 0-3 .6-3 2v13c0 1.4 1.4 2 3 2M3 10h4" fill="none" stroke="rgba(6,10,18,.8)" stroke-width="3" stroke-linecap="round"/><path d="M2 1.5c1.6 0 3 .6 3 2v13c0 1.4-1.4 2-3 2M8 1.5c-1.6 0-3 .6-3 2v13c0 1.4 1.4 2 3 2M3 10h4" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/></svg>';
  var ICON_IMG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg>';

  var MEDIA = { img: 1, video: 1, canvas: 1, svg: 1, picture: 1, iframe: 1, object: 1, embed: 1 };
  var CONTROL = { input: 1, textarea: 1, select: 1 };
  var SKIP_TAG = { script: 1, style: 1, noscript: 1, template: 1, link: 1, meta: 1, br: 1, wbr: 1, source: 1, track: 1, slot: 1 };
  var SKIP_PROP = { visibility: 1, cursor: 1, 'pointer-events': 1, 'will-change': 1, 'user-select': 1, '-webkit-user-select': 1 };

  // ------------------------------------------------------- hide / reveal css
  function hideEl() { return document.getElementById(HIDE_ID); }
  function ensureHide() {
    var e = hideEl();
    if (!e) {
      e = document.createElement('style');
      e.id = HIDE_ID;
      e.textContent = HIDE_CSS;
      (document.head || document.documentElement).appendChild(e);
    }
    return e;
  }
  function removeStyles() {
    var a = hideEl(); if (a) a.remove();
    var b = document.getElementById(REVEAL_ID); if (b) b.remove();
  }

  // ---------------------------------------------------------------- proxies
  // Deep clone with computed styles inlined, positioned in document coords.
  function copyStyles(src, dst) {
    var cs = getComputedStyle(src), s = '';
    for (var i = 0; i < cs.length; i++) {
      var p = cs[i];
      if (p.charCodeAt(0) === 45 && p.charCodeAt(1) === 45) continue;
      if (SKIP_PROP[p] || p.indexOf('transition') === 0 || p.indexOf('animation') === 0) continue;
      s += p + ':' + cs.getPropertyValue(p) + ';';
    }
    dst.setAttribute('style', s + 'visibility:visible;transition:none;animation:none;');
    if (dst.removeAttribute) { dst.removeAttribute('id'); dst.removeAttribute('name'); }
    var n = dst.localName;
    if (n === 'img') { dst.loading = 'eager'; dst.decoding = 'sync'; }
    if (n === 'video') { dst.muted = true; dst.autoplay = false; dst.removeAttribute('autoplay'); }
    var sc = src.children, dc = dst.children;
    for (var j = 0; j < sc.length && j < dc.length; j++) copyStyles(sc[j], dc[j]);
  }
  function makeProxy(st, el, R, empty) {
    var c = el.cloneNode(true);
    copyStyles(el, c);
    var s = c.style;
    s.position = 'absolute'; s.left = R.x + 'px'; s.top = R.y + 'px';
    s.width = R.w + 'px'; s.height = R.h + 'px'; s.margin = '0'; s.boxSizing = 'border-box';
    s.transform = 'none'; s.translate = 'none'; s.rotate = 'none'; s.scale = 'none';
    s.inset = 'auto'; s.left = R.x + 'px'; s.top = R.y + 'px';
    s.transformOrigin = '0 0'; s.zIndex = 'auto'; s.opacity = '1';
    c.setAttribute('aria-hidden', 'true');
    c.setAttribute('inert', '');
    st.world.appendChild(c);
    var typer = new Typer(c, empty, st.world);
    return { el: c, typer: typer };
  }
  function Typer(root, empty, world) {
    this.world = world;
    this.nodes = [];
    this.total = 0;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = w.nextNode())) {
      if (!/\S/.test(n.data)) continue;
      var full = n.data.replace(/\s+/g, ' ');
      this.nodes.push({ n: n, full: full, shown: full.length });
      this.total += full.length;
    }
    this.caret = null;
    if (empty) this.set(0);
  }
  Typer.prototype.set = function (k) {
    var rem = Math.max(0, Math.floor(k)), last = null;
    for (var i = 0; i < this.nodes.length; i++) {
      var o = this.nodes[i], take = Math.min(rem, o.full.length);
      if (o.shown !== take) { o.n.data = o.full.slice(0, take); o.shown = take; }
      rem -= take;
      if (take > 0 || !last) last = o;
    }
    // caret: absolutely positioned at the end of the typed text, moved with transforms (no layout shift)
    if (!this.caret && last && this.world) {
      this.caret = document.createElement('i'); this.caret.className = 'sr-caret';
      this.caret.style.color = getComputedStyle(last.n.parentNode).color;
      this.world.appendChild(this.caret);
    }
    if (this.caret && last && last.n.parentNode) {
      var r = this.range || (this.range = document.createRange()), len = last.n.data.length, rc;
      if (len) { r.setStart(last.n, len - 1); r.setEnd(last.n, len); rc = r.getBoundingClientRect(); }
      else { rc = last.n.parentNode.getBoundingClientRect(); rc = { right: rc.left, top: rc.top, height: Math.min(rc.height, 40) }; }
      this.caret.style.height = Math.max(8, rc.height) + 'px';
      this.caret.style.transform = 'translate3d(' + (rc.right + window.scrollX + 1) + 'px,' + (rc.top + window.scrollY) + 'px,0)';
    }
  };
  Typer.prototype.end = function () { this.set(this.total); if (this.caret) this.caret.remove(); this.caret = null; };

  // -------------------------------------------------------------- overlay UI
  function Sel(st, red) {
    var e = mk('div', 'sr-sel' + (red ? ' sr-red' : ''), st.world);
    var hp = this.hp = {};
    ['tl', 'tr', 'bl', 'br', 'tm', 'bm', 'ml', 'mr'].forEach(function (k) { hp[k] = mk('i', 'sr-h-' + k, e); });
    this.label = mk('span', 'sr-size', e);
    this.el = e; this.txt = ''; this.big = false; this.st = st;
    this.ghost = null; this.hist = [];
  }
  Sel.prototype.set = function (x, y, w, h, ghost) {
    var s = this.el.style;
    s.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    s.width = w + 'px'; s.height = h + 'px';
    var t = Math.round(w) + ' × ' + Math.round(h);
    if (t !== this.txt) { this.label.textContent = t; this.txt = t; }
    var big = w > 220 && h > 120;
    if (big !== this.big) { this.el.classList.toggle('sr-big', big); this.big = big; }
    // handles + label are moved with transforms (never layout) so the overlay causes no layout shift
    var hp = this.hp, pos = { tr: [w, 0], bl: [0, h], br: [w, h], tm: [w / 2, 0], bm: [w / 2, h], ml: [0, h / 2], mr: [w, h / 2] };
    for (var k in pos) hp[k].style.transform = 'translate(' + pos[k][0] + 'px,' + pos[k][1] + 'px)';
    this.label.style.transform = 'translate(' + (w / 2) + 'px,' + (h + 7) + 'px) translateX(-50%)';
    this.x = x; this.y = y; this.w = w; this.h = h;
    if (ghost) {
      this.hist.unshift([x, y, w, h]);
      if (this.hist.length > 6) this.hist.length = 6;
      if (!this.ghost) this.ghost = mk('div', 'sr-sel-ghost', this.st.world);
      var g = this.hist[this.hist.length - 1];
      var gs = this.ghost.style;
      gs.transform = 'translate3d(' + g[0] + 'px,' + g[1] + 'px,0)';
      gs.width = g[2] + 'px'; gs.height = g[3] + 'px';
    } else if (this.ghost) { this.ghost.remove(); this.ghost = null; }
  };
  Sel.prototype.out = function () {
    var e = this.el, g = this.ghost;
    e.classList.add('sr-out');
    if (g) g.remove();
    setTimeout(function () { e.remove(); }, 260);
  };
  function Ph(st, media) {
    var e = mk('div', 'sr-ph' + (media ? ' sr-ph-media' : ''), st.world);
    if (media) e.innerHTML = ICON_IMG;
    this.el = e;
  }
  Ph.prototype.set = function (x, y, w, h) {
    var s = this.el.style;
    s.transform = 'translate3d(' + x + 'px,' + y + 'px,0)'; s.width = w + 'px'; s.height = h + 'px';
  };
  Ph.prototype.remove = function () { this.el.remove(); };

  function Agent(st, i) {
    this.i = i;
    this.color = st.o.colors[i % st.o.colors.length];
    this.x = 0; this.y = 0; this.ang = 0; this.mode = ''; this.task = null; this.active = false;
    this.hist = []; this.tx = 0; this.ty = 0; this.vx = 0; this.vy = 0; this.next = 0;
    this.el = mk('div', 'sr-agent', st.agentLayer);
    this.el.innerHTML = ICON_ARROW + ICON_CROSS + ICON_IBEAM;
    this.el.style.color = this.color;
    this.ghosts = [];
    for (var k = 0; k < 3; k++) {
      var g = mk('div', 'sr-agent sr-ghost', st.agentLayer);
      g.innerHTML = ICON_ARROW + ICON_CROSS + ICON_IBEAM;
      g.style.color = this.color;
      this.ghosts.push(g);
    }
    this.setMode('arrow');
    this.show(false);
  }
  Agent.prototype.setMode = function (m) {
    if (m === this.mode) return;
    this.mode = m;
    var c = 'sr-agent sr-m-' + m;
    this.el.className = c;
    for (var k = 0; k < 3; k++) this.ghosts[k].className = c + ' sr-ghost';
  };
  Agent.prototype.show = function (on) {
    this.active = on;
    var d = on ? '' : 'none';
    this.el.style.display = d;
    for (var k = 0; k < 3; k++) this.ghosts[k].style.display = d;
  };

  // =================================================================== run
  var S = null;
  var api = {
    version: VERSION,
    active: false,
    start: start,
    stop: function () { if (S) teardown(S, false); },
    skip: function () { if (S) finishNow(S); },
    goLive: function () { if (S) finishNow(S); },
    replay: function () { if (S) replay(S); },
    state: function () { return S ? snapshot(S) : { phase: 'idle' }; },
    stats: function () { return S ? fpsStats(S) : (api._lastStats || null); },
    headSnippet: function () { return '<script>' + SNIPPET + '<\/script>'; }
  };
  var SNIPPET = "(function(d,w){w.__swarmRebuildSnippet=1;try{var q=new URLSearchParams(location.search).get('rebuild');if(q==='0')return;if(w.matchMedia&&w.matchMedia('(prefers-reduced-motion: reduce)').matches)return;if(q!=='1'&&sessionStorage.getItem('swarm-rebuild:seen'))return;var s=d.createElement('style');s.id='swarm-rebuild-hide';s.textContent='@layer swarm-rebuild{body *{visibility:hidden!important}}';d.head.appendChild(s);setTimeout(function(){var r=w.SwarmRebuild;if(!(r&&r.active)){var e=d.getElementById('swarm-rebuild-hide');if(e)e.remove()}},5000)}catch(e){}})(document,window);";

  function motionOff(o) {
    try { return !!(o.motionOffSelector && document.querySelector(o.motionOffSelector)); } catch (e) { return false; }
  }

  function start(userOpts) {
    if (S) return api;
    var q = params();
    var o = assign({}, DEFAULTS, window.SwarmRebuildConfig, userOpts);
    if (q.get('rebuild-mode')) o.mode = q.get('rebuild-mode');
    if (!MODE_SPEED[o.mode]) o.mode = 'fast';
    var force = o.force || q.get('rebuild') === '1';
    var skip = q.get('rebuild') === '0' || reducedMotion() || motionOff(o) || (typeof o.skipIf === 'function' && o.skipIf());
    if (!skip && !force && o.once && store(SEEN_KEY)) skip = true;
    if (!skip && !hideEl() && window.__swarmRebuildSnippet && !force) skip = true; // snippet decided "no" (or its watchdog fired)
    if (skip) { removeStyles(); return api; }
    ensureHide();
    store(SEEN_KEY, '1');
    run(o);
    return api;
  }

  function run(o) {
    var st = S = {
      o: o, t0: now(), last: now(), phase: 'scan', layers: [], queue: [], active: [], groups: [],
      tails: [], instant: [], reveals: [], doneLayers: 0, totalLayers: 0, tokens: 1, qHead: 0,
      mult: 1, touring: o.mode !== 'scroll', camY: 0, camV: 0, frames: [], rulersUntil: 0,
      sections: [], sectionOpen: [], timers: [], listeners: [], fixedEls: [],
      seenStats: { initial: { pending: 0, active: 0, done: 0 }, tour: { pending: 0, active: 0, done: 0 }, manual: { pending: 0, active: 0, done: 0 } },
      waits: [], maxAhead: 0
    };
    api.active = true;
    st.speedBase = o.speed || MODE_SPEED[o.mode];
    st.mobile = window.innerWidth < 760 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    st.useRulers = o.rulers && !st.mobile;
    st.pos = { right: 1, left: 1, bottom: 1 }[o.controlsPosition] ? o.controlsPosition : 'right';
    st.openScale = Math.min(st.speedBase, 3);
    st.scanDur = 0.85 / st.openScale;
    st.bg = pageBg();
    if (o.mode !== 'scroll') { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }
    st.camY = window.scrollY;
    buildOverlay(st);
    // provisional agent count for the opening swarm; refined after the scan
    st.maxAgents = clamp(o.agents || 30, 6, 30);
    if (st.mobile) st.maxAgents = Math.min(st.maxAgents, 8);
    createAgents(st);
    bindEvents(st);
    var fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    Promise.race([fontsReady, new Promise(function (r) { setTimeout(r, 700); })]).then(function () {
      if (S !== st) return;
      try { scan(st); plan(st); } catch (err) { console.warn('[swarm-rebuild] scan failed, showing page', err); finishNow(st); return; }
      st.scanned = true;
      measureGutter(st);
      autoCollapse(st);
      placeHud(st, true);
    });
    st.raf = requestAnimationFrame(function f() { if (S !== st) return; tick(st); st.raf = requestAnimationFrame(f); });
  }

  function pageBg() {
    var b = getComputedStyle(document.body).backgroundColor;
    if (alphaOf(b) > 0.5) return b;
    var h = getComputedStyle(document.documentElement).backgroundColor;
    if (alphaOf(h) > 0.5) return h;
    return '#0b0d12';
  }

  // ------------------------------------------------------------- overlay DOM
  function buildOverlay(st) {
    var root = mk('div', 'sr-root');
    root.id = ROOT_ID;
    root.style.setProperty('--sr-bg', st.bg);
    var deco = mk('div', 'sr-deco', root);
    deco.setAttribute('aria-hidden', 'true');
    st.world = mk('div', 'sr-world', deco);
    st.guideLayer = mk('div', 'sr-guides', deco);
    st.rulerTop = mk('div', 'sr-ruler sr-ruler-top', deco);
    st.rulerLeft = mk('div', 'sr-ruler sr-ruler-left', deco);
    st.rulerTopBand = mk('i', 'sr-rband', st.rulerTop);
    st.rulerLeftBand = mk('i', 'sr-rband', st.rulerLeft);
    var vw = window.innerWidth, vh = window.innerHeight, k;
    for (k = 100; k < vw; k += 100) { var a = mk('span', '', st.rulerTop); a.textContent = k; a.style.left = (k + 3) + 'px'; }
    for (k = 100; k < vh; k += 100) { var b = mk('span', '', st.rulerLeft); b.textContent = k; b.style.top = (k + 3) + 'px'; }
    st.agentLayer = mk('div', 'sr-agents', deco);
    st.mono = mk('div', 'sr-mono', deco);
    st.mono.textContent = st.o.monogram || ((document.title || 'S').trim().charAt(0) || 'S').toUpperCase();
    st.guides = [];
    for (k = 0; k < 16; k++) st.guides.push(mk('i', 'sr-guide', st.guideLayer));

    var hud = mk('div', 'sr-hud', root);
    hud.setAttribute('role', 'region');
    hud.setAttribute('aria-label', 'Page rebuild animation');
    hud.setAttribute('data-state', 'scan');
    hud.setAttribute('data-pos', st.pos);
    if (st.mobile) hud.setAttribute('data-mobile', '');
    st.hud = hud;
    st.btnTab = mk('button', 'sr-tab', hud);
    mk('i', 'sr-chev', st.btnTab).setAttribute('aria-hidden', 'true');
    var tb = mk('i', 'sr-tbar', st.btnTab);
    tb.setAttribute('aria-hidden', 'true');
    mk('b', '', tb);
    var stat = mk('div', 'sr-stat', hud);
    mk('span', 'sr-scan', stat).textContent = 'Scanning page…';
    var av = mk('span', 'sr-avatars', stat);
    for (k = 0; k < 5; k++) { var c = mk('i', '', av); c.style.background = st.o.colors[k % st.o.colors.length]; }
    st.hudAgents = mk('span', 'sr-n-agents', stat);
    st.hudLayers = mk('span', 'sr-n-layers', stat);
    st.hudLayers.setAttribute('aria-live', 'off');
    st.hudDone = mk('span', 'sr-donetext', stat);
    var bar = mk('div', 'sr-bar', hud);
    st.hudBar = mk('i', '', bar);
    var btns = mk('div', 'sr-btns', hud);
    st.btnTour = mk('button', 'sr-btn sr-tour', btns);
    st.btnSpeed = mk('button', 'sr-btn sr-speed', btns);
    st.btnLive = mk('button', 'sr-btn sr-live', btns);
    st.btnReplay = mk('button', 'sr-btn sr-replay', btns);
    st.btnClose = mk('button', 'sr-btn sr-close', btns);
    [st.btnTab, st.btnTour, st.btnSpeed, st.btnLive, st.btnReplay, st.btnClose].forEach(function (b) { b.type = 'button'; });
    st.btnTour.textContent = 'Tour';
    st.btnSpeed.textContent = '1×';
    st.btnSpeed.setAttribute('aria-label', 'Animation speed');
    st.btnLive.textContent = 'Go live';
    st.btnReplay.textContent = 'Replay';
    st.btnClose.textContent = '✕';
    st.btnClose.setAttribute('aria-label', 'Skip animation and show the page');
    st.btnTour.setAttribute('aria-pressed', 'false');
    st.btnTab.addEventListener('click', function () { setCollapsed(st, !st.collapsed, true); });
    st.btnTour.addEventListener('click', function () {
      st.touring = !st.touring; st.camV = 0; st.camY = window.scrollY;
      if (st.touring && st.followed) resumeTour(st);
      updateHud(st, true);
    });
    st.btnSpeed.addEventListener('click', function () { st.mult = st.mult === 1 ? 2 : st.mult === 2 ? 4 : 1; st.btnSpeed.textContent = st.mult + '×'; });
    st.btnLive.addEventListener('click', function () { finishNow(st); });
    st.btnReplay.addEventListener('click', function () { replay(st); });
    st.btnClose.addEventListener('click', function () { finishNow(st); });
    st.root = root;
    document.documentElement.appendChild(root);
    var pref = store(HUD_KEY);
    st.userCollapse = pref === 'collapsed' || pref === 'open';
    setCollapsed(st, pref ? pref === 'collapsed' : st.mobile, false);
    updateHud(st, true);
  }

  // ----------------------------------------------------- control bar place
  function setCollapsed(st, c, byUser) {
    st.collapsed = c;
    st.hud.classList.toggle('sr-collapsed', c);
    st.btnTab.setAttribute('aria-expanded', c ? 'false' : 'true');
    st.btnTab.setAttribute('aria-label', c ? 'Show animation controls' : 'Hide animation controls');
    if (byUser) { st.userCollapse = true; store(HUD_KEY, c ? 'collapsed' : 'open'); }
    placeHud(st, true);
  }
  // free space between the page content and the left / right viewport edge
  function measureGutter(st) {
    var cw = document.documentElement.clientWidth, sx = window.scrollX, minL = cw, maxR = 0;
    function acc(x, w) { if (w < 2 || w > cw * 0.85) return; minL = Math.min(minL, x - sx); maxR = Math.max(maxR, x - sx + w); }
    st.layers.forEach(function (L) { if (L.kind !== 'line') acc(L.x, L.w); });
    st.groups.forEach(function (g) { g.members.forEach(function (m) { if (m.R) acc(m.R.x, m.R.w); }); });
    st.gutter = { left: Math.max(0, minL), right: Math.max(0, cw - maxR) };
  }
  // desktop: if the expanded bar would sit on the page content, start as a thin tab
  function autoCollapse(st) {
    if (st.userCollapse || st.mobile || st.pos === 'bottom' || !st.gutter) return;
    var need = st.hud.classList.contains('sr-collapsed') ? 80 : st.hud.offsetWidth + 18;
    if (st.gutter[st.pos] < need && !st.collapsed) setCollapsed(st, true, false);
  }
  function obstacles(st) {
    var out = [], cw = document.documentElement.clientWidth, vh = window.innerHeight;
    function add(el) {
      if (!el.isConnected) return;
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= cw) return;
      if (r.width * r.height > cw * vh * 0.5) return; // full-screen fixed backgrounds are not obstacles
      out.push(r);
    }
    st.fixedEls.forEach(add);
    if (st.mobile) {
      if (!st.avoidEls || st.dirtyAvoid) {
        st.dirtyAvoid = false;
        var sel = [st.o.avoid, st.o.instant, st.o.exclude].filter(Boolean).join(',');
        try { st.avoidEls = Array.prototype.slice.call(document.body.querySelectorAll(sel), 0, 400); } catch (e) { st.avoidEls = []; }
        // links that look like buttons ("Book now", "Call us"): filled or outlined
        Array.prototype.slice.call(document.body.querySelectorAll('a[href]'), 0, 400).forEach(function (a) {
          var cs = getComputedStyle(a);
          if (alphaOf(cs.backgroundColor) > 0.1 || (parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.paddingLeft) >= 6)) st.avoidEls.push(a);
        });
      }
      st.avoidEls.forEach(add);
    }
    return out;
  }
  function hits(obs, x, y, w, h) {
    for (var i = 0; i < obs.length; i++) {
      var r = obs[i];
      if (x < r.right + 6 && x + w > r.left - 6 && y < r.bottom + 6 && y + h > r.top - 6) return true;
    }
    return false;
  }
  // Keeps the control bar off fixed bars, phone links and buttons. Moves only when the current spot is taken.
  function placeHud(st, force) {
    var hud = st.hud;
    if (!hud || !hud.isConnected) return;
    var cw = document.documentElement.clientWidth, vh = window.innerHeight;
    var w = hud.offsetWidth, h = hud.offsetHeight, obs = obstacles(st), I = 10;
    if (st.mobile) {
      var order = st.pos === 'left' ? ['bl', 'tl', 'br', 'tr'] : st.pos === 'bottom' ? ['br', 'bl', 'tr', 'tl'] : ['br', 'tr', 'bl', 'tl'];
      var ex = st.collapsed ? 0 : I; // collapsed: a tab flush with the side edge
      var rectOf = function (c) { return [c.charAt(1) === 'l' ? ex : cw - w - ex, c.charAt(0) === 't' ? I : vh - h - I]; };
      var cur = st.corner, pick = null;
      if (!force && cur) { var rc = rectOf(cur); if (!hits(obs, rc[0], rc[1], w, h)) pick = cur; }
      if (!pick) {
        pick = order[0];
        for (var i = 0; i < order.length; i++) { var q = rectOf(order[i]); if (!hits(obs, q[0], q[1], w, h)) { pick = order[i]; break; } }
      }
      if (pick !== cur) { st.corner = pick; hud.setAttribute('data-corner', pick); }
      var pr = rectOf(pick);
      hudXY(st, pr[0], pr[1]);
      return;
    }
    if (st.pos === 'bottom') return; // centred at the bottom by CSS
    var x = st.pos === 'left' ? (st.collapsed ? 0 : I) : cw - w - (st.collapsed ? 0 : I);
    if (!force && st.hudTop != null && !hits(obs, x, st.hudTop, w, h)) { hudXY(st, x, st.hudTop); return; }
    var fr = [0.58, 0.46, 0.7, 0.34, 0.82], top = null;
    for (var j = 0; j < fr.length; j++) {
      var y = clamp(Math.round(vh * fr[j] - h / 2), 8, Math.max(8, vh - h - 8));
      if (!hits(obs, x, y, w, h)) { top = y; break; }
    }
    if (top == null) top = clamp(Math.round(vh * fr[0] - h / 2), 8, Math.max(8, vh - h - 8));
    st.hudTop = top;
    hudXY(st, x, top);
  }
  // the bar is moved with a transform only, so moving it never counts as a layout shift
  function hudXY(st, x, y) {
    if (x === st.hudX && y === st.hudY) return;
    st.hudX = x; st.hudY = y;
    st.hud.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
  }

  function createAgents(st) {
    st.agents = [];
    var vw = window.innerWidth, vh = window.innerHeight, sy = window.scrollY;
    for (var i = 0; i < st.maxAgents; i++) {
      var a = new Agent(st, i);
      a.flock = i % 2;
      a.off = [rand(-46, 46), rand(-34, 34)];
      a.wob = rand(0, 6.28);
      a.x = vw / 2; a.y = sy + vh / 2;
      st.agents.push(a);
    }
    st.activeAgents = Math.min(st.maxAgents, st.mobile ? 6 : 16);
    for (var j = 0; j < st.activeAgents; j++) st.agents[j].show(true);
  }

  function bindEvents(st) {
    function on(t, ev, fn, opt) { t.addEventListener(ev, fn, opt); st.listeners.push([t, ev, fn, opt]); }
    var stopTour = function () {
      if (st.touring && st.phase !== 'done') {
        // the tour hands over to the visitor: the build goes on where they look (see dispatchFollow)
        st.touring = false;
        if (st.phase === 'build') { st.followed = true; growAgents(st, st.maxAgents); }
        updateHud(st, true);
      }
    };
    on(window, 'wheel', stopTour, { passive: true });
    on(window, 'touchmove', stopTour, { passive: true });
    on(window, 'keydown', function (e) {
      if (e.key === 'Escape') { finishNow(st); return; }
      if (/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End| )$/.test(e.key)) stopTour();
    });
    var rt = 0;
    on(window, 'resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (S === st) onResize(st); }, 220); });
    if (window.MutationObserver) {
      st.mo = new MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) if (list[i].type === 'childList') { st.dirtySel = true; st.dirtyAvoid = true; return; }
      });
      st.mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  // ------------------------------------------------------------------- scan
  function scan(st) {
    var o = st.o, vw = window.innerWidth, vh = window.innerHeight;
    var sx = window.scrollX, sy = window.scrollY;
    var docW = Math.max(document.documentElement.scrollWidth, vw);
    var rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    var he = hideEl();
    if (he && he.sheet) he.sheet.disabled = true; // measure natural visibility (same task: never painted)
    st.reveal = document.getElementById(REVEAL_ID);
    if (!st.reveal) {
      st.reveal = document.createElement('style');
      st.reveal.id = REVEAL_ID;
      st.reveal.textContent = '@layer ' + LAYER + '{}';
      document.head.appendChild(st.reveal);
    }
    var secEls = [];
    try {
      var all = document.body.querySelectorAll(o.sectionSelector);
      for (var i = 0; i < all.length; i++) {
        var p = all[i].parentElement, nested = false;
        while (p && p !== document.body) { if (p.matches(o.sectionSelector)) { nested = true; break; } p = p.parentElement; }
        if (!nested) secEls.push(all[i]);
      }
    } catch (e) { secEls = []; }
    var secMap = new Map();
    var secs = secEls.map(function (el) {
      var r = el.getBoundingClientRect();
      return { el: el, y: r.top + sy, h: r.height };
    }).filter(function (s) { return s.h > 0; }).sort(function (a, b) { return a.y - b.y; });
    secs.forEach(function (s, k) { s.i = k; secMap.set(s.el, k); });
    st.sections = secs.map(function (s) { return { y: s.y, h: s.h, total: 0, done: 0, items: 0, itemsDone: 0, tails: [] }; });

    var layers = [], groups = [], instant = [], tails = [];
    var stack = [];   // open master groups (to collect their layers)
    var exSel = o.exclude, inSel = o.instant;

    function sectionOf(el, y) {
      var e = el;
      while (e && e !== document.body) { if (secMap.has(e)) return secMap.get(e); e = e.parentElement; }
      // not inside a section element: attach by position
      var best = -1;
      for (var k = 0; k < st.sections.length; k++) if (st.sections[k].y <= y + 1) best = k;
      if (best < 0) {
        st.sections.push({ y: y, h: 1, total: 0, done: 0, items: 0, itemsDone: 0, tails: [] });
        best = st.sections.length - 1;
      }
      return best;
    }
    function addLayer(el, kind, R, tree, extra) {
      var L = assign({ id: layers.length, el: el, kind: kind, x: R.x, y: R.y, w: R.w, h: R.h, tree: tree, count: 1, state: 'pending' }, extra);
      L.section = sectionOf(el, R.y);
      layers.push(L);
      for (var k = 0; k < stack.length; k++) stack[k].layers.push(L);
      return L;
    }
    function inspect(el, clip) {
      var name = el.localName;
      if (SKIP_TAG[name] || el.id === ROOT_ID) return null;
      var cs = getComputedStyle(el);
      if (cs.display === 'none') return null;
      if (cs.display === 'contents') return { el: el, cs: cs, contents: true };
      if (cs.visibility !== 'visible') return null;           // hidden by the page itself: leave alone
      if (parseFloat(cs.opacity) < 0.05) return null;
      if (cs.position === 'fixed' || cs.position === 'sticky') st.fixedEls.push(el);
      if ((exSel && el.matches(exSel)) || (inSel && el.matches(inSel)) || cs.position === 'fixed') return { el: el, instant: true };
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) {
        if (el.children.length && cs.overflow === 'visible') return { el: el, cs: cs, contents: true };
        return null;
      }
      var R = { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height };
      var inside = R.x >= clip.l - 2 && R.y >= clip.t - 2 && R.x + R.w <= clip.r + 2 && R.y + R.h <= clip.b + 2 && R.x + R.w > 0 && R.x < docW;
      return { el: el, cs: cs, R: R, tail: !inside };
    }
    function ownPaint(cs) {
      if (alphaOf(cs.backgroundColor) > 0.03) return true;
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
      if (cs.boxShadow && cs.boxShadow !== 'none') return true;
      var sides = ['Top', 'Right', 'Bottom', 'Left'];
      for (var k = 0; k < 4; k++) {
        if (parseFloat(cs['border' + sides[k] + 'Width']) > 0 && cs['border' + sides[k] + 'Style'] !== 'none' && alphaOf(cs['border' + sides[k] + 'Color']) > 0.05) return true;
      }
      return false;
    }
    function bgUrl(cs) { return cs.backgroundImage && cs.backgroundImage.indexOf('url(') >= 0; }
    function directText(el) {
      var t = '';
      for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) t += c.data;
      return t.replace(/\s+/g, ' ').trim();
    }
    function bigMedia(el) {
      var m = el.querySelectorAll('img,video,canvas,picture,iframe');
      for (var k = 0; k < m.length; k++) { var r = m[k].getBoundingClientRect(); if (r.width > 72 && r.height > 72) return true; }
      return false;
    }
    function similar(a, b) {
      return Math.abs(a.w - b.w) <= 0.45 * Math.max(a.w, b.w) && Math.abs(a.h - b.h) <= 0.45 * Math.max(a.h, b.h);
    }
    function process(it, clip) {
      var el = it.el, cs = it.cs, R = it.R, name = el.localName;
      if (it.instant) { instant.push(el); return; }
      if (it.contents) { walk(el, clip); return; }
      if (it.tail) { tails.push({ el: el, section: sectionOf(el, R.y) }); return; }
      if (MEDIA[name]) {
        addLayer(el, Math.max(R.w, R.h) < 56 ? 'icon' : 'media', R, true);
        return;
      }
      var txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      var own = ownPaint(cs);
      if (name === 'hr' || (own && !txt && !el.children.length && (R.h <= 4 || R.w <= 4))) {
        addLayer(el, 'line', R, true, { vertical: R.h > R.w });
        return;
      }
      if (CONTROL[name]) { addLayer(el, 'control', R, true); return; }
      var nDesc = el.getElementsByTagName('*').length;
      var holdsInstant = false;
      try { holdsInstant = !!((inSel && el.querySelector(inSel)) || (exSel && el.querySelector(exSel))); } catch (e) { /* ignore */ }
      if (holdsInstant) { if (own) addLayer(el, 'box', R, false, { bg: alphaOf(cs.backgroundColor) > 0.03 }); walk(el, clip); return; }
      if (own && !bgUrl(cs) && txt && txt.length <= 40 && nDesc <= 8 && R.w <= 420 && R.h <= 90 && !bigMedia(el)) {
        addLayer(el, 'button', R, true);
        return;
      }
      var dt = directText(el);
      if (dt && nDesc <= 40 && !bigMedia(el)) {
        var fs = parseFloat(cs.fontSize) || 16, sub = 'text';
        if (fs >= Math.max(34, rootFont * 2.1) && txt.length <= 80) sub = 'heading';
        else if (/^[0-9][0-9\s.,:+%×x\/–-]*$/.test(txt) && txt.length <= 8) sub = 'number';
        addLayer(el, 'text', R, true, { sub: sub, chars: txt.length });
        return;
      }
      if (bgUrl(cs)) addLayer(el, 'media', R, false);
      else if (own) addLayer(el, 'box', R, false, { bg: alphaOf(cs.backgroundColor) > 0.03 || (cs.backgroundImage && cs.backgroundImage !== 'none') });
      var ov = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
      walk(el, ov ? { l: Math.max(clip.l, R.x), t: Math.max(clip.t, R.y), r: Math.min(clip.r, R.x + R.w), b: Math.min(clip.b, R.y + R.h) } : clip);
    }
    function walk(parent, clip) {
      var items = [];
      for (var c = parent.firstElementChild; c; c = c.nextElementSibling) {
        var it = inspect(c, clip);
        if (it) items.push(it);
      }
      // repeated siblings -> clone-and-rewrite groups
      var member = new Map();
      if (parent !== document.body && items.length >= 2) {
        var bySig = {};
        items.forEach(function (it) {
          if (!it.R || it.tail || it.instant || it.contents) return;
          if (it.R.h > vh * 0.9) return;
          if (it.R.w > vw * 0.85 && it.R.h > vh * 0.35) return;          // page bands are never clone groups
          try { if (it.el.matches(o.sectionSelector)) return; } catch (e) { /* ignore */ }
          var sig = it.el.localName + '|' + (it.el.getAttribute('class') || '') + '|' + it.el.childElementCount;
          (bySig[sig] = bySig[sig] || []).push(it);
        });
        Object.keys(bySig).forEach(function (k) {
          var list = bySig[k];
          if (list.length < 2) return;
          var m0 = list[0];
          var ok = list.filter(function (it) { return similar(it.R, m0.R); });
          var rich = m0.el.getElementsByTagName('*').length >= 3 && m0.R.w * m0.R.h > vw * vh * 0.02;
          if (ok.length < o.groupMin && !(ok.length >= 2 && rich)) return;
          var g = { master: ok[0], members: ok.slice(1), layers: [], subgroups: [], section: 0 };
          ok.forEach(function (it, idx) { member.set(it.el, idx === 0 ? { g: g, master: true } : { g: g }); });
          groups.push(g);
          for (var s = 0; s < stack.length; s++) stack[s].subgroups.push(g);
        });
      }
      items.forEach(function (it) {
        var m = member.get(it.el);
        if (m && !m.master) return; // built by cloning the master
        if (m && m.master) {
          stack.push(m.g);
          process(it, clip);
          stack.pop();
          m.g.section = sectionOf(it.el, it.R.y);
          return;
        }
        process(it, clip);
      });
    }
    walk(document.body, { l: -1e9, t: -1e9, r: 1e9, b: 1e9 });
    if (he && he.sheet) he.sheet.disabled = false;

    st.layers = layers; st.groups = groups; st.instant = instant;
    tails.forEach(function (t) { st.sections[t.section].tails.push(t.el); });
    instant.forEach(function (el) { revealEl(st, el, true); });
  }

  // ------------------------------------------------------------------- plan
  function plan(st) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var layers = st.layers;
    // group layer counts (nested groups count their clones too)
    function gCount(g) {
      if (g.count != null) return g.count;
      var c = g.layers.length;
      g.subgroups.forEach(function (s) { c += s.members.length * gCount(s); });
      return (g.count = Math.max(1, c));
    }
    st.groups.forEach(gCount);
    st.groups.forEach(function (g) {
      g.layers.forEach(function (L) { L.grp = g; });
      g.subgroups.forEach(function (sg) { sg.parent = g; });
    });
    var total = layers.length;
    st.groups.forEach(function (g) { total += g.members.length * g.count; });
    st.totalLayers = total;

    // reading order inside each section
    layers.forEach(function (L) { L.key = L.section * 1e9 + Math.round(L.y / 24) * 1e5 + L.x; });
    var sorted = layers.slice().sort(function (a, b) { return a.key - b.key; });
    var q = [];
    // blocking pass: big frames of every section first
    var perSec = {};
    sorted.forEach(function (L) {
      var big = (L.kind === 'media' || (L.kind === 'box' && L.bg)) && L.w * L.h >= vw * vh * 0.03;
      if (big && (perSec[L.section] = (perSec[L.section] || 0) + 1) <= 8) L.needsBlock = true;
    });
    // opening "blocking": like the video, the first viewport gets its frames (incl. empty text frames) up front
    var y0 = window.scrollY, nb = 0;
    sorted.forEach(function (L) {
      if (L.needsBlock || nb >= 16) return;
      if (L.y < y0 + vh * 0.9 && L.y + L.h > y0 && L.w * L.h >= vw * vh * 0.0015 && L.kind !== 'line') { L.needsBlock = true; nb++; }
    });
    var secIdx = -1;
    sorted.forEach(function (L) {
      if (L.section !== secIdx) {
        secIdx = L.section;
        sorted.forEach(function (B) {
          if (B.section === secIdx && B.needsBlock) q.push(B.blockItem = { type: 'block', L: B, section: secIdx, y: B.y, h: B.h, state: 'pending' });
        });
      }
      L.item = { type: 'build', L: L, section: L.section, y: L.y, h: L.h, state: 'pending' };
      q.push(L.item);
    });
    // clone tasks right after the last layer of their master
    st.groups.forEach(function (g) {
      var idx = -1;
      g.layers.forEach(function (L) { var k = q.indexOf(L.item); if (k > idx) idx = k; });
      var M = g.master.R;
      var item = { type: 'clone', g: g, section: g.section, y: M.y, h: M.h, state: 'pending' };
      g.item = item;
      if (idx < 0) q.push(item); else q.splice(idx + 1, 0, item);
    });
    // nested groups: outer clone waits for inner clones (deps)
    st.queue = q;
    q.forEach(function (it) {
      var s = st.sections[it.section];
      if (!s) return;
      s.items++;
      s.total += it.type === 'clone' ? it.g.members.length * it.g.count : it.type === 'build' ? 1 : 0;
    });
    // agents: ~layers/8, 60% at the start, growing per section
    var maxA = st.o.agents || clamp(Math.round(total / 8), 10, 30);
    if (st.mobile) maxA = Math.min(maxA, 8);
    maxA = Math.min(maxA, st.agents.length);
    st.maxAgents = maxA;
    st.startAgents = Math.max(Math.min(6, maxA), Math.round(maxA * 0.6));
    var units = q.filter(function (i) { return i.type !== 'block'; }).length;
    st.rate = units * LAYERS_PER_SEC / Math.max(1, total); // tasks per second at 1x
    st.nSections = Math.max(1, st.sections.length);
  }

  // ----------------------------------------------------------- reveal rules
  function revealEl(st, el, tree) {
    st.reveals.push({ el: el, tree: tree });
    insertReveal(st, el, tree);
  }
  function insertReveal(st, el, tree) {
    var block = st.reveal && st.reveal.sheet && st.reveal.sheet.cssRules[0];
    if (!block || !el.isConnected) return;
    var s = pathOf(el);
    try {
      block.insertRule(s + '{visibility:visible!important}', block.cssRules.length);
      if (tree) block.insertRule(s + ' *{visibility:revert-layer!important}', block.cssRules.length);
    } catch (e) { /* ignore */ }
  }
  function rebuildReveals(st) {
    var block = st.reveal && st.reveal.sheet && st.reveal.sheet.cssRules[0];
    if (!block) return;
    while (block.cssRules.length) block.deleteRule(0);
    st.reveals = st.reveals.filter(function (r) { return r.el.isConnected; });
    st.reveals.forEach(function (r) { insertReveal(st, r.el, r.tree); });
  }

  // ------------------------------------------------------------------- tick
  function tick(st) {
    var t = now(), dt = Math.min(0.05, t - st.last);
    st.last = t;
    if (st.phase === 'build') st.frames.push(dt);
    if (st.dirtySel) { st.dirtySel = false; rebuildReveals(st); }
    var vw = window.innerWidth, vh = window.innerHeight;
    if (t > (st.placeAt || 0)) { st.placeAt = t + 0.5; placeHud(st, false); } // read layout before this frame's writes

    if (st.phase === 'scan') {
      var ts = t - st.t0;
      flock(st, ts, vw, vh);
      if (st.o.mode !== 'scroll' && ts > st.scanDur * 0.7 && !st.touringShown) { st.touringShown = true; updateHud(st, true); }
      if (ts >= st.scanDur && st.scanned) enterBuild(st, t);
    } else if (st.phase === 'build') {
      buildStep(st, t, dt, vw, vh);
    } else if (st.phase === 'done') {
      finaleStep(st, t, dt, vw, vh);
    }
    renderAgents(st, t, dt);
    var sy = window.scrollY, sx = window.scrollX;
    st.world.style.transform = 'translate3d(' + (-sx) + 'px,' + (-sy) + 'px,0)';
    renderGuides(st, t, sy, sx, vw, vh);
    updateHud(st, false);
  }

  function flock(st, ts, vw, vh) {
    var sy = window.scrollY, cx = vw / 2, cy = vh / 2;
    var R = Math.min(110, vw * 0.12), w = 2.4;
    for (var i = 0; i < st.agents.length; i++) {
      var a = st.agents[i];
      if (!a.active) continue;
      var ph = a.flock ? Math.PI : 0;
      var ang = w * ts + ph - Math.PI / 2;
      var fx = cx + Math.cos(ang) * R * 1.25, fy = cy + Math.sin(ang) * R * 0.8;
      var wob = Math.sin(ts * 5 + a.wob) * 6;
      a.x = fx + a.off[0] + wob;
      a.y = sy + fy + a.off[1] + Math.cos(ts * 4 + a.wob) * 5;
      a.setMode('arrow');
    }
  }

  function enterBuild(st, t) {
    var vw = window.innerWidth, vh = window.innerHeight, sy = window.scrollY;
    st.phase = 'build';
    st.buildStart = t;
    st.mono.classList.add('sr-out');
    st.hud.setAttribute('data-state', 'build');
    placeHud(st, false);
    // hide surplus agents (after the scan we know how many we need)
    var startN = Math.min(st.startAgents, st.agents.length);
    st.agents.forEach(function (a, i) { if (i >= startN && a.active) a.show(false); if (i < startN && !a.active) { a.show(true); a.x = vw / 2; a.y = sy + vh / 2; } });
    st.activeAgents = startN;
    // scatter to the left / right edges
    var os = st.openScale;
    st.agents.forEach(function (a) {
      if (!a.active) return;
      var left = a.x < vw / 2;
      a.scatter = { fx: a.x, fy: a.y, tx: left ? rand(24, 150) : rand(vw - 150, vw - 24), ty: sy + rand(vh * 0.08, vh * 0.88), t0: t, d: 0.2 / os };
    });
    st.dispatchAt = t + 0.2 / os;
    if (st.useRulers) st.rulersUntil = t + 1.45 / os;
    st.sectionOpen = [];
    st.tokens = Math.min(st.startAgents, 6);
  }

  function sectionOpen(st, s, t) {
    if (st.sectionOpen[s]) return true;
    var prev = st.sections[s - 1];
    var ok = s === 0 || !prev || sectionOpen(st, s - 1, t) && (prev.items === prev.itemsDone || prev.itemsDone / Math.max(1, prev.items) >= 0.45 || prev.h < window.innerHeight * 0.35);
    if (!ok) return false;
    st.sectionOpen[s] = true;
    if (s > 0 && st.useRulers && t - st.buildStart > 1.5) st.rulersUntil = Math.max(st.rulersUntil, t + 1.2 / st.openScale);
    var target = st.startAgents + Math.round((st.maxAgents - st.startAgents) * (st.nSections > 1 ? s / (st.nSections - 1) : 1));
    growAgents(st, target);
    return true;
  }
  function growAgents(st, n) {
    var vw = window.innerWidth, vh = window.innerHeight, sy = window.scrollY;
    n = Math.min(n, st.agents.length);
    while (st.activeAgents < n) {
      var a = st.agents[st.activeAgents++];
      a.show(true);
      a.x = vw + 30; a.y = sy + rand(vh * 0.2, vh * 0.8);
      a.next = 0;
    }
  }

  function inWindow(st, it) {
    var sy = window.scrollY, vh = window.innerHeight;
    if (sy >= maxScroll() - 2) return true; // nothing left to scroll: everything is reachable
    if (st.touring) return it.y < sy + vh * 0.9;
    return it.y < sy + vh * 2;
  }
  function depsOk(it) {
    if (it.type === 'build' && it.L.needsBlock && !it.L.blocked) return false;
    if (it.type === 'clone') {
      var g = it.g;
      for (var i = 0; i < g.layers.length; i++) if (g.layers[i].state !== 'done') return false;
      for (var j = 0; j < g.subgroups.length; j++) if (g.subgroups[j].item.state !== 'done') return false;
    }
    return true;
  }

  function buildStep(st, t, dt, vw, vh) {
    var sp = st.speedBase * st.mult;
    // scatter animation at the start
    st.agents.forEach(function (a) {
      if (!a.scatter) return;
      var p = clamp((t - a.scatter.t0) / a.scatter.d, 0, 1), e = easeOut(p);
      if (!a.task) { a.x = lerp(a.scatter.fx, a.scatter.tx, e); a.y = lerp(a.scatter.fy, a.scatter.ty, e); a.setMode(p > 0.6 ? 'cross' : 'arrow'); }
      if (p >= 1) { a.scatter = null; a.next = t + rand(0.2, 1.2); }
    });
    if (t >= st.dispatchAt) {
      // video pacing: ~9.5 layers/s in the first part, ~7 on average
      var early = st.doneLayers < st.totalLayers * 0.3 ? 1.4 : 1;
      var rate = st.rate * early * sp;
      // the visitor scrolled onto empty layers: start them right away (about 12 + 3 per empty layer per second)
      if (!st.touring && st.visManual > 0) rate = Math.max(rate, 12 + st.visManual * 3);
      st.tokens = Math.min(st.touring ? 2.5 : 3, st.tokens + rate * dt);
      if (st.touring) dispatch(st, t); else dispatchFollow(st, t);
    }
    var sy = window.scrollY;
    for (var i = st.active.length - 1; i >= 0; i--) {
      var tk = st.active[i];
      if (!st.touring && !tk.warp) {
        // visitor scrolled away from this task: finish it quickly out of sight, the agent is needed in view
        var bx = itemBox(tk.it);
        if (bx.y + bx.h < sy - vh * 0.15 || bx.y > sy + vh * (1.25 + AHEAD)) tk.warp = 14;
      }
      runTask(st, tk, t);
      if (tk.finished) st.active.splice(i, 1);
    }
    trackSeen(st, t);
    if (!st.touring) followLeftovers(st);
    // section tails (elements clipped by overflow): revealed when the section is complete
    st.sections.forEach(function (s) {
      if (!s.tailsDone && s.items === s.itemsDone && (s.items > 0 || st.queue.length === 0)) {
        s.tailsDone = true;
        s.tails.forEach(function (el) { revealEl(st, el, true); });
      }
    });
    camera(st, t, dt, vw, vh);
    if (st.qHead >= st.queue.length && st.active.length === 0) enterDone(st, t);
  }

  function dispatch(st, t) {
    var idle = [];
    for (var i = 0; i < st.agents.length; i++) { var a = st.agents[i]; if (a.active && !a.task && !a.scatter) idle.push(a); }
    while (st.qHead < st.queue.length && st.queue[st.qHead].state === 'done') st.qHead++;
    var looked = 0;
    for (var k = st.qHead; k < st.queue.length && idle.length && looked < 14; k++) {
      var it = st.queue[k];
      if (it.state !== 'pending') continue;
      looked++;
      if (!sectionOpen(st, it.section, t)) break;
      if (!inWindow(st, it) || !depsOk(it)) continue;
      if (it.type !== 'block') { if (st.tokens < 1) break; st.tokens -= 1; }
      var best = 0, bd = 1e12;
      for (var j = 0; j < idle.length; j++) {
        var d = Math.pow(idle[j].x - (it.L ? it.L.x : it.g.master.R.x), 2) + Math.pow(idle[j].y - it.y, 2);
        if (d < bd) { bd = d; best = j; }
      }
      var ag = idle.splice(best, 1)[0];
      startTask(st, it, ag, t, idle);
    }
  }

  // ------------------------------------------- visitor-driven (scroll mode)
  // Only layers in view and at most AHEAD viewport below it are built, never farther. Visible, unfinished layers
  // come first; layers below only once everything visible is under way. Scrolling onto unbuilt layers raises the
  // pace (more task starts, faster tasks), so nothing in view stays empty for long.
  function itemBox(it) {
    if (it.type !== 'clone') return { y: it.y, h: it.h };
    var g = it.g, y0 = g.master.R.y, y1 = y0 + g.master.R.h;
    for (var i = 0; i < g.members.length; i++) {
      var R = g.members[i].R;
      if (R) { if (R.y < y0) y0 = R.y; if (R.y + R.h > y1) y1 = R.y + R.h; }
    }
    return { y: y0, h: y1 - y0 };
  }
  function dispatchFollow(st, t) {
    var sy = window.scrollY, vh = window.innerHeight, lim = sy + vh * (1 + AHEAD);
    var idle = [];
    for (var i = 0; i < st.agents.length; i++) { var a = st.agents[i]; if (a.active && !a.task && !a.scatter) idle.push(a); }
    while (st.qHead < st.queue.length && st.queue[st.qHead].state === 'done') st.qHead++;
    var stamp = (st.stamp = (st.stamp || 0) + 1), cands = [], visPend = 0, visMan = 0;
    function want(it, v, k) {
      if (it.state !== 'pending' || it._c === stamp) return;
      it._c = stamp;
      if (depsOk(it)) { cands.push({ it: it, v: v, k: k }); return; }
      // pull in what it waits for, even outside the window (e.g. the master card scrolled above)
      if (it.type === 'build' && it.L.blockItem) want(it.L.blockItem, v, k - 0.5);
      if (it.type === 'clone') {
        it.g.layers.forEach(function (L) { if (L.item) want(L.item, v, k - 0.5); });
        it.g.subgroups.forEach(function (sg) { if (sg.item) want(sg.item, v, k - 0.5); });
      }
    }
    for (var k = st.qHead; k < st.queue.length; k++) {
      var it = st.queue[k];
      if (it.state !== 'pending') continue;
      var b = itemBox(it);
      if (b.y >= lim || b.y + b.h <= sy) continue;
      var v = b.y < sy + vh;
      if (v && it.type !== 'block') { visPend++; if (it.seen && it.seen.cat === 'manual') visMan++; }
      want(it, v, k);
    }
    st.visPending = visPend;
    st.visManual = visMan;
    // more empty layers in view than free agents: a few extra agents join (up to 8 above the planned count)
    if (visMan > idle.length && st.activeAgents < Math.min(st.agents.length, st.maxAgents + 8)) {
      var before = st.activeAgents;
      growAgents(st, Math.min(st.agents.length, st.maxAgents + 8, st.activeAgents + visMan - idle.length));
      for (var e = before; e < st.activeAgents; e++) idle.push(st.agents[e]);
    }
    if (!idle.length || !cands.length) return;
    cands.sort(function (p, q) { return (q.v - p.v) || (p.k - q.k); });
    var boost = clamp(visMan / 6, 1, 3); // and build them faster
    for (var c = 0; c < cands.length && idle.length; c++) {
      var cd = cands[c], it2 = cd.it;
      if (!cd.v && visPend > 0) break;
      if (it2.type !== 'block') { if (st.tokens < 1) break; st.tokens -= 1; }
      openSection(st, it2.section);
      var tx = it2.L ? it2.L.x : it2.g.master.R.x, best = 0, bd = 1e15;
      for (var j = 0; j < idle.length; j++) {
        var d = Math.pow(idle[j].x - tx, 2) + Math.pow(idle[j].y - it2.y, 2);
        if (d < bd) { bd = d; best = j; }
      }
      var ag = idle.splice(best, 1)[0];
      // an agent far off screen enters from the nearest edge (shortest way in)
      if (ag.y < sy - 80 || ag.y > sy + vh + 80) { ag.y = ag.y < sy ? sy - 30 : sy + vh + 30; ag.hist.length = 0; }
      var ahead = (itemBox(it2).y - (sy + vh)) / vh;
      if (ahead > st.maxAhead) st.maxAhead = ahead;
      startTask(st, it2, ag, t, idle, cd.v ? boost : 1);
    }
  }
  function openSection(st, s) {
    if (st.sectionOpen[s]) return;
    st.sectionOpen[s] = true;
    growAgents(st, st.startAgents + Math.round((st.maxAgents - st.startAgents) * (st.nSections > 1 ? s / (st.nSections - 1) : 1)));
  }
  // finish an item without animation (only for items out of sight)
  function skipItem(st, it) {
    if (it.state === 'done') return;
    if (it.type === 'block') { it.L.needsBlock = false; }
    else if (it.type === 'build') {
      var L = it.L;
      if (L.ph) { L.ph.remove(); L.ph = null; }
      if (L.sel) { L.sel.out(); L.sel = null; }
      L.blocked = false;
      revealEl(st, L.el, L.tree);
      L.state = 'done';
      countDone(st, 1, it.section);
    } else {
      it.g.members.forEach(function (m) { revealEl(st, m.el, true); });
      countDone(st, it.g.members.length * it.g.count, it.section);
    }
    markItemDone(st, it);
  }
  // visitor reached the bottom: what is left is above the viewport (scrolled past) -> finish it out of sight
  function followLeftovers(st) {
    var sy = window.scrollY;
    if (sy < maxScroll() - 2) return;
    var left = [];
    for (var k = st.qHead; k < st.queue.length; k++) {
      var it = st.queue[k];
      if (it.state !== 'pending') continue;
      var b = itemBox(it);
      if (b.y + b.h > sy) return; // still something in view to build
      left.push(it);
    }
    left.forEach(function (it) { skipItem(st, it); });
  }
  // "Tour" pressed again after the visitor scrolled: continue from here, finish what lies above out of sight
  function resumeTour(st) {
    var sy = window.scrollY;
    st.queue.forEach(function (it) { if (it.state === 'pending') { var b = itemBox(it); if (b.y + b.h < sy) skipItem(st, it); } });
    st.active.forEach(function (tk) { var b = itemBox(tk.it); if (b.y + b.h < sy) tk.warp = 14; });
  }
  // a clone group is under way as soon as its first item (or an inner group) is
  function groupStarted(g) {
    for (var i = 0; i < g.layers.length; i++) { var L = g.layers[i]; if (L.blocked || (L.item && L.item.state !== 'pending')) return true; }
    for (var j = 0; j < g.subgroups.length; j++) { var sg = g.subgroups[j]; if (sg.item.state !== 'pending' || groupStarted(sg)) return true; }
    return false;
  }
  // measurement: in which state was each layer when it first came into view?
  function trackSeen(st, t) {
    var sy = window.scrollY, vh = window.innerHeight, q = st.queue;
    var cat = !st.seenInit ? 'initial' : st.touring ? 'tour' : 'manual';
    for (var k = 0; k < q.length; k++) {
      var it = q[k];
      if (it.type === 'block' || it.seen) continue;
      var b = itemBox(it);
      var vis = Math.min(b.y + b.h, sy + vh) - Math.max(b.y, sy);
      if (vis < Math.min(24, b.h * 0.5)) continue;
      var w = it.type === 'clone' ? it.g.members.length * it.g.count : 1;
      var state = it.state === 'pending' && it.type === 'clone' && groupStarted(it.g) ? 'active' : it.state;
      it.seen = { t: t, state: state, cat: cat };
      st.seenStats[cat][state === 'pending' ? 'pending' : state === 'done' ? 'done' : 'active'] += w;
    }
    st.seenInit = true;
  }

  function markItemDone(st, it) {
    if (it.state === 'done') return;
    it.state = 'done';
    var s = st.sections[it.section];
    if (s) s.itemsDone++;
  }
  function countDone(st, n, section) {
    st.doneLayers = Math.min(st.totalLayers, st.doneLayers + n);
    var s = st.sections[section];
    if (s) s.done += n;
  }
  function release(st, a) {
    if (!a || !a.task) return;
    a.task = null;
    a.setMode('arrow');
    a.next = 0;
  }

  // ------------------------------------------------------------------ tasks
  function runTask(st, tk, t0) {
    // task-local clock: runs faster (warp) when the visitor scrolled away from the task
    tk.clock = tk.clock == null ? t0 : tk.clock + (t0 - tk.lastT) * (tk.warp || 1);
    tk.lastT = t0;
    var t = tk.clock, guard = 0;
    while (guard++ < 12) {
      var ph = tk.phases[tk.pi];
      if (!ph) { tk.finished = true; return; }
      if (!tk.pStarted) { tk.pStarted = true; tk.pt0 = tk.pt0 || t; if (ph.start) ph.start(tk, t); }
      var p = ph.d > 0 ? (t - tk.pt0) / ph.d : 1;
      if (p < 1) { if (ph.tick) ph.tick(tk, Math.max(0, p), t); return; }
      if (ph.tick) ph.tick(tk, 1, t);
      if (ph.end) ph.end(tk, t);
      tk.pi++; tk.pStarted = false; tk.pt0 = tk.pt0 + Math.max(0, ph.d);
      if (tk.pt0 < t - 0.25) tk.pt0 = t; // never fast-forward through more than a short hitch
    }
  }
  function startTask(st, it, a, t, idle, boost) {
    // measurement: time from "came into view empty" to "work started" (a clone group starts with its first item)
    var chain = [it], g0 = it.type === 'clone' ? it.g.parent : it.L && it.L.grp;
    while (g0) { chain.push(g0.item); g0 = g0.parent; }
    chain.forEach(function (x) {
      if (x && x.seen && x.seen.cat === 'manual' && x.seen.state === 'pending' && !x.waited) { x.waited = true; st.waits.push(t - x.seen.t); }
    });
    it.state = 'active';
    var sp = st.speedBase * st.mult * (boost || 1);
    var tk = { it: it, agent: a, pi: 0, pStarted: false, pt0: 0, sp: sp, mv: Math.pow(sp, 0.7), guide: null, helpers: [] };
    a.task = tk;
    a.scatter = null;
    if (it.type === 'block') tk.phases = blockPhases(st, tk, it.L);
    else if (it.type === 'clone') { tk.phases = clonePhases(st, tk, it.g, idle); }
    else tk.phases = buildPhases(st, tk, it.L);
    st.active.push(tk);
    if (it.L) it.L.state = 'active';
  }
  function travel(st, tk, x, y, mode) {
    return {
      d: 0,
      start: function (tk2) {
        var a = tk.agent;
        tk.fx = a.x; tk.fy = a.y;
        var dist = Math.hypot(x - a.x, y - a.y);
        this.d = clamp(0.1 + dist / 1900, 0.14, 0.62) / tk.mv;
        a.setMode(mode || 'arrow');
      },
      tick: function (tk2, p) {
        var e = easeInOut(p), a = tk.agent;
        a.x = lerp(tk.fx, x, e); a.y = lerp(tk.fy, y, e);
      }
    };
  }
  function drag(st, tk, L, withPh, scale) {
    var s = scale || 1;
    return {
      d: (L.w * L.h > 160000 ? 0.36 : L.kind === 'icon' ? 0.16 : 0.28) / tk.mv,
      start: function () {
        tk.sel = new Sel(st);
        tk.guide = L;
        tk.agent.setMode('cross');
        if (withPh) tk.ph = new Ph(st, L.kind === 'media' || L.kind === 'icon');
        if (this.outline && tk.ph) tk.ph.el.classList.add('sr-ph-line');
      },
      tick: function (tk2, p) {
        var e = easeOut(p), w = Math.max(2, L.w * s * e), h = Math.max(2, L.h * s * e);
        var bigFrame = L.w * L.h > window.innerWidth * window.innerHeight * 0.08;
        tk.sel.set(L.x, L.y, w, h, bigFrame && p < 1);
        if (tk.ph) tk.ph.set(L.x, L.y, w, h);
        tk.agent.x = L.x + w; tk.agent.y = L.y + h;
      }
    };
  }
  function settleText(st, tk, L) {
    return {
      d: 0,
      start: function () {
        revealEl(st, L.el, true);
        if (tk.proxy) { tk.proxy.typer.end(); tk.proxy.el.remove(); }
        if (tk.ph) tk.ph.remove();
        if (tk.sel) tk.sel.out();
        tk.guide = null;
        L.state = 'done';
        countDone(st, 1, L.section);
        markItemDone(st, tk.it);
        release(st, tk.agent);
      }
    };
  }
  function typePhase(st, tk, L, scale, fromPh) {
    var chars = 0;
    return {
      d: 0,
      start: function () {
        tk.proxy = makeProxy(st, L.el, L, true);
        if (scale !== 1) tk.proxy.el.style.transform = 'scale(' + scale + ')';
        if (fromPh && tk.ph) { tk.ph.remove(); tk.ph = null; }
        chars = tk.proxy.typer.total;
        var cps = clamp(chars * 0.9, 60, chars > 160 ? 420 : 140);
        this.d = clamp(chars / cps, 0.1, 1.3) / tk.sp;
        tk.agent.setMode('ibeam');
        tk.guide = null;
      },
      tick: function (tk2, p) {
        tk.proxy.typer.set(chars * p);
        var a = tk.agent;
        a.x = L.x + L.w * scale + 6; a.y = L.y + Math.min(L.h * scale, 60) / 2;
      }
    };
  }
  function buildPhases(st, tk, L) {
    var ph = [];
    var k = L.kind;
    if (L.blocked) {
      // frame already drawn during blocking: select it, then fill
      ph.push(travel(st, tk, L.x, L.y));
      ph.push({
        d: 0.1 / tk.mv,
        start: function () {
          tk.sel = L.sel || new Sel(st); L.sel = null;
          tk.sel.set(L.x, L.y, L.w, L.h); tk.guide = L; tk.ph = L.ph; L.ph = null;
          tk.agent.setMode('arrow');
        }
      });
    } else if (k === 'line') {
      ph.push(travel(st, tk, L.x, L.y + L.h / 2));
    } else {
      ph.push(travel(st, tk, L.x, L.y));
    }

    if (k === 'text') {
      var heading = L.sub === 'heading';
      var s = heading ? 0.42 : 1;
      if (L.blocked && heading) ph.push({ d: 0.12 / tk.mv, tick: function (tk2, p) { var sc = lerp(1, s, easeInOut(p)); tk.sel.set(L.x, L.y, L.w * sc, L.h * sc); } });
      else if (!L.blocked) ph.push(drag(st, tk, L, false, s));
      ph.push(typePhase(st, tk, L, s, false));
      if (heading) {
        ph.push({
          d: 0.28 / tk.mv,
          start: function () { tk.agent.setMode('cross'); tk.guide = L; },
          tick: function (tk2, p) {
            var e = easeInOut(p), sc = lerp(s, 1, e);
            tk.proxy.el.style.transform = 'scale(' + sc + ')';
            tk.sel.set(L.x, L.y, L.w * sc, L.h * sc, p < 1);
            tk.agent.x = L.x + L.w * sc; tk.agent.y = L.y + L.h * sc;
          }
        });
      }
      ph.push(settleText(st, tk, L));
    } else if (k === 'media' || k === 'icon') {
      if (!L.blocked) ph.push(drag(st, tk, L, true));
      ph.push({
        d: (k === 'icon' ? 0.14 : 0.34) / tk.mv,
        start: function () {
          revealEl(st, L.el, L.tree);
          tk.ph.el.classList.add('sr-fill');
          tk.agent.setMode('arrow');
          tk.agent.x = L.x + L.w * 0.6; tk.agent.y = L.y + L.h * 0.55;
        },
        tick: function (tk2, p) {
          var pe = tk.ph.el.style;
          if (p < 0.35) { pe.opacity = String(1 - (p / 0.35) * 0.3); pe.clipPath = 'none'; }
          else { pe.opacity = '0.7'; pe.clipPath = 'inset(' + (easeInOut((p - 0.35) / 0.65) * 100).toFixed(2) + '% 0 0 0)'; }
        }
      });
      ph.push(settleText(st, tk, L));
    } else if (k === 'box' || k === 'control') {
      if (!L.blocked) ph.push(drag(st, tk, L, true));
      if (k === 'box' && !L.bg) ph[ph.length - 1].outline = true;
      ph.push({
        d: 0.12 / tk.mv,
        start: function () { revealEl(st, L.el, L.tree); tk.ph.el.classList.add('sr-fade'); },
        tick: function (tk2, p) { tk.ph.el.style.opacity = String(1 - p); }
      });
      ph.push(settleText(st, tk, L));
    } else if (k === 'button') {
      if (!L.blocked) ph.push(drag(st, tk, L, true));
      ph.push({ d: 0.05 / tk.mv });              // placeholder -> final colour

      ph.push(typePhase(st, tk, L, 1, true));
      ph.push(settleText(st, tk, L));
    } else if (k === 'line') {
      ph.push({
        d: 0.36 / tk.mv,
        start: function () {
          tk.line = mk('div', 'sr-bline' + (L.vertical ? ' sr-v' : ''), st.world);
          tk.line.style.transform = 'translate3d(' + L.x + 'px,' + L.y + 'px,0)';
          tk.dot = mk('i', 'sr-bdot', st.world);
          tk.agent.setMode('arrow');
        },
        tick: function (tk2, p) {
          var e = easeInOut(p);
          if (L.vertical) { tk.line.style.height = (L.h * e) + 'px'; tk.agent.x = L.x; tk.agent.y = L.y + L.h * e; }
          else { tk.line.style.width = (L.w * e) + 'px'; tk.agent.x = L.x + L.w * e; tk.agent.y = L.y; }
          tk.dot.style.transform = 'translate3d(' + tk.agent.x + 'px,' + tk.agent.y + 'px,0)';
        },
        end: function () {
          var ln = tk.line, dot = tk.dot;
          ln.classList.add('sr-out'); dot.classList.add('sr-out');
          setTimeout(function () { ln.remove(); dot.remove(); }, 520);
        }
      });
      ph.push(settleText(st, tk, L));
    }
    return ph;
  }
  function blockPhases(st, tk, L) {
    var dr = drag(st, tk, L, L.kind !== 'text');
    if (L.kind === 'box' && !L.bg) dr.outline = true;
    return [
      travel(st, tk, L.x, L.y, 'cross'),
      dr,
      {
        d: 0,
        start: function () {
          L.ph = tk.ph; tk.ph = null; L.blocked = true;
          L.sel = tk.sel; tk.sel = null; tk.guide = null;
          markItemDone(st, tk.it);
          release(st, tk.agent);
        }
      }
    ];
  }
  function clonePhases(st, tk, g, idle) {
    var M = g.master.R, members = g.members, n = members.length;
    var copies = [], sels = [], lines = [];
    var slideD = (0.42 + 0.05 * (n - 1)) / tk.mv;
    // helpers ride along with the copies
    while (tk.helpers.length < Math.min(3, n) && idle && idle.length) {
      var hlp = idle.shift(); hlp.task = tk; tk.helpers.push(hlp);
    }
    var rw = members.map(function (m, i) {
      var len = (m.el.textContent || '').replace(/\s+/g, ' ').trim().length;
      return { s: i * 0.13, d: clamp(len / 240, 0.18, 0.55) };
    });
    var rwTotal = 0;
    rw.forEach(function (r) { rwTotal = Math.max(rwTotal, r.s + r.d + 0.05); });
    return [
      travel(st, tk, M.x, M.y),
      {
        d: 0.16 / tk.mv,
        start: function () {
          tk.sel = new Sel(st, true);
          tk.sel.set(M.x, M.y, M.w, M.h);
          tk.agent.setMode('arrow');
          members.forEach(function (m) {
            var c = makeProxy(st, g.master.el, M, false);
            c.el.classList.add('sr-clone');
            copies.push(c);
            var ln = mk('div', 'sr-rline', st.world);
            var dx = m.R.x - M.x, dy = m.R.y - M.y, len = Math.hypot(dx, dy);
            var ys = M.y + M.h + 8;
            ln.style.transform = 'translate3d(' + (M.x + M.w / 2) + 'px,' + ys + 'px,0) rotate(' + Math.atan2(dy, dx) + 'rad)';
            ln.style.width = len + 'px';
            var lab = mk('span', 'sr-rlabel', st.world);
            lab.textContent = Math.round(len);
            lab.style.transform = 'translate3d(' + (m.R.x + m.R.w / 2) + 'px,' + (m.R.y + m.R.h + 8) + 'px,0) translate(-50%,-50%)';
            lines.push(ln, lab);
          });
        }
      },
      {
        d: slideD,
        start: function () { tk.sel.out(); tk.sel = null; },
        tick: function (tk2, p) {
          var T = p * slideD * tk.mv;
          members.forEach(function (m, i) {
            var q = clamp((T - i * 0.05) / 0.42, 0, 1), e = easeInOut(q);
            var x = lerp(M.x, m.R.x, e), y = lerp(M.y, m.R.y, e);
            var sx = lerp(1, m.R.w / M.w, e), sy = lerp(1, m.R.h / M.h, e);
            var cs = copies[i].el.style;
            cs.transform = 'translate(' + (x - M.x) + 'px,' + (y - M.y) + 'px) scale(' + sx + ',' + sy + ')';
            var blur = Math.sin(q * Math.PI) * 2.2;
            cs.filter = blur > 0.2 ? 'blur(' + blur.toFixed(1) + 'px)' : '';
            // afterimages: outline ghosts trailing behind
            var gh = copies[i].gh || (copies[i].gh = [mk('div', 'sr-cghost', st.world), mk('div', 'sr-cghost', st.world)]);
            for (var k = 0; k < 2; k++) {
              var qq = clamp((T - i * 0.05 - (k + 1) * 0.05) / 0.42, 0, 1), ee = easeInOut(qq);
              var gs = gh[k].style;
              gs.transform = 'translate3d(' + lerp(M.x, m.R.x, ee) + 'px,' + lerp(M.y, m.R.y, ee) + 'px,0)';
              gs.width = M.w + 'px'; gs.height = M.h + 'px';
              gs.opacity = q > 0 && q < 1 ? String(0.45 - k * 0.2) : '0';
            }
            var carrier = i === n - 1 ? tk.agent : tk.helpers[i];
            if (carrier) { carrier.x = x; carrier.y = y; carrier.setMode('arrow'); }
          });
        },
        end: function () {
          copies.forEach(function (c) { if (c.gh) c.gh.forEach(function (e) { e.remove(); }); c.el.style.filter = ''; });
          lines.forEach(function (l) { l.classList.add('sr-out'); setTimeout(function () { l.remove(); }, 300); });
        }
      },
      {
        d: 0.14 / tk.mv,
        start: function () {
          members.forEach(function (m) { var s = new Sel(st); s.set(m.R.x, m.R.y, m.R.w, m.R.h); sels.push(s); });
          tk.helpers.forEach(function (h) { release(st, h); });
          tk.helpers = [];
        }
      },
      {
        d: rwTotal / tk.mv,
        start: function () { tk.mp = []; tk.agent.setMode('ibeam'); },
        tick: function (tk2, p) {
          var T = p * rwTotal;
          members.forEach(function (m, i) {
            var r = rw[i], q = (T - r.s) / r.d;
            if (q <= 0 || tk.mp[i] === 'done') return;
            if (!tk.mp[i]) {
              var mp = makeProxy(st, m.el, m.R, true);
              mp.imgs = mp.el.querySelectorAll('img,video,canvas,svg,picture');
              tk.mp[i] = mp;
              copies[i].el.classList.add('sr-swap');
            }
            var mpx = tk.mp[i];
            q = Math.min(1, q);
            mpx.typer.set(mpx.typer.total * clamp(q * 1.15, 0, 1));
            var f = 'blur(' + ((1 - q) * 6).toFixed(1) + 'px) brightness(' + (0.45 + 0.55 * q).toFixed(2) + ')';
            for (var k = 0; k < mpx.imgs.length; k++) mpx.imgs[k].style.filter = q < 1 ? f : '';
            copies[i].el.style.opacity = String(clamp(1 - q * 2.5, 0, 1));
            tk.agent.x = m.R.x + m.R.w + 4; tk.agent.y = m.R.y + Math.min(m.R.h, 40) / 2;
            if (q >= 1) {
              revealEl(st, m.el, true);
              mpx.typer.end(); mpx.el.remove(); copies[i].el.remove();
              sels[i].out();
              tk.mp[i] = 'done';
              countDone(st, g.count, g.section);
            }
          });
        },
        end: function () {
          markItemDone(st, tk.it);
          release(st, tk.agent);
        }
      }
    ];
  }
  // Complete a running task immediately (resize / skip).
  function completeTask(st, tk) {
    var it = tk.it;
    if (it.type === 'clone') {
      it.g.members.forEach(function (m) { revealEl(st, m.el, true); });
    } else if (it.type === 'build') {
      revealEl(st, it.L.el, it.L.tree);
      it.L.state = 'done';
    } else if (it.type === 'block') {
      it.L.blocked = true;
    }
    if (it.state !== 'done') {
      if (it.type === 'clone') countDone(st, it.g.members.length * it.g.count, it.section);
      else if (it.type === 'build') countDone(st, 1, it.section);
      markItemDone(st, it);
    }
    release(st, tk.agent);
    tk.helpers.forEach(function (h) { release(st, h); });
    tk.finished = true;
  }

  // ----------------------------------------------------------------- camera
  function maxScroll() {
    var se = document.scrollingElement || document.documentElement;
    return Math.max(0, se.scrollHeight - window.innerHeight);
  }
  function camera(st, t, dt, vw, vh) {
    if (!st.touring) { st.camY = window.scrollY; st.camV = 0; return; }
    var sp = st.speedBase * st.mult;
    var lowest = -1e9, highest = 1e9;
    st.active.forEach(function (tk) {
      var it = tk.it;
      lowest = Math.max(lowest, it.y + Math.min(it.h, vh * 0.45));
      highest = Math.min(highest, it.y);
    });
    var next = null;
    for (var k = st.qHead; k < st.queue.length; k++) { if (st.queue[k].state === 'pending') { next = st.queue[k]; break; } }
    var F = lowest;
    if (next) F = Math.max(F, next.y + Math.min(next.h, vh * 0.3));
    var desired = F - vh * 0.74;
    if (highest < 1e9) desired = Math.min(desired, highest - vh * 0.04);
    if (!next && !st.active.length) desired = maxScroll();
    desired = clamp(desired, 0, maxScroll());
    if (Math.abs(window.scrollY - st.camY) > 3) st.camY = window.scrollY; // someone else scrolled
    var diff = desired - st.camY;
    var base = 0.09 * vh * sp;
    var vt = diff <= 1 ? 0 : Math.min(diff * 3, base * (diff > vh * 0.32 ? 3 : 1));
    st.camV = lerp(st.camV, vt, 1 - Math.exp(-dt * 2.6 * Math.max(1, Math.sqrt(sp))));
    if (st.camV < 0.5 && vt === 0) st.camV = 0;
    st.camY = clamp(st.camY + st.camV * dt, 0, maxScroll());
    if (Math.round(st.camY) !== Math.round(window.scrollY)) window.scrollTo({ top: st.camY, left: window.scrollX, behavior: 'instant' });
  }

  // ---------------------------------------------------------------- agents
  function idleMove(st, a, t, dt, vw, vh) {
    var sy = window.scrollY;
    var off = a.y < sy - 40 || a.y > sy + vh + 40;
    if (t > a.next || off || st.flip) {
      a.next = t + rand(2, 4);
      var right = Math.random() < 0.65;
      a.tx = right ? rand(vw * 0.58, vw * 0.96) : rand(vw * 0.05, vw * 0.95);
      a.ty = rand(vh * 0.1, vh * 0.82);
    }
    var tx = a.tx, ty = sy + a.ty;
    var dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy) || 1;
    var spd = off ? 900 : d > 300 ? 260 : 46;
    var vx = dx / d * spd, vy = dy / d * spd;
    var k = 1 - Math.exp(-dt * (off ? 6 : 1.6));
    a.vx = lerp(a.vx, vx, k); a.vy = lerp(a.vy, vy, k);
    if (d < 4) { a.vx *= 0.9; a.vy *= 0.9; }
    a.x += a.vx * dt; a.y += a.vy * dt;
    a.setMode('arrow');
  }
  function renderAgents(st, t, dt) {
    var vw = window.innerWidth, vh = window.innerHeight, sy = window.scrollY, sx = window.scrollX;
    if (st.phase === 'build') {
      if (!st.flipAt || t > st.flipAt) { st.flip = !!st.flipAt; st.flipAt = t + rand(3, 5); } else st.flip = false;
    }
    for (var i = 0; i < st.agents.length; i++) {
      var a = st.agents[i];
      if (!a.active) continue;
      if (st.phase === 'build' && !a.task && !a.scatter) idleMove(st, a, t, dt, vw, vh);
      var x = a.x - sx, y = a.y - sy;
      var hh = a.hist;
      hh.unshift(x, y);
      if (hh.length > 16) hh.length = 16;
      var mx = hh.length >= 6 ? x - hh[4] : 0, my = hh.length >= 6 ? y - hh[5] : 0;
      var spd = Math.hypot(mx, my);
      var target = 0;
      if (a.ringAng != null) target = a.ringAng;
      else if (a.mode === 'arrow' && spd > 7) target = Math.atan2(my, mx) + Math.PI * 0.75;
      a.ang += shortAngle(target - a.ang) * Math.min(1, dt * 12);
      if (a.mode !== 'arrow') a.ang = 0;
      a.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) rotate(' + a.ang.toFixed(3) + 'rad)';
      var show = spd > 14;
      for (var k = 0; k < 3; k++) {
        var g = a.ghosts[k], idx = (k + 1) * 4;
        if (show && hh.length > idx + 1) {
          g.style.opacity = String(0.42 - k * 0.12);
          g.style.transform = 'translate3d(' + hh[idx].toFixed(1) + 'px,' + hh[idx + 1].toFixed(1) + 'px,0) rotate(' + a.ang.toFixed(3) + 'rad)';
        } else if (g.style.opacity !== '0') g.style.opacity = '0';
      }
    }
  }

  // ------------------------------------------------------- guides & rulers
  function renderGuides(st, t, sy, sx, vw, vh) {
    var gi = 0, band = null;
    if (st.phase === 'build') {
      for (var i = 0; i < st.active.length && gi < st.guides.length - 3; i++) {
        var L = st.active[i].guide;
        if (!L) continue;
        var x = L.x - sx, y = L.y - sy;
        band = { x: x, y: y, w: L.w, h: L.h };
        var lines = [[0, y], [0, y + L.h], [1, x], [1, x + L.w]];
        for (var k = 0; k < lines.length && gi < st.guides.length; k++) {
          var g = st.guides[gi++], v = lines[k][0];
          g.className = v ? 'sr-guide sr-gv' : 'sr-guide sr-gh';
          g.style.transform = v ? 'translate3d(' + lines[k][1] + 'px,0,0)' : 'translate3d(0,' + lines[k][1] + 'px,0)';
          g.style.display = '';
        }
      }
    }
    for (; gi < st.guides.length; gi++) if (st.guides[gi].style.display !== 'none') st.guides[gi].style.display = 'none';
    var rulers = st.useRulers && st.phase === 'build' && t < st.rulersUntil;
    if (rulers !== st.rulersOn) {
      st.rulersOn = rulers;
      st.rulerTop.classList.toggle('sr-on', rulers);
      st.rulerLeft.classList.toggle('sr-on', rulers);
    }
    if (rulers && band) {
      st.rulerTopBand.style.transform = 'translateX(' + band.x + 'px)';
      st.rulerTopBand.style.width = band.w + 'px';
      st.rulerLeftBand.style.transform = 'translateY(' + band.y + 'px)';
      st.rulerLeftBand.style.height = band.h + 'px';
    }
  }

  // ------------------------------------------------------------------- HUD
  function updateHud(st, force) {
    var n = st.activeAgents;
    if (force || n !== st._a) { st.hudAgents.innerHTML = '<b>' + n + '</b><small> agents</small>'; st._a = n; }
    var l = st.doneLayers + '/' + (st.totalLayers || 0);
    if (force || l !== st._l) { st.hudLayers.innerHTML = '<b>' + st.doneLayers + '</b><small> / ' + (st.totalLayers || 0) + '</small><small> layers</small>'; st._l = l; }
    var r = st.phase === 'done' ? 1 : st.totalLayers ? st.doneLayers / st.totalLayers : 0;
    var w = r.toFixed(3);
    if (w !== st._w) { st.hud.style.setProperty('--sr-p', w); st._w = w; } // bars scale with transforms only
    var touringLabel = st.phase === 'scan' ? (st.touringShown && st.touring ? 'Touring' : 'Tour') : (st.touring ? 'Touring' : 'Tour');
    if (force || touringLabel !== st._t) {
      st.btnTour.textContent = touringLabel;
      st.btnTour.classList.toggle('sr-on', touringLabel === 'Touring');
      st.btnTour.setAttribute('aria-pressed', touringLabel === 'Touring' ? 'true' : 'false');
      st._t = touringLabel;
    }
  }

  // ---------------------------------------------------------------- finale
  function enterDone(st, t) {
    st.phase = 'done';
    st.doneAt = t;
    st.elapsed = t - st.buildStart;
    st.doneLayers = st.totalLayers;
    api._lastStats = fpsStats(st);
    st.hud.setAttribute('data-state', 'done');
    st.hudDone.innerHTML = 'Rebuilt by <b>' + st.activeAgents + '</b> agents in <b>' + st.elapsed.toFixed(1) + 's</b>';
    st.guides.forEach(function (g) { g.style.display = 'none'; });
    st.rulerTop.classList.remove('sr-on'); st.rulerLeft.classList.remove('sr-on');
    // every layer is revealed: drop all hiding -> DOM/CSS is the original again
    st.sections.forEach(function (s) { s.tails.forEach(function (el) { revealEl(st, el, true); }); });
    removeStyles();
    if (st.mo) { st.mo.disconnect(); st.mo = null; }
    // ring target: the largest media element visible at the final scroll position
    var vh = window.innerHeight, vw = window.innerWidth;
    var finalY = st.touring ? maxScroll() : window.scrollY;
    var best = null, ba = 0;
    st.layers.forEach(function (L) {
      if (L.kind !== 'media') return;
      if (L.y + L.h < finalY || L.y > finalY + vh) return;
      var a = L.w * L.h;
      if (a > ba) { ba = a; best = L; }
    });
    st.ring = best ? { x: best.x + best.w / 2, y: best.y + best.h / 2, r: clamp(Math.max(best.w, best.h) * 0.62, 110, Math.min(320, vh * 0.42)) }
      : { x: window.scrollX + vw * 0.68, y: finalY + vh * 0.48, r: Math.min(260, vh * 0.32) };
    var fs = Math.min(st.speedBase * st.mult, 2.5);
    st.fin = { swarm: 1.1 / fs, form: 1.3 / fs };
    st.agents.forEach(function (a, i) {
      a.task = null; a.setMode('arrow');
      a.ringSlot = (i / Math.max(1, st.activeAgents)) * Math.PI * 2;
      a.sw = { fx: a.x, fy: a.y, ph: rand(0, 6.28) };
    });
    var ax = st.o.autoExit != null ? st.o.autoExit : (st.o.mode === 'tour' ? null : 6);
    if (ax != null) st.timers.push(setTimeout(function () { if (S === st) finishNow(st); }, ax * 1000));
    updateHud(st, true);
    placeHud(st, true);
    if (typeof st.o.onDone === 'function') { try { st.o.onDone({ elapsed: st.elapsed, layers: st.totalLayers, agents: st.activeAgents }); } catch (e) { /* ignore */ } }
  }
  function finaleStep(st, t, dt, vw, vh) {
    if (st.touring) {
      var ms = maxScroll();
      if (Math.abs(window.scrollY - st.camY) > 3) { st.touring = false; updateHud(st, true); }
      else if (st.camY < ms - 1) {
        st.camY = lerp(st.camY, ms, 1 - Math.exp(-dt * 3));
        window.scrollTo({ top: st.camY, left: window.scrollX, behavior: 'instant' });
      }
    }
    var T = t - st.doneAt, R = st.ring, n = 0;
    st.agents.forEach(function (a) {
      if (!a.active) return;
      n++;
      if (T < st.fin.swarm) {
        // stream towards the target, swirling
        var p = T / st.fin.swarm;
        var ang = a.sw.ph + p * 5;
        var rr = R.r * (1.6 - p) * 0.9;
        var tx = R.x + Math.cos(ang) * rr, ty = R.y + Math.sin(ang * 1.3) * rr * 0.7;
        var k = 1 - Math.exp(-dt * 4);
        a.x = lerp(a.x, tx, k); a.y = lerp(a.y, ty, k);
        a.ringAng = null;
      } else {
        var q = clamp((T - st.fin.swarm) / st.fin.form, 0, 1);
        var th = a.ringSlot + (T - st.fin.swarm) * 0.18;
        var rx = R.x + Math.cos(th) * R.r, ry = R.y + Math.sin(th) * R.r;
        var kk = q < 1 ? 1 - Math.exp(-dt * 5) : 1;
        a.x = lerp(a.x, rx, kk); a.y = lerp(a.y, ry, kk);
        if (q > 0.5) a.ringAng = th + Math.PI / 2 + Math.PI * 0.75;
      }
    });
  }

  // ------------------------------------------------------- exit / replay
  function finishNow(st) {
    if (S !== st) return;
    st.active.forEach(function (tk) { if (!tk.finished) completeTask(st, tk); });
    teardown(st, true);
  }
  function teardown(st, done) {
    if (st.phase === 'build') api._lastStats = fpsStats(st);
    cancelAnimationFrame(st.raf);
    st.timers.forEach(clearTimeout);
    st.listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
    if (st.mo) st.mo.disconnect();
    if (st.root) st.root.remove();
    removeStyles();
    S = null;
    api.active = false;
    if (done && st.phase !== 'done' && typeof st.o.onDone === 'function') { try { st.o.onDone({ skipped: true }); } catch (e) { /* ignore */ } }
  }
  function replay(st) {
    var o = assign({}, st.o, { force: true });
    teardown(st, false);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    ensureHide();
    run(o);
  }
  function onResize(st) {
    if (st.layers.length) { measureGutter(st); autoCollapse(st); }
    placeHud(st, true);
    if (st.phase !== 'build' && st.phase !== 'scan') return;
    // finish what is in flight, then re-measure what is still pending
    st.active.forEach(function (tk) { if (!tk.finished) completeTask(st, tk); });
    st.active = [];
    st.world.querySelectorAll('.sr-sel,.sr-ph,.sr-rline,.sr-rlabel,.sr-bline,.sr-cghost,.sr-clone,.sr-sel-ghost').forEach(function (e) { e.remove(); });
    var sx = window.scrollX, sy = window.scrollY;
    st.layers.forEach(function (L) {
      if (L.ph || L.sel) { L.ph = null; L.sel = null; L.blocked = false; L.needsBlock = false; }
      if (L.state === 'done' || !L.el.isConnected) return;
      var r = L.el.getBoundingClientRect();
      L.x = r.left + sx; L.y = r.top + sy; L.w = r.width; L.h = r.height;
      if (L.item) { L.item.y = L.y; L.item.h = L.h; }
    });
    st.queue.forEach(function (it) {
      if (it.type === 'block' && it.state !== 'done') markItemDone(st, it);
      if (it.type === 'clone') {
        var r = it.g.master.el.getBoundingClientRect();
        it.g.master.R = { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height };
        it.y = it.g.master.R.y;
        it.g.members.forEach(function (m) { var q = m.el.getBoundingClientRect(); m.R = { x: q.left + sx, y: q.top + sy, w: q.width, h: q.height }; });
      }
    });
  }

  // ------------------------------------------------------------------ stats
  function snapshot(st) {
    var vh = window.innerHeight, ms = maxScroll();
    return {
      phase: st.phase, mode: st.o.mode, touring: st.touring, speed: st.speedBase * st.mult,
      layersDone: st.doneLayers, layersTotal: st.totalLayers, agents: st.activeAgents,
      activeTasks: st.active.length, t: now() - st.t0,
      buildT: st.buildStart ? now() - st.buildStart : 0,
      elapsed: st.elapsed || null, scrollProgress: ms ? window.scrollY / ms : 0, viewportHeights: ms / vh + 1,
      hud: st.hud ? st.hud.textContent : '',
      controls: { position: st.pos, collapsed: !!st.collapsed, corner: st.corner || null },
      seen: st.seenStats, visiblePending: st.visPending || 0, maxAhead: +st.maxAhead.toFixed(3),
      waits: st.waits.length ? { n: st.waits.length, avg: +(st.waits.reduce(function (x, y) { return x + y; }, 0) / st.waits.length).toFixed(3), max: +Math.max.apply(null, st.waits).toFixed(3) } : null
    };
  }
  function fpsStats(st) {
    var f = st.frames.slice(10);
    if (!f.length) return null;
    var sum = 0; f.forEach(function (d) { sum += d; });
    var sorted = f.slice().sort(function (a, b) { return b - a; });
    var p95 = sorted[Math.floor(sorted.length * 0.05)] || sorted[0];
    return { frames: f.length, avgFps: +(f.length / sum).toFixed(1), p95FrameMs: +(p95 * 1000).toFixed(1), agents: st.maxAgents };
  }

  window.SwarmRebuild = api;

  // auto start: <script src="swarm-rebuild.js" data-auto data-mode="fast"></script>
  var cur = document.currentScript;
  if (cur && cur.hasAttribute('data-auto')) {
    var ds = cur.dataset, opts = {};
    if (ds.mode) opts.mode = ds.mode;
    if (ds.speed) opts.speed = parseFloat(ds.speed);
    if (ds.agents) opts.agents = parseInt(ds.agents, 10);
    if (ds.exclude) opts.exclude = ds.exclude;
    if (ds.controlsPosition) opts.controlsPosition = ds.controlsPosition;
    if (ds.once === 'false') opts.once = false;
    var go = function () { start(opts); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
})();
