/*!
 * swarm-rebuild v1.2.0
 * "The page rebuilds itself": a swarm of agent cursors re-creates an existing
 * page layer by layer (frames, typing, image reveals, clone-and-rewrite),
 * following the visitor's scrolling. Free agents fly in swarms around a focus
 * element (damped springs, no perfect circles), the way to a task bends with
 * the weight of the element, bigger parts take longer, and on desktop agents
 * dodge the mouse pointer and follow it for a moment.
 *
 * - No dependencies, no network requests (except the optional debug add-on,
 *   swarm-rebuild-debug.js, loaded only with ?rebuild-debug=1 or debug: true).
 * - Presentation only: the page's own DOM (everything inside <body>) is never
 *   modified. Hiding/revealing is done with one cascade-layered stylesheet in
 *   <head>; animation happens in an overlay appended to <html>. When the effect
 *   ends, both are removed and the document is back to its original state.
 * - Never leaves the page half hidden: any click or key shows the finished page,
 *   whatever scrolls above the view is finished at once, a failing or stuck part
 *   is finished on its own, and a CSS dead-man switch shows the page even if the
 *   script stops running.
 * - Works as a classic <script> (window.SwarmRebuild) or as a side-effect
 *   import from a bundler (React / Next.js client component).
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.SwarmRebuild && window.SwarmRebuild.version) return;

  var VERSION = '1.2.0';
  var LAYER = 'swarm-rebuild';
  var HIDE_ID = 'swarm-rebuild-hide';
  var REVEAL_ID = 'swarm-rebuild-reveal';
  var ROOT_ID = 'swarm-rebuild-root';
  var SEEN_KEY = 'swarm-rebuild:seen';
  var VISIBLE = 0.6;      // scroll / fast: an element starts only when this share of it (of the viewport for taller ones) is in view
  var ABOVE = 0.1;        // hysteresis: a layer that is this much (of a viewport, min. 40 px) above the view is finished at once
  var TASK_MAX = 8;       // s: a task running longer than this is finished without animation (watchdog)
  var LOOP_MAX = 2.5;     // s without an animation frame while the tab is visible: show the page
  var STALL_MAX = 10;     // s without any progress while layers in view wait: show the page
  var DMS_MS = 5000;      // CSS dead-man switch: the page is shown this long after the script stops refreshing it
  var HIDDEN_MAX = 30;    // s in a background tab: show the finished page on return
  // --sr-v / --sr-o are set only by the dead-man switch animation on <html> (see dmsStart)
  var HIDE_CSS = '@layer ' + LAYER + '{body *{visibility:var(--sr-v,hidden)!important}#' + ROOT_ID + '{opacity:var(--sr-o,1)!important}}';
  var DMS_KF = [{ '--sr-v': 'visible', '--sr-o': '0' }];
  var PALETTE = ['#5fd6e8', '#f4a3b8', '#f6c48d', '#a99cf5', '#6aa7ff', '#8fe3b5', '#f2f4f8'];
  var MODE_SPEED = { tour: 1, fast: 6, scroll: 3 };
  var LAYERS_PER_SEC = 7.1; // video: 364 layers in 51.4 s at 1x
  var MODKEY = { Shift: 1, Control: 1, Alt: 1, AltGraph: 1, Meta: 1, OS: 1, Super: 1, Hyper: 1, Fn: 1, FnLock: 1, CapsLock: 1, NumLock: 1, ScrollLock: 1, Symbol: 1, SymbolLock: 1, Dead: 1, Process: 1, Unidentified: 1 };
  // keys that scroll the page: they drive the build like the mouse wheel (with focus on the page itself)
  var SCROLLKEY = { ' ': 1, Spacebar: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Up: 1, Down: 1, Left: 1, Right: 1, PageUp: 1, PageDown: 1, Home: 1, End: 1 };
  // motion
  var ARC_K = 0.2;        // gravity: downward sag = ARC_K x horizontal distance x weight x horizontality^2 ...
  var ARC_CAP = 56;       // ... at most this many px (and at most a fifth of the horizontal distance)
  var ARC_REF = 320;      // px: an element with sqrt(area) >= this weighs 1 (small elements: at least ARC_MIN)
  var ARC_MIN = 0.2;
  var DIFF_EXP = 0.85;    // difficulty ~ area^0.85 near the page average (2x area -> ~1.6-1.8x the work) ...
  var DIFF_SPAN = 1;      // ... squashed to 2^+-1: the hardest task takes at most ~4x the easiest
  var MOUSE_MIN = 36;     // px: an agent never comes closer to the mouse pointer than this
  var ACTION = 'a[href],area[href],button,input,select,textarea,label,summary,details,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"],[onclick],[tabindex],[contenteditable=""],[contenteditable="true"]';

  var DEFAULTS = {
    mode: 'scroll',          // 'scroll' (follows the visitor, 3x) | 'fast' (follows the visitor, 6x) | 'tour' (debug only: auto-scroll, 1x)
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
    autoExit: null,          // seconds after finishing to remove the overlay; null = 3 (debug: 6, tour: never)
    groupMin: 3,             // min. repeated siblings to use clone-and-rewrite
    rulers: true,
    debug: false,            // load swarm-rebuild-debug.js: control bar, tour, test hooks (also ?rebuild-debug=1)
    debugSrc: null,          // URL of swarm-rebuild-debug.js; null = next to this file
    controlsPosition: 'right', // debug control bar: 'right' | 'left' | 'bottom' (mobile: a small tab near a free corner)
    avoid: 'a[href^="tel:"],a[href^="mailto:"],button,[role="button"],input,select,textarea,[data-swarm-avoid]', // debug bar on mobile never covers these
    buildVisible: VISIBLE,   // scroll / fast: share of an element (of the viewport for taller ones) that must be in view
                             // before it starts to build (0.1..1); nothing is ever built outside the view
    focus: null,             // CSS selector (or element) the opening and closing swarms gather around; null = auto
                             // (the first one in view of: [data-swarm-focus], h1, a main button, the logo)
    motion: null,            // fine-tuning of the motion, see MOTION (merged key by key)
    force: false,
    onDone: null
  };
  var MOTION = {
    swarms: true,            // free agents move in small swarms of different sizes (false: one swarm)
    mouse: true,             // opening / finale: agents dodge the mouse pointer and follow it for a moment (never on touch)
    arc: 1,                  // gravity: horizontal moves bend downwards with the weight of the carried element (0 = straight)
    difficulty: 1,           // bigger parts take longer, smaller ones less; the total stays the same (0 = all alike)
    spring: 1,               // finale: overshoot of the pull towards the focus element (0 = none)
    lite: 'auto'             // simpler motion: 'auto' (phones, and when the frame rate drops), true, false
  };

  // ---------------------------------------------------------------- helpers
  function now() { return performance.now() / 1000; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function warn(msg, err) { try { console.warn('[swarm-rebuild] ' + msg, err || ''); } catch (e) { /* ignore */ } }
  // everything a running task creates in the overlay is recorded, so a failed or skipped task can be cleaned up
  function own(el) { var c = S && S.cur; if (c) (c.bag || (c.bag = [])).push(el); return el; }
  function mk(tag, cls, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) { parent.appendChild(e); if (S && parent === S.world) own(e); }
    return e;
  }
  function rm(e) { if (e && e.parentNode) e.parentNode.removeChild(e); }
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
      (document.head || document.documentElement).appendChild(e);
    }
    if (e.textContent !== HIDE_CSS) e.textContent = HIDE_CSS; // an older head snippet: use the current rule
    return e;
  }
  function removeStyles() {
    rm(hideEl());
    rm(document.getElementById(REVEAL_ID));
  }

  // ------------------------------------------------- CSS dead-man switch
  // A Web Animation on <html> that, after DMS_MS, sets --sr-v: visible (every element shows its own visibility
  // again) and --sr-o: 0 (overlay invisible). The running effect pushes the deadline back on every frame.
  // If the script stops (an error, a frozen loop, a killed timer), the browser itself shows the page.
  function dmsStart() {
    var a = window.__srDms;
    if (!a || a.playState === 'finished') {
      try { a = document.documentElement.animate(DMS_KF, { duration: 1, delay: DMS_MS, fill: 'forwards' }); } catch (e) { a = null; }
    }
    window.__srDms = a;
    return a;
  }
  function dmsFired() { var a = window.__srDms; return !!(a && a.playState === 'finished'); }
  function dmsBeat(delay) {
    var a = window.__srDms;
    if (!a) return;
    try { if (delay) a.effect.updateTiming({ delay: delay }); a.currentTime = 0; } catch (e) { /* ignore */ }
  }
  function dmsStop() {
    var a = window.__srDms;
    window.__srDms = null;
    if (a) { try { a.cancel(); } catch (e) { /* ignore */ } }
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
    own(c);
    var typer = new Typer(c, empty, st.world);
    return { el: c, typer: typer, kill: function () { typer.end(); rm(c); } };
  }
  // Typing: every text node is split into the typed part and a hidden rest, so each word already sits at its
  // final place (no reflow while typing: words never jump to the next line, nothing counts as a layout shift).
  function Typer(root, empty, world) {
    this.world = world;
    this.nodes = [];
    this.total = 0;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), list = [], n;
    while ((n = w.nextNode())) if (/\S/.test(n.data)) list.push(n);
    for (var i = 0; i < list.length; i++) {
      this.nodes.push({ n: list[i], full: list[i].data, rest: null, shown: list[i].data.length });
      this.total += list[i].data.length;
    }
    this.caret = null;
    if (empty) this.set(0);
  }
  Typer.prototype.set = function (k) {
    var rem = Math.max(0, Math.floor(k)), last = null;
    for (var i = 0; i < this.nodes.length; i++) {
      var o = this.nodes[i], take = Math.min(rem, o.full.length);
      if (o.shown !== take) {
        if (!o.rest) { // created on first use only (copies that are never typed keep their structure)
          o.rest = document.createElement('sr-r');
          o.rest.setAttribute('style', 'all:unset;visibility:hidden');
          o.n.parentNode.insertBefore(o.rest, o.n.nextSibling);
        }
        o.n.data = o.full.slice(0, take); o.rest.textContent = o.full.slice(take); o.shown = take;
      }
      rem -= take;
      if (take > 0 || !last) last = o;
    }
    // caret: absolutely positioned at the end of the typed text, moved with transforms (no layout shift)
    if (!this.caret && last && this.world) {
      this.caret = document.createElement('i'); this.caret.className = 'sr-caret';
      this.caret.style.color = getComputedStyle(last.n.parentNode).color;
      this.world.appendChild(this.caret);
      own(this.caret);
    }
    if (this.caret && last && last.n.parentNode) {
      var r = this.range || (this.range = document.createRange()), len = last.n.data.length, rc;
      if (len) { r.setStart(last.n, len - 1); r.setEnd(last.n, len); rc = r.getBoundingClientRect(); }
      else { rc = last.n.parentNode.getBoundingClientRect(); rc = { right: rc.left, top: rc.top, height: Math.min(rc.height, 40) }; }
      this.caret.style.height = Math.max(8, rc.height) + 'px';
      this.caret.style.transform = 'translate3d(' + (rc.right + window.scrollX + 1) + 'px,' + (rc.top + window.scrollY) + 'px,0)';
    }
  };
  Typer.prototype.end = function () { this.set(this.total); rm(this.caret); this.caret = null; };

  // -------------------------------------------------------------- overlay UI
  function Sel(st, red) {
    var e = mk('div', 'sr-sel' + (red ? ' sr-red' : ''), st.world);
    var hp = this.hp = {};
    ['tl', 'tr', 'bl', 'br', 'tm', 'bm', 'ml', 'mr'].forEach(function (k) { hp[k] = mk('i', 'sr-h-' + k, e); });
    this.label = mk('span', 'sr-size', e);
    this.el = e; this.txt = ''; this.big = false; this.st = st;
    this.ghost = null; this.hist = [];
    this.x = this.y = this.w = this.h = 0;
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
    } else if (this.ghost) { rm(this.ghost); this.ghost = null; }
  };
  Sel.prototype.out = function () {
    var e = this.el;
    e.classList.add('sr-out');
    rm(this.ghost); this.ghost = null;
    fading(this.st, e, this.y + this.h + 24, 260);
  };
  Sel.prototype.kill = function () { rm(this.el); rm(this.ghost); this.ghost = null; };
  // fading leftovers: removed after their fade, or at once when they scroll above the view
  function fading(st, el, bottom, ms) {
    var o = { el: el, b: bottom };
    st.outs.push(o);
    st.timers.push(setTimeout(function () { rm(el); var i = st.outs.indexOf(o); if (i >= 0) st.outs.splice(i, 1); }, ms));
  }
  function Ph(st, media) {
    var e = mk('div', 'sr-ph' + (media ? ' sr-ph-media' : ''), st.world);
    if (media) { e.innerHTML = ICON_IMG; this.ic = e.firstChild; }
    this.el = e;
  }
  Ph.prototype.set = function (x, y, w, h) {
    var s = this.el.style;
    s.transform = 'translate3d(' + x + 'px,' + y + 'px,0)'; s.width = w + 'px'; s.height = h + 'px';
    // the icon is centred with a transform: a growing placeholder never moves it by layout (no layout shift)
    if (this.ic) this.ic.style.transform = 'translate(' + (w / 2 - 11) + 'px,' + (h / 2 - 11) + 'px)';
  };
  Ph.prototype.remove = function () { rm(this.el); };

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
  var S = null, pending = null, stopped = false;
  var SCRIPT = document.currentScript, SCRIPT_SRC = SCRIPT && SCRIPT.src;
  var api = {
    version: VERSION,
    active: false,
    defaults: assign({}, DEFAULTS),
    start: start,
    stop: function () { stopped = true; if (S) teardown(S, false); else if (pending) { pending = null; removeStyles(); dmsStop(); api.active = false; } },
    skip: function () { if (S) finishNow(S, 'api'); },
    goLive: function () { if (S) finishNow(S, 'api'); },
    replay: function () { if (S) replay(S); },
    state: function () { return S ? snapshot(S) : pending ? { phase: 'loading' } : { phase: 'idle', lastExit: api._lastExit || null }; },
    stats: function () { return S ? fpsStats(S) : (api._lastStats || null); },
    headSnippet: function () { return '<script>' + SNIPPET + '<\/script>'; },
    // test hook: freeze the animation (the dead-man switch keeps being refreshed)
    _pause: function (on) { if (S) S.paused = !!on; }
  };
  // Head snippet: hides the content before first paint, starts the dead-man switch, and shows the page again
  // after 5 s if the module never started (blocked, failed to load).
  var SNIPPET = "(function(d,w){w.__swarmRebuildSnippet=1;try{var q=new URLSearchParams(location.search).get('rebuild');if(q==='0')return;if(w.matchMedia&&w.matchMedia('(prefers-reduced-motion: reduce)').matches)return;if(q!=='1'&&sessionStorage.getItem('swarm-rebuild:seen'))return;var s=d.createElement('style');s.id='swarm-rebuild-hide';s.textContent='" + HIDE_CSS + "';d.head.appendChild(s);try{w.__srDms=d.documentElement.animate([{'--sr-v':'visible','--sr-o':'0'}],{duration:1,delay:" + DMS_MS + ",fill:'forwards'})}catch(e){}setTimeout(function(){var r=w.SwarmRebuild;if(!(r&&r.active)){var e=d.getElementById('swarm-rebuild-hide');if(e)e.remove()}}," + DMS_MS + ")}catch(e){}})(document,window);";

  function motionOff(o) {
    try { return !!(o.motionOffSelector && document.querySelector(o.motionOffSelector)); } catch (e) { return false; }
  }

  function start(userOpts) {
    if (S || pending) return api;
    stopped = false;
    var q = params();
    var cfg = window.SwarmRebuildConfig;
    var o = assign({}, DEFAULTS, cfg, userOpts);
    o.motion = assign({}, MOTION, cfg && cfg.motion, userOpts && userOpts.motion);
    if (q.get('rebuild-debug') === '1') o.debug = true;
    if (q.get('rebuild-mode')) o.mode = q.get('rebuild-mode');
    if (!MODE_SPEED[o.mode]) o.mode = DEFAULTS.mode;
    if (o.debug) {
      // test-only parameters
      if (q.get('rebuild-speed')) o.speed = parseFloat(q.get('rebuild-speed')) || null;
      if (q.get('rebuild-fault')) o.fault = q.get('rebuild-fault');
      if (q.get('rebuild-hidden-max')) o.hiddenMax = parseFloat(q.get('rebuild-hidden-max'));
      // motion settings for A/B tests: ?rebuild-motion=arc:0,difficulty:0,mouse:0,lite:1
      (q.get('rebuild-motion') || '').split(',').forEach(function (kv) {
        var m = /^(\w+):(.*)$/.exec(kv);
        if (m && m[1] in MOTION) o.motion[m[1]] = m[2] === 'auto' ? 'auto' : m[2] === 'true' ? true : m[2] === 'false' ? false : parseFloat(m[2]);
      });
      if (q.get('rebuild-focus')) o.focus = q.get('rebuild-focus');
      if (q.get('rebuild-visible')) o.buildVisible = parseFloat(q.get('rebuild-visible'));
    }
    var force = o.force || q.get('rebuild') === '1';
    var skip = q.get('rebuild') === '0' || reducedMotion() || motionOff(o) || (typeof o.skipIf === 'function' && o.skipIf());
    if (!skip && !force && o.once && store(SEEN_KEY)) skip = true;
    if (!skip && !hideEl() && window.__swarmRebuildSnippet && !force) skip = true; // snippet decided "no" (or its watchdog fired)
    if (!skip && dmsFired()) skip = true;      // the dead-man switch already showed the page: too late to start
    if (skip) { removeStyles(); dmsStop(); return api; }
    ensureHide();
    dmsStart();
    store(SEEN_KEY, '1');
    if (o.debug && !window.SwarmRebuildDebug) {
      api.active = true;
      pending = o;
      loadDebug(o, function () { if (pending !== o) return; pending = null; if (!stopped) run(o); });
    } else run(o);
    return api;
  }
  function loadDebug(o, cb) {
    var src = o.debugSrc || (SCRIPT_SRC && /swarm-rebuild(\.min)?\.js/.test(SCRIPT_SRC) ? SCRIPT_SRC.replace(/swarm-rebuild(\.min)?\.js/, 'swarm-rebuild-debug$1.js') : null);
    var done = false, fin = function () { if (!done) { done = true; cb(); } };
    if (!src) { warn('debug: set debugSrc (or import swarm-rebuild-debug.js first); running without the debug tools'); return fin(); }
    var s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = fin;
    s.onerror = function () { warn('debug: could not load ' + src); fin(); };
    setTimeout(fin, 4000);
    (document.head || document.documentElement).appendChild(s);
  }

  function run(o) {
    var st = S = {
      o: o, t0: now(), last: now(), phase: 'scan', layers: [], queue: [], active: [], groups: [],
      tails: [], instant: [], reveals: [], doneLayers: 0, totalLayers: 0, tokens: 1, qHead: 0,
      mult: 1, touring: false, camY: 0, camV: 0, frames: [], rulersUntil: 0,
      sections: [], sectionOpen: [], timers: [], listeners: [], fixedEls: [], stickyEls: [], outs: [],
      revealed: new WeakSet(), holeEls: [], holeKey: '',
      seenStats: { initial: { pending: 0, active: 0, done: 0 }, tour: { pending: 0, active: 0, done: 0 }, manual: { pending: 0, active: 0, done: 0 } },
      waits: [], maxAhead: -1, aboveSkips: 0, offSkips: 0, depSkips: 0, aborts: 0, errors: 0, late: 0,
      startVis: { n: 0, min: 1, sum: 0 }
    };
    api.active = true;
    var factory = window.SwarmRebuildDebug;
    if (o.debug && typeof factory === 'function') {
      try { st.dbg = factory(core, st); } catch (e) { warn('debug add-on failed', e); st.dbg = null; }
    }
    if (st.dbg) st.mlog = { moves: [], tasks: [], starts: [] }; // measurements for the tests (debug only)
    if (o.mode === 'tour' && !st.dbg) { warn('mode "tour" needs the debug add-on (?rebuild-debug=1); using "scroll"'); o.mode = 'scroll'; }
    st.touring = o.mode === 'tour';
    st.vmin = clamp(+o.buildVisible || VISIBLE, 0.1, 1);
    st.speedBase = o.speed || MODE_SPEED[o.mode];
    st.hiddenMax = o.hiddenMax != null && !isNaN(o.hiddenMax) ? o.hiddenMax : HIDDEN_MAX;
    st.mobile = window.innerWidth < 760 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    st.useRulers = o.rulers && !st.mobile;
    // simpler motion on phones / when forced (and later when the frame rate drops, see tick)
    st.lite = o.motion.lite === true || (o.motion.lite !== false && st.mobile);
    st.mouseOn = !!o.motion.mouse && !st.lite && hoverMouse();
    st.mz = { dodges: 0, follows: [], minD: null };
    st.mfollow = 0;
    st.focusCands = focusCands(o);
    st.focusInfo = {};
    st.openScale = Math.min(st.speedBase, 3);
    st.scanDur = 0.85 / st.openScale;
    st.bg = pageBg();
    st.vw0 = window.innerWidth;
    if (st.touring) { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }
    st.camY = window.scrollY;
    st.lastTick = st.progressAt = now();
    buildOverlay(st);
    if (st.dbg) st.dbg.init(st);
    // provisional agent count for the opening swarm; refined after the scan
    st.maxAgents = clamp(o.agents || 30, 6, 30);
    if (st.mobile) st.maxAgents = Math.min(st.maxAgents, 8);
    createAgents(st);
    bindEvents(st);
    if (o.fault) setupFault(st, o.fault);
    var fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    Promise.race([fontsReady, new Promise(function (r) { setTimeout(r, 700); })]).then(function () {
      if (S !== st) return;
      try { scan(st); plan(st); } catch (err) { warn('scan failed, showing the page', err); finishNow(st, 'error'); return; }
      st.scanned = true;
      if (st.dbg) st.dbg.scanned(st);
    });
    st.raf = requestAnimationFrame(function f() {
      if (S !== st || st.dead) return;
      try { tick(st); } catch (err) { fail(st, err); return; }
      if (S === st && !st.dead) st.raf = requestAnimationFrame(f);
    });
    // watchdog outside the animation loop (also runs when an error stopped the loop)
    st.timers.push(setInterval(function () { if (S === st && !st.dead) { try { watch(st); } catch (err) { fail(st, err); } } }, 1000));
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
    root.setAttribute('aria-hidden', 'true');
    root.style.setProperty('--sr-bg', st.bg);
    var deco = st.deco = mk('div', 'sr-deco', root);
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
    st.root = root;
    document.documentElement.appendChild(root);
  }

  function createAgents(st) {
    st.agents = [];
    var vw = window.innerWidth, vh = window.innerHeight, sy = window.scrollY;
    for (var i = 0; i < st.maxAgents; i++) {
      var a = new Agent(st, i);
      a.wob = rand(0, 6.28);
      st.agents.push(a);
    }
    makeSwarms(st);
    // the opening is short (well under a second for visitors): the swarms are already circling the focus
    // element when they appear, each agent near its place and moving along
    var t = now(), F = focusAt(st, sy);
    st.openO = orbitOf(st, F, sy); st.openAt = t + 0.5; st.focusInfo.open = focusLabel(F);
    orbitSwarms(st, st.openO, t, 0, 1.5);
    st.agents.forEach(function (a) {
      var p = slot(a, t), s = a.swarm, v = 1.5 * s.sp * st.openO.rx * rand(0.6, 1);
      a.x = p[0] + rand(-24, 24); a.y = p[1] + rand(-24, 24);
      a.vx = -Math.sin(s.th) * v; a.vy = Math.cos(s.th) * v * st.openO.ry / st.openO.rx;
    });
    st.activeAgents = Math.min(st.maxAgents, st.mobile ? 6 : 16);
    for (var j = 0; j < st.activeAgents; j++) st.agents[j].show(true);
  }

  // ----------------------------------------------------------------- exits
  // Esc, any other key (not a lone modifier) and any click or tap show the finished page at once.
  // A click on something that was not finished yet is swallowed: the visitor could not see what they hit,
  // so it must not follow a link or press a button. A click on something already finished goes through.
  function bindEvents(st) {
    function on(t, ev, fn, opt) {
      var g = function (e) { if (S !== st || st.dead) return; try { fn(e); } catch (err) { fail(st, err); } };
      t.addEventListener(ev, g, opt); st.listeners.push([t, ev, g, opt]);
    }
    st.on = on;
    on(window, 'keydown', function (e) {
      if (MODKEY[e.key] || e.isComposing) return;
      if (e.key !== 'Escape' && st.root.contains(e.target)) return; // keyboard use of the debug bar
      if (scrollKey(e)) return; // the page scrolls: the build follows, like with the mouse wheel
      finishNow(st, 'key');
    }, true);
    // the mouse pointer (never touch): free agents dodge it and follow it for a moment (opening / finale)
    on(window, 'pointermove', function (e) {
      if (e.pointerType !== 'mouse' || !st.mouseOn) return;
      var m = st.mouse, tt = now();
      if (m && !m.out) {
        var h = Math.max(0.008, tt - m.t), k = Math.min(1, h / 0.05);
        m.vx = lerp(m.vx, (e.clientX - m.cx) / h, k); m.vy = lerp(m.vy, (e.clientY - m.cy) / h, k);
      } else m = st.mouse = { vx: 0, vy: 0 };
      m.cx = e.clientX; m.cy = e.clientY; m.t = tt; m.out = false;
    }, { passive: true, capture: true });
    on(document, 'pointerout', function (e) { if (!e.relatedTarget && st.mouse) st.mouse.out = true; }, { passive: true, capture: true });
    on(window, 'pointerdown', function (e) {
      if (e.pointerType === 'touch') return; // may be the start of a scroll: a tap ends the effect on "click"
      if (st.root.contains(e.target)) return;
      var de = document.documentElement;
      if (e.clientX >= de.clientWidth || e.clientY >= de.clientHeight) return; // the scrollbar scrolls
      exitByPointer(st, e);
    }, true);
    on(window, 'click', function (e) { if (!st.root.contains(e.target)) exitByPointer(st, e); }, true);
    on(window, 'resize', function () {
      // a new width reflows the page: show it as it is now instead of animating stale positions
      if (Math.abs(window.innerWidth - st.vw0) > 2) finishNow(st, 'resize');
      else if (st.dbg) st.dbg.resize(st);
    });
    on(document, 'visibilitychange', function () {
      if (document.hidden) { st.hiddenAt = now(); dmsBeat(600000); return; }
      var away = st.hiddenAt ? now() - st.hiddenAt : 0;
      st.hiddenAt = 0; st.lastTick = st.progressAt = now();
      dmsBeat(DMS_MS);
      if (away > st.hiddenMax) finishNow(st, 'hidden');
    });
    on(window, 'pageshow', function (e) { if (e.persisted) finishNow(st, 'pageshow'); });
    if (st.dbg) st.dbg.bind(st, on);
    if (window.MutationObserver) {
      st.mo = new MutationObserver(function (list) {
        if (S !== st || st.dead) return;
        try {
          for (var i = 0; i < list.length; i++) {
            if (list[i].type !== 'childList') continue;
            st.dirtySel = true;
            var add = list[i].addedNodes;
            for (var j = 0; j < add.length; j++) if (add[j].nodeType === 1 && st.scanned) addLate(st, add[j]);
          }
        } catch (err) { fail(st, err); }
      });
      st.mo.observe(document.body, { childList: true, subtree: true });
    }
  }
  // Space, arrows, Page Up / Down, Home / End with the focus on the page itself (not in a field, on a link or a
  // button, and without Ctrl / Alt / Meta) only scroll. Tab, Enter, Esc and all other keys end the effect, so
  // keyboard users reach the content at once.
  function scrollKey(e) {
    if (!SCROLLKEY[e.key] || e.ctrlKey || e.metaKey || e.altKey) return false;
    var tg = e.target;
    if (!tg || tg === window || tg === document || tg === document.body || tg === document.documentElement) return true;
    return !(tg.closest && tg.closest(ACTION));
  }
  function exitByPointer(st, e) {
    var tg = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
    var act = tg && tg.closest ? (tg.closest(ACTION) || tg) : tg;
    if (!act || !settled(st, act)) {
      e.preventDefault(); e.stopPropagation();
      if (e.type === 'pointerdown') swallowClick();
    }
    finishNow(st, 'click');
  }
  function swallowClick() {
    var kill = function (e) { e.preventDefault(); e.stopPropagation(); off(); };
    var off = function () { window.removeEventListener('click', kill, true); clearTimeout(tm); };
    var tm = setTimeout(off, 1000);
    window.addEventListener('click', kill, true);
  }
  // finished = visible, and no unfinished layer is it, inside it, or reveals it
  function settled(st, el) {
    if (st.phase === 'done' || el === document.body || el === document.documentElement) return true;
    if (getComputedStyle(el).visibility !== 'visible') return false;
    for (var i = 0; i < st.layers.length; i++) {
      var L = st.layers[i];
      if (L.state === 'done') continue;
      if (L.el === el || el.contains(L.el) || (L.tree && L.el.contains(el))) return false;
    }
    for (var j = 0; j < st.groups.length; j++) {
      var g = st.groups[j];
      if (!g.item || g.item.state === 'done') continue;
      for (var k = 0; k < g.members.length; k++) { var m = g.members[k].el; if (m === el || m.contains(el) || el.contains(m)) return false; }
    }
    return true;
  }
  // content added to the page after the scan is not animated: it is shown at once
  function addLate(st, el) {
    if (SKIP_TAG[el.localName]) return;
    if (++st.late > 300) { finishNow(st, 'mutations'); return; } // the page was replaced (e.g. client-side navigation)
    revealEl(st, el, true);
    try { if (getComputedStyle(el).position === 'fixed') st.fixedEls.push(el); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------- protection
  function fail(st, err) {
    st.errors++;
    warn('unexpected error, showing the page', err);
    try { finishNow(st, 'error'); } catch (e) { hardReset(); }
  }
  function hardReset() {
    try { rm(document.getElementById(ROOT_ID)); } catch (e) { /* ignore */ }
    try { removeStyles(); dmsStop(); } catch (e) { /* ignore */ }
    if (S) { try { cancelAnimationFrame(S.raf); S.timers.forEach(clearTimeout); } catch (e) { /* ignore */ } }
    S = null; api.active = false; api._lastExit = 'error';
  }
  function watch(st) {
    var t = now();
    if (document.hidden || st.paused) { st.lastTick = t; st.progressAt = t; return; }
    if (t - st.lastTick > LOOP_MAX) { warn('the animation loop stopped, showing the page'); finishNow(st, 'watchdog'); return; }
    if (st.phase === 'scan' && t - st.t0 > 6) { warn('the scan did not finish, showing the page'); finishNow(st, 'watchdog'); return; }
    if (st.phase === 'build' && t - st.progressAt > STALL_MAX && (st.touring || st.visPending > 0)) {
      warn('no progress for ' + STALL_MAX + ' s, showing the page'); finishNow(st, 'watchdog');
    }
  }
  function progress(st) { st.progressAt = now(); }
  // test-only faults (debug): <kind>@<seconds into the build>, kind = task | stall | loop | die
  function setupFault(st, spec) {
    var m = /^(task|stall|loop|die)(?:@([\d.]+))?$/.exec(String(spec));
    if (!m) { warn('unknown fault ' + spec); return; }
    st.fault = { kind: m[1], at: m[2] ? parseFloat(m[2]) : 1, fired: false };
  }
  function fireFault(st, t) {
    var f = st.fault;
    if (!f || f.fired || st.phase !== 'build' || t - st.buildStart < f.at) return;
    if (f.kind === 'task' || f.kind === 'stall') {
      var tk = st.active.filter(function (x) { return x.it.type === 'build'; })[0];
      if (!tk) return;
      f.fired = true; f.task = { kind: tk.it.L.kind, y: tk.it.L.y };
      tk[f.kind === 'task' ? 'faultThrow' : 'faultStall'] = true;
      return;
    }
    f.fired = true;
    if (f.kind === 'loop') throw new Error('injected fault in the frame loop');
    // "die": the script stops completely, nothing is cleaned up (only the CSS dead-man switch can help)
    st.dead = true;
    cancelAnimationFrame(st.raf);
    st.timers.forEach(clearTimeout);
    if (st.mo) st.mo.disconnect();
    api.active = true;
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

    var layers = [], groups = [], instant = [], tails = [], natHidden = [];
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
      if (cs.visibility !== 'visible') { natHidden.push(el); return null; } // hidden by the page itself: leave alone
      if (parseFloat(cs.opacity) < 0.05) return null;
      if (cs.position === 'fixed' || cs.position === 'sticky') st.fixedEls.push(el);
      if (cs.position === 'sticky') st.stickyEls.push(el);
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
      if (it.tail) { tails.push({ el: el, section: sectionOf(el, R.y), b: R.y + R.h }); return; }
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
          // a row holding a phone link (or another instant / excluded element) is never a clone: it is walked,
          // so that element is shown at once instead of waiting for the clone animation
          try { if ((inSel && it.el.querySelector(inSel)) || (exSel && it.el.querySelector(exSel))) return; } catch (e) { /* ignore */ }
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

    st.layers = layers; st.groups = groups; st.instant = instant; st.tails = tails;
    tails.forEach(function (t) { st.sections[t.section].tails.push(t.el); });
    instant.forEach(function (el) { revealEl(st, el, true); });
    // elements the page hides itself keep their own visibility, also if the dead-man switch shows the page
    natHidden.forEach(function (el) { st.reveals.push({ el: el, tree: true, exempt: true }); insertReveal(st, el, true, true); });
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
    st.queue = q;
    difficulty(st, q);
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

  // Task difficulty from the area of the element (for typing: of the box typed into). Near the page average 2x the
  // area is ~1.7x the work; it is squashed (tanh) so the hardest task takes at most ~4x the easiest, and normalised
  // to an average of 1 so the whole build takes as long as before; only the split between small and big changes.
  function difficulty(st, q) {
    var k = Math.max(0, +st.o.motion.difficulty || 0), sum = 0, n = 0, ts = 0, tn = 0;
    q.forEach(function (it) { it.la = Math.log(Math.max(64, carried(it))) / Math.LN2; sum += it.la; n++; });
    var mean = n ? sum / n : 0, dsum = 0, bsum = 0;
    q.forEach(function (it) {
      var x = DIFF_EXP * k * (it.la - mean) / DIFF_SPAN, th = (Math.exp(2 * x) - 1) / (Math.exp(2 * x) + 1);
      it.df = Math.pow(2, DIFF_SPAN * (isFinite(th) ? th : x > 0 ? 1 : -1));
      // normalised with weights by the task's usual length and by its difficulty: tasks run side by side, so the
      // build time follows the long ones; this keeps the build time as before (measured, see CHANGELOG 1.2.0)
      var b = baseWork(it) * it.df;
      dsum += it.df * b; bsum += b;
    });
    var norm = bsum ? dsum / bsum : 1;
    q.forEach(function (it) {
      it.df /= norm;
      // typing time: the page average of the 1.1 timing (by letter count), so the total stays the same
      if (it.type === 'build' && (it.L.kind === 'text' || it.L.kind === 'button')) {
        var c = (it.L.el.textContent || '').length, cps = clamp(c * 0.9, 60, c > 160 ? 420 : 140);
        ts += clamp(c / cps, 0.1, 1.3); tn += it.df;
      }
    });
    st.typeBase = tn ? ts / tn : 0.5;
    var ds = q.map(function (it) { return it.df; });
    st.diff = { min: +Math.min.apply(null, ds.concat(1)).toFixed(3), max: +Math.max.apply(null, ds.concat(1)).toFixed(3), typeBase: +st.typeBase.toFixed(3) };
  }

  // rough work time of a task at 1x (s), as the phases in buildPhases / blockPhases / clonePhases set it
  function baseWork(it) {
    if (it.type === 'clone') { var n = it.g.members.length; return 0.3 + 0.42 + 0.05 * (n - 1) + 0.13 * n + 0.35; }
    var L = it.L, big = L.w * L.h > 160000, drag = big ? 0.36 : L.kind === 'icon' ? 0.16 : 0.28;
    if (it.type === 'block') return drag;
    switch (L.kind) {
      case 'text': return drag + 0.35 + (L.sub === 'heading' ? 0.28 : 0);
      case 'media': return drag + 0.34;
      case 'icon': return drag + 0.14;
      case 'button': return drag + 0.4;
      case 'line': return 0.36;
      default: return drag + 0.12;
    }
  }

  // ----------------------------------------------------------- reveal rules
  function revealEl(st, el, tree) {
    st.reveals.push({ el: el, tree: tree });
    st.revealed.add(el);
    insertReveal(st, el, tree);
  }
  function insertReveal(st, el, tree, exempt) {
    var block = st.reveal && st.reveal.sheet && st.reveal.sheet.cssRules[0];
    if (!block || !el.isConnected) return;
    var s = pathOf(el);
    try {
      block.insertRule(s + (exempt ? '{visibility:revert-layer!important}' : '{visibility:visible!important}'), block.cssRules.length);
      if (tree) block.insertRule(s + ' *{visibility:revert-layer!important}', block.cssRules.length);
    } catch (e) { /* ignore */ }
  }
  function rebuildReveals(st) {
    var block = st.reveal && st.reveal.sheet && st.reveal.sheet.cssRules[0];
    if (!block) return;
    while (block.cssRules.length) block.deleteRule(0);
    st.reveals = st.reveals.filter(function (r) { return r.el.isConnected; });
    st.reveals.forEach(function (r) { insertReveal(st, r.el, r.tree, r.exempt); });
  }

  // ------------------------------------------------- fixed elements: holes
  // The overlay never draws over position:fixed elements (and finished sticky ones): they are cut out of it.
  function holeEls(st) {
    var out = [];
    for (var i = 0; i < st.fixedEls.length; i++) {
      var el = st.fixedEls[i];
      if (!el.isConnected) continue;
      if (st.stickyEls.indexOf(el) >= 0 && !(st.revealed.has(el) && settled(st, el))) continue; // sticky: once built
      out.push(el);
    }
    return out;
  }
  function updateHoles(st, t, vw, vh) {
    if (t > (st.holeAt || 0)) { st.holeAt = t + 0.25; st.holeEls = holeEls(st); }
    var rs = [], key = '';
    for (var i = 0; i < st.holeEls.length; i++) {
      var r = st.holeEls[i].getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
      if (r.width * r.height > vw * vh * 0.5) continue; // full-screen fixed backgrounds sit behind the content
      var x = Math.floor(r.left) - 2, y = Math.floor(r.top) - 2;
      rs.push({ x: x, y: y, r: Math.ceil(r.right) + 2, b: Math.ceil(r.bottom) + 2 });
    }
    // overlapping holes are merged (even-odd filling would otherwise draw their overlap)
    for (var a = 0; a < rs.length; a++) {
      for (var b = a + 1; b < rs.length; b++) {
        var p = rs[a], q = rs[b];
        if (p.x < q.r && q.x < p.r && p.y < q.b && q.y < p.b) {
          rs[a] = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), r: Math.max(p.r, q.r), b: Math.max(p.b, q.b) };
          rs.splice(b, 1); b = a;
        }
      }
    }
    rs.forEach(function (h) { key += h.x + ',' + h.y + ',' + h.r + ',' + h.b + ';'; });
    if (key === st.holeKey) return;
    st.holeKey = key;
    st.holes = rs;
    st.deco.style.clipPath = clipFor(rs, vw, vh);
  }
  // Always a plain inset() when possible (a rectangle clip is cheap; a path / polygon clip makes the browser mask the
  // whole animated overlay every frame, which costs ~25 % fps without a GPU). Each hole is covered by the cheapest band
  // from it to a viewport edge (a corner button -> a strip along the bottom edge, etc.); the overlay is simply not drawn
  // in those strips. Only when the strips would hide more than 40 % of the screen, an even-odd path is used.
  function clipFor(rs, vw, vh) {
    if (!rs.length) return '';
    var t = 0, r = 0, b = 0, l = 0;
    rs.forEach(function (h) {
      var o = [[h.b * vw, 't'], [(vh - h.y) * vw, 'b'], [h.r * vh, 'l'], [(vw - h.x) * vh, 'r']].sort(function (p, q) { return p[0] - q[0]; })[0][1];
      if (o === 't') t = Math.max(t, h.b); else if (o === 'b') b = Math.max(b, vh - h.y);
      else if (o === 'l') l = Math.max(l, h.r); else r = Math.max(r, vw - h.x);
    });
    var kept = Math.max(0, vw - l - r) * Math.max(0, vh - t - b);
    if (kept >= vw * vh * 0.6) return 'inset(' + Math.max(0, t) + 'px ' + Math.max(0, r) + 'px ' + Math.max(0, b) + 'px ' + Math.max(0, l) + 'px)';
    var d = 'M0 0H' + vw + 'V' + vh + 'H0Z';
    rs.forEach(function (h) { d += 'M' + h.x + ' ' + h.y + 'H' + h.r + 'V' + h.b + 'H' + h.x + 'Z'; });
    return 'path(evenodd,"' + d + '")';
  }

  // ------------------------------------------------------------------- tick
  function tick(st) {
    var t = now(), dt = Math.min(0.05, t - st.last);
    st.last = t; st.lastTick = t;
    if (t - (st.beatAt || 0) > 0.4) { st.beatAt = t; dmsBeat(); }
    if (dmsFired()) { warn('the page was shown by the safety timer'); finishNow(st, 'dead-man'); return; }
    if (st.paused) return;
    if (st.fault) fireFault(st, t);
    if (st.dead) return;
    if (st.phase === 'build') { st.frames.push(dt); liteWatch(st, dt); }
    if (st.mouse && t - st.mouse.t > 0.05) { var mk2 = Math.exp(-dt * 10); st.mouse.vx *= mk2; st.mouse.vy *= mk2; }
    if (st.dirtySel) { st.dirtySel = false; rebuildReveals(st); }
    var vw = window.innerWidth, vh = window.innerHeight;
    if (st.dbg) st.dbg.frame(st, t); // reads layout before this frame's writes
    updateHoles(st, t, vw, vh);

    if (st.phase === 'scan') {
      openingStep(st, t, dt, vw, vh);
      if (t - st.t0 >= st.scanDur && st.scanned) enterBuild(st, t);
    } else if (st.phase === 'build') {
      buildStep(st, t, dt, vw, vh);
    } else if (st.phase === 'done') {
      finaleStep(st, t, dt, vw, vh);
    }
    if (S !== st) return;
    renderAgents(st, t, dt);
    var sy = window.scrollY, sx = window.scrollX;
    st.rsy = sy; // the scroll position this frame was drawn for (test measurements)
    st.world.style.transform = 'translate3d(' + (-sx) + 'px,' + (-sy) + 'px,0)';
    renderGuides(st, t, sy, sx, vw, vh);
    if (st.dbg) st.dbg.hud(st, false);
  }

  function enterBuild(st, t) {
    var vw = window.innerWidth, vh = window.innerHeight, sy = window.scrollY;
    st.phase = 'build';
    st.buildStart = t;
    progress(st);
    st.mono.classList.add('sr-out');
    // hide surplus agents (after the scan we know how many we need)
    var startN = Math.min(st.startAgents, st.agents.length);
    st.agents.forEach(function (a, i) { if (i >= startN && a.active) a.show(false); if (i < startN && !a.active) { a.show(true); a.x = vw / 2; a.y = sy + vh / 2; } });
    st.activeAgents = startN;
    // the swarms leave the focus element and wander off to where the work is; the first tasks start shortly after
    var os = st.openScale;
    st.swarms.forEach(function (sw) { sw.vx = sw.vy = 0; sw.ax = null; });
    st.agents.forEach(function (a) { a.mf = null; });
    st.mfollow = 0;
    st.dispatchAt = t + 0.2 / os;
    if (st.useRulers) st.rulersUntil = t + 1.45 / os;
    st.sectionOpen = [];
    st.tokens = Math.min(st.startAgents, 6);
    if (st.dbg) st.dbg.build(st);
  }

  function growAgents(st, n) {
    var vw = window.innerWidth, vh = window.innerHeight, sy = window.scrollY;
    n = Math.min(n, st.agents.length);
    while (st.activeAgents < n) {
      var a = st.agents[st.activeAgents++];
      a.show(true);
      a.x = vw + 30; a.y = sy + rand(vh * 0.2, vh * 0.8);
      a.vx = -rand(250, 600); a.vy = rand(-120, 120); a.px = a.x; a.py = a.y;
    }
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
    wanderSwarms(st, t, dt, vw, vh);
    var sy = window.scrollY, sx = window.scrollX, cut = sy - Math.max(40, vh * ABOVE);
    st.docH = maxScroll() + vh;
    // everything that scrolled above the view is finished at once (no animation), its agents are free again
    sweepAbove(st, cut, sy, vh);
    if (t >= st.dispatchAt) {
      // video pacing: ~9.5 layers/s in the first part, ~7 on average
      var early = st.doneLayers < st.totalLayers * 0.3 ? 1.4 : 1;
      var rate = st.rate * early * sp;
      // the visitor scrolled onto empty layers: start them right away (about 12 + 3 per empty layer per second)
      if (!st.touring && st.visManual > 0) rate = Math.max(rate, 12 + st.visManual * 3);
      st.tokens = Math.min(st.touring ? 2.5 : 3, st.tokens + rate * dt);
      if (st.touring) st.dbg.dispatch(st, t); else dispatchFollow(st, t);
    }
    for (var i = st.active.length - 1; i >= 0; i--) {
      var tk = st.active[i], bx = taskBox(tk);
      if (bx.y + bx.h < cut) { st.aboveSkips++; abortTask(st, tk, null); }
      else if (t - tk.wall0 > TASK_MAX) abortTask(st, tk, 'a task took longer than ' + TASK_MAX + ' s');
      else if (!st.touring && (bx.y >= sy + vh || bx.y + bx.h <= sy)) { st.offSkips++; abortTask(st, tk, null); } // scrolled out of view: final at once, out of sight
      else {
        // mostly out of view (the visitor scrolled on): the rest is fast-forwarded, the agent is needed in view
        if (!st.touring && !tk.warp && visPart(bx.y, bx.h, sy, vh, st.docH) < st.vmin * 0.5) tk.warp = 6;
        st.cur = tk;
        try { runTask(st, tk, t); } catch (err) { abortTask(st, tk, err); }
        st.cur = null;
        if (!st.touring && !tk.finished) keepInView(tk, sx, sy, vw, vh);
      }
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
    if (st.touring) st.dbg.camera(st, t, dt, vw, vh);
    if (st.qHead >= st.queue.length && st.active.length === 0) enterDone(st, t);
  }
  // Above the view: everything more than the band above the top edge is final at once. In the visitor modes also
  // what sits across the top edge with less than the start share in view (it can only leave the view now; building
  // it would happen mostly out of sight), and copies of a running clone task that scrolled below the view.
  function sweepAbove(st, cut, sy, vh) {
    if (sy <= 0 && st.touring) return;
    var thr = st.touring ? -1 : st.vmin, dh = st.docH;
    function gone(y, h) { return y + h < cut || (y < sy && visPart(y, h, sy, vh, dh) < thr); }
    for (var k = st.qHead; k < st.queue.length; k++) {
      var it = st.queue[k];
      if (it.state === 'done') continue;
      var b = itemBox(it);
      if (it.type !== 'clone') {
        if (it.state === 'pending' && gone(b.y, b.h)) { st.aboveSkips++; skipItem(st, it, true); }
        continue;
      }
      // clone group partly above: those copies are final at once, the rest keeps animating (or waits)
      var ms = it.g.members, left = 0, tm = !st.touring && it.task && it.task.cl ? it.task.cl.members : null;
      for (var mi = 0; mi < ms.length; mi++) {
        var m = ms[mi];
        if (!m.done && m.R && (b.y < sy && gone(m.R.y, m.R.h) || (tm && m.R.y >= sy + vh && tm.indexOf(m) >= 0))) memberAbove(st, it, m);
        if (!m.done) left++;
      }
      if (!left && it.state === 'pending') markItemDone(st, it);
    }
    for (var j = 0; j < st.tails.length; j++) { var tl = st.tails[j]; if (!tl.shown && tl.b < cut) { tl.shown = true; revealEl(st, tl.el, true); } }
    for (var o = st.outs.length - 1; o >= 0; o--) if (st.outs[o].b < cut) { rm(st.outs[o].el); st.outs.splice(o, 1); }
  }

  // ------------------------------------------- visitor-driven (scroll / fast)
  // Only what is in view is built: an element starts when at least st.vmin of it (of the viewport for taller ones)
  // is on screen, in reading order, so a tall part is built from the top down as it comes into view. Nothing is
  // built below or above the view. Scrolling onto unbuilt layers raises the pace (more task starts, more agents,
  // faster tasks), so nothing in view stays empty for long.
  function itemBox(it) {
    if (it.type !== 'clone') return { y: it.y, h: it.h };
    var g = it.g, y0 = g.master.R.y, y1 = y0 + g.master.R.h;
    for (var i = 0; i < g.members.length; i++) {
      var R = g.members[i].R;
      if (R) { if (R.y < y0) y0 = R.y; if (R.y + R.h > y1) y1 = R.y + R.h; }
    }
    return { y: y0, h: y1 - y0 };
  }
  // the box a running task works on (a clone task: the copies it makes)
  function taskBox(tk) {
    var cl = tk.cl;
    if (!cl) return itemBox(tk.it);
    var y0 = 1e15, y1 = -1e15;
    for (var i = 0; i < cl.members.length; i++) { var R = cl.members[i].R; if (!cl.members[i].done && R) { y0 = Math.min(y0, R.y); y1 = Math.max(y1, R.y + R.h); } }
    return y1 < y0 ? itemBox(tk.it) : { y: y0, h: y1 - y0 };
  }
  // share of a box in view: of its height, or of the viewport for a box taller than it (only the part of the box
  // that can be on screen at all counts, so an element cut off by the page edge is not held back)
  function visPart(y, h, sy, vh, docH) {
    var top = Math.max(y, 0), bot = Math.min(y + h, docH || 1e15);
    var v = Math.min(bot, sy + vh) - Math.max(top, sy);
    return v <= 0 ? 0 : Math.min(1, v / Math.max(1, Math.min(bot - top, vh)));
  }
  function itemVis(it, sy, vh, docH) {
    if (it.type !== 'clone') return visPart(it.y, it.h, sy, vh, docH);
    var best = 0, ms = it.g.members;
    for (var i = 0; i < ms.length; i++) if (!ms[i].done && ms[i].R) best = Math.max(best, visPart(ms[i].R.y, ms[i].R.h, sy, vh, docH));
    return best;
  }
  // what an item waits for: the frame of its layer, or the master card (and inner groups) of a clone group
  function depsOf(it) {
    var out = [];
    if (it.type === 'build' && it.L.needsBlock && !it.L.blocked && it.L.blockItem) out.push(it.L.blockItem);
    if (it.type === 'clone') {
      it.g.layers.forEach(function (L) { if (L.item && L.item.state !== 'done') out.push(L.item); });
      it.g.subgroups.forEach(function (sg) { if (sg.item && sg.item.state !== 'done') out.push(sg.item); });
    }
    return out;
  }
  // a working agent always stays on screen (a frame taller than the view is pulled from its edge)
  function keepInView(tk, sx, sy, vw, vh) {
    var list = tk.helpers.length ? tk.helpers.concat(tk.agent) : [tk.agent];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      a.x = clamp(a.x, sx + 10, sx + vw - 14); a.y = clamp(a.y, sy + 10, sy + vh - 14);
    }
  }
  function dispatchFollow(st, t) {
    var sy = window.scrollY, vh = window.innerHeight, dh = st.docH, thr = st.vmin;
    var idle = [];
    for (var i = 0; i < st.agents.length; i++) { var a = st.agents[i]; if (a.active && !a.task) idle.push(a); }
    while (st.qHead < st.queue.length && st.queue[st.qHead].state === 'done') st.qHead++;
    var stamp = (st.stamp = (st.stamp || 0) + 1), cands = [], visPend = 0, visMan = 0;
    function want(it, k) {
      if (it.state !== 'pending' || it._c === stamp) return;
      it._c = stamp;
      if (depsOk(it)) { cands.push({ it: it, k: k }); return; }
      // what it waits for is built first when it is in view as well; otherwise (mostly out of sight, e.g. the master
      // card scrolled away) it is finished at once
      depsOf(it).forEach(function (d) {
        if (d.state !== 'pending') return;
        if (itemVis(d, sy, vh, dh) >= thr) want(d, k - 0.5);
        else { st.depSkips++; skipItem(st, d, true); }
      });
    }
    for (var k = st.qHead; k < st.queue.length; k++) {
      var it = st.queue[k];
      if (it.state !== 'pending') continue;
      var b = itemBox(it);
      if (b.y >= sy + vh || b.y + b.h <= sy) continue;
      if (itemVis(it, sy, vh, dh) < thr) continue; // not enough of it in view yet
      if (it.type !== 'block') { visPend++; if (it.seen && it.seen.cat === 'manual') visMan++; }
      want(it, k);
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
    cands.sort(function (p, q) { return p.k - q.k; });
    var boost = clamp(visMan / 6, 1, 3); // and build them faster
    for (var c = 0; c < cands.length && idle.length; c++) {
      var it2 = cands[c].it;
      if (it2.state !== 'pending') continue;
      if (it2.type !== 'block') { if (st.tokens < 1) break; st.tokens -= 1; }
      openSection(st, it2.section);
      var tx = it2.L ? it2.L.x : it2.g.master.R.x, best = 0, bd = 1e15;
      for (var j = 0; j < idle.length; j++) {
        var d = Math.pow(idle[j].x - tx, 2) + Math.pow(idle[j].y - it2.y, 2);
        if (d < bd) { bd = d; best = j; }
      }
      var ag = idle.splice(best, 1)[0];
      // an agent far off screen enters from the nearest edge (shortest way in)
      if (ag.y < sy - 80 || ag.y > sy + vh + 80) { ag.y = ag.py = ag.y < sy ? sy - 30 : sy + vh + 30; ag.vy = 0; ag.hist.length = 0; }
      var ahead = (itemBox(it2).y - (sy + vh)) / vh;
      if (ahead > st.maxAhead) st.maxAhead = ahead;
      startTask(st, it2, ag, t, idle, boost);
      if (it2.task) noteStart(st, it2.task, sy, vh);
    }
  }
  // measurement: how much of each part was in view when its animation started
  function noteStart(st, tk, sy, vh) {
    var it = tk.it, f;
    if (tk.cl) { f = 1; tk.cl.members.forEach(function (m) { if (m.R) f = Math.min(f, visPart(m.R.y, m.R.h, sy, vh, st.docH)); }); }
    else f = visPart(it.y, it.h, sy, vh, st.docH);
    var sv = st.startVis;
    sv.n++; sv.sum += f; if (f < sv.min) sv.min = f;
    if (st.mlog) { st.mlog.starts.push({ type: it.type, kind: it.L ? it.L.kind : 'clone', vis: +f.toFixed(3), h: Math.round(it.h) }); if (st.mlog.starts.length > 1500) st.mlog.starts.shift(); }
  }
  function openSection(st, s) {
    if (st.sectionOpen[s]) return;
    st.sectionOpen[s] = true;
    growAgents(st, st.startAgents + Math.round((st.maxAgents - st.startAgents) * (st.nSections > 1 ? s / (st.nSections - 1) : 1)));
  }
  // finish an item without animation (only for items out of sight)
  function skipItem(st, it, atOnce) {
    if (it.state === 'done') return;
    if (it.type === 'block') { it.L.needsBlock = false; }
    else if (it.type === 'build') {
      var L = it.L;
      if (L.ph) { L.ph.remove(); L.ph = null; }
      if (L.sel) { if (atOnce) L.sel.kill(); else L.sel.out(); L.sel = null; }
      L.blocked = false;
      if (L.blockItem && L.blockItem.state === 'pending') { L.needsBlock = false; markItemDone(st, L.blockItem); }
      revealEl(st, L.el, L.tree);
      L.state = 'done';
      countDone(st, 1, it.section);
    } else {
      it.g.members.forEach(function (m) { memberDone(st, it.g, m); });
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
    left.forEach(function (it) { skipItem(st, it, true); });
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
    progress(st);
    var s = st.sections[it.section];
    if (s) s.itemsDone++;
  }
  function countDone(st, n, section) {
    st.doneLayers = Math.min(st.totalLayers, st.doneLayers + n);
    progress(st);
    var s = st.sections[section];
    if (s) s.done += n;
  }
  function release(st, a) {
    if (!a || !a.task) return;
    a.task = null;
    a.setMode('arrow');
  }

  // ------------------------------------------------------------------ tasks
  function runTask(st, tk, t0) {
    if (tk.faultThrow) throw new Error('injected fault in a task');
    if (tk.faultStall) return; // never progresses: the task watchdog has to step in
    // task-local clock: runs faster (warp) when the visitor scrolled away from the task
    tk.clock = tk.clock == null ? t0 : tk.clock + (t0 - tk.lastT) * (tk.warp || 1);
    tk.lastT = t0;
    var t = tk.clock, guard = 0;
    while (guard++ < 12) {
      var ph = tk.phases[tk.pi];
      if (!ph) {
        tk.finished = true;
        if (st.mlog && tk.w0 != null) logTask(st, tk, t);
        return;
      }
      if (!tk.pStarted) { tk.pStarted = true; tk.pt0 = tk.pt0 || t; if (ph.start) ph.start(tk, t); }
      var p = ph.d > 0 ? (t - tk.pt0) / ph.d : 1;
      if (p < 1) { if (ph.tick) ph.tick(tk, Math.max(0, p), t); return; }
      if (ph.tick) ph.tick(tk, 1, t);
      if (ph.end) ph.end(tk, t);
      tk.pi++; tk.pStarted = false; tk.pt0 = tk.pt0 + Math.max(0, ph.d);
      if (tk.pt0 < t - 0.25) tk.pt0 = t; // never fast-forward through more than a short hitch
      if (tk.pi === 1) tk.w0 = tk.pt0;   // the way there is over, the work starts
    }
  }
  // test measurements (debug only): the path of every move, and how long each task's work took
  function motionRec(st, k, x0, y0, x1, y1, area, sag, v0) {
    var r = { k: k, x0: x0, y0: y0, dx: x1 - x0, dy: y1 - y0, w: +clamp(Math.sqrt(Math.max(0, area)) / ARC_REF, ARC_MIN, 1).toFixed(3), sag: +sag.toFixed(1), v0: Math.round(v0), devY: 0, devMax: 0, done: false };
    st.mlog.moves.push(r);
    if (st.mlog.moves.length > 600) st.mlog.moves.shift();
    return r;
  }
  function motionPt(r, x, y, p) {
    var px = x - r.x0, py = y - r.y0, d2 = r.dx * r.dx + r.dy * r.dy;
    if (d2 < 1) return;
    var u = (px * r.dx + py * r.dy) / d2, ox = px - u * r.dx, oy = py - u * r.dy;
    if (oy > r.devY) r.devY = +oy.toFixed(1);
    var m = Math.hypot(ox, oy);
    if (m > r.devMax) r.devMax = +m.toFixed(1);
    if (p >= 1) r.done = true;
  }
  function logTask(st, tk, t) {
    var it = tk.it;
    st.mlog.tasks.push({ type: it.type, kind: it.L ? it.L.kind + (tk.blk ? ' (frame drawn before)' : '') : 'clone', area: Math.round(carried(it)), df: +tk.df.toFixed(3), work: +((t - tk.w0) * tk.mv).toFixed(3), warp: !!tk.warp });
    if (st.mlog.tasks.length > 1500) st.mlog.tasks.shift();
  }
  function startTask(st, it, a, t, idle, boost) {
    // measurement: time from "came into view empty" to "work started" (a clone group starts with its first item)
    var chain = [it], g0 = it.type === 'clone' ? it.g.parent : it.L && it.L.grp;
    while (g0) { chain.push(g0.item); g0 = g0.parent; }
    chain.forEach(function (x) {
      if (x && x.seen && x.seen.cat === 'manual' && x.seen.state === 'pending' && !x.waited) { x.waited = true; st.waits.push(t - x.seen.t); }
    });
    var sp = st.speedBase * st.mult * (boost || 1);
    var tk = { it: it, agent: a, pi: 0, pStarted: false, pt0: 0, sp: sp, mv: Math.pow(sp, 0.7), guide: null, helpers: [], bag: [], wall0: t };
    // the work itself (not the way there) takes longer the harder the task is
    tk.df = it.df || 1; tk.mw = tk.mv / tk.df; tk.sw = sp / tk.df; tk.blk = !!(it.L && it.L.blocked);
    try {
      if (it.type === 'block') tk.phases = blockPhases(st, tk, it.L);
      else if (it.type === 'clone') { tk.phases = clonePhases(st, tk, it.g, idle); }
      else tk.phases = buildPhases(st, tk, it.L);
    } catch (err) {
      st.errors++; warn('a task could not start, showing that part', err);
      tk.helpers.forEach(function (h) { h.task = null; });
      skipItem(st, it, true);
      return;
    }
    it.state = 'active';
    it.task = tk;
    a.task = tk;
    st.active.push(tk);
    if (it.L) it.L.state = 'active';
    progress(st);
  }
  // Gravity: the agent carries its element, so a horizontal move bends downwards; the heavier the element and the
  // more horizontal the move, the more (a vertical move hardly bends). Returns the sag in px at the middle.
  function sagFor(st, dx, dy, area) {
    var k = +st.o.motion.arc || 0, adx = Math.abs(dx), dist = Math.hypot(dx, dy);
    if (!k || dist < 8) return 0;
    var hz = adx / dist, wgt = clamp(Math.sqrt(Math.max(0, area)) / ARC_REF, ARC_MIN, 1);
    return Math.min(ARC_K * k * adx * wgt * hz * hz, ARC_CAP * k, adx * 0.2);
  }
  function carried(it) { return it.L ? it.L.w * it.L.h : it.g ? it.g.master.R.w * it.g.master.R.h : 0; }
  // the way to a task: a curve that starts with the agent's current velocity (no sudden stop or turn), ends at
  // rest, and sags with the weight of the element (cubic Hermite + a quadratic sag)
  function travel(st, tk, x, y, mode) {
    return {
      d: 0,
      start: function () {
        var a = tk.agent, dx = x - a.x, dy = y - a.y, dist = Math.hypot(dx, dy);
        tk.fx = a.x; tk.fy = a.y;
        var D = this.d = clamp(0.1 + dist / 1900, 0.14, 0.62) / tk.mv;
        var mx = (a.vx || 0) * D, my = (a.vy || 0) * D, mm = Math.hypot(mx, my), lim = Math.min(160, dist * 0.5 + 30);
        if (mm > lim) { mx *= lim / mm; my *= lim / mm; }
        tk.m0x = mx; tk.m0y = my;
        tk.sag = sagFor(st, dx, dy, carried(tk.it));
        if (st.mlog) tk.mv0 = motionRec(st, 'travel', tk.fx, tk.fy, x, y, carried(tk.it), tk.sag, mm);
        a.setMode(mode || 'arrow');
      },
      tick: function (tk2, p) {
        var a = tk.agent, p2 = p * p, p3 = p2 * p, h01 = 3 * p2 - 2 * p3, h10 = p3 - 2 * p2 + p;
        a.x = tk.fx + (x - tk.fx) * h01 + tk.m0x * h10;
        a.y = tk.fy + (y - tk.fy) * h01 + tk.m0y * h10 + 4 * tk.sag * h01 * (1 - h01);
        if (tk.mv0) motionPt(tk.mv0, a.x, a.y, p);
      }
    };
  }
  function drag(st, tk, L, withPh, scale) {
    var s = scale || 1;
    return {
      d: (L.w * L.h > 160000 ? 0.36 : L.kind === 'icon' ? 0.16 : 0.28) / tk.mw,
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
        if (tk.proxy) { tk.proxy.kill(); tk.proxy = null; }
        if (tk.ph) { tk.ph.remove(); tk.ph = null; }
        if (tk.sel) { tk.sel.out(); tk.sel = null; }
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
        // how long typing takes depends on the size of the box (the task's difficulty), not on the letters
        this.d = st.typeBase / tk.sw;
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
        d: 0.1 / tk.mw,
        start: function () {
          tk.sel = L.sel || new Sel(st); L.sel = null;
          tk.sel.set(L.x, L.y, L.w, L.h); tk.guide = L; tk.ph = L.ph || (k !== 'text' ? new Ph(st, k === 'media' || k === 'icon') : null); L.ph = null;
          if (tk.ph) tk.ph.set(L.x, L.y, L.w, L.h);
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
      if (L.blocked && heading) ph.push({ d: 0.12 / tk.mw, tick: function (tk2, p) { var sc = lerp(1, s, easeInOut(p)); tk.sel.set(L.x, L.y, L.w * sc, L.h * sc); } });
      else if (!L.blocked) ph.push(drag(st, tk, L, false, s));
      ph.push(typePhase(st, tk, L, s, false));
      if (heading) {
        ph.push({
          d: 0.28 / tk.mw,
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
        d: (k === 'icon' ? 0.14 : 0.34) / tk.mw,
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
        d: 0.12 / tk.mw,
        start: function () { revealEl(st, L.el, L.tree); tk.ph.el.classList.add('sr-fade'); },
        tick: function (tk2, p) { tk.ph.el.style.opacity = String(1 - p); }
      });
      ph.push(settleText(st, tk, L));
    } else if (k === 'button') {
      if (!L.blocked) ph.push(drag(st, tk, L, true));
      ph.push({ d: 0.05 / tk.mw });              // placeholder -> final colour

      ph.push(typePhase(st, tk, L, 1, true));
      ph.push(settleText(st, tk, L));
    } else if (k === 'line') {
      ph.push({
        d: 0.36 / tk.mw,
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
          tk.line.classList.add('sr-out'); tk.dot.classList.add('sr-out');
          fading(st, tk.line, L.y + L.h + 8, 520); fading(st, tk.dot, L.y + L.h + 8, 520);
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
          if (L.state === 'done') { if (tk.ph) tk.ph.remove(); if (tk.sel) tk.sel.kill(); } // finished meanwhile (out of sight)
          else { L.ph = tk.ph; L.blocked = true; L.sel = tk.sel; }
          tk.ph = null; tk.sel = null; tk.guide = null;
          markItemDone(st, tk.it);
          release(st, tk.agent);
        }
      }
    ];
  }
  function clonePhases(st, tk, g, idle) {
    var M = g.master.R, members = g.members.filter(function (m) { return !m.done; });
    if (!st.touring) {
      // visitor modes: only the copies that are in view now; the others wait until they are
      var sy = window.scrollY, vh = window.innerHeight;
      var inv = members.filter(function (m) { return m.R && visPart(m.R.y, m.R.h, sy, vh, st.docH) >= st.vmin; });
      if (inv.length) members = inv;
    }
    var n = members.length;
    var copies = [], sels = [], lines = [];
    tk.cl = { members: members, copies: copies, sels: sels, lines: lines };
    var slideD = (0.42 + 0.05 * (n - 1)) / tk.mw;
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
        d: 0.16 / tk.mw,
        start: function () {
          tk.sel = new Sel(st, true);
          tk.sel.set(M.x, M.y, M.w, M.h);
          tk.agent.setMode('arrow');
          members.forEach(function (m) {
            var c = makeProxy(st, g.master.el, M, false);
            c.el.classList.add('sr-clone');
            copies.push(c);
            if (m.done) rm(c.el);
            var ln = mk('div', 'sr-rline', st.world);
            var dx = m.R.x - M.x, dy = m.R.y - M.y, len = Math.hypot(dx, dy);
            var ys = M.y + M.h + 8;
            ln.style.transform = 'translate3d(' + (M.x + M.w / 2) + 'px,' + ys + 'px,0) rotate(' + Math.atan2(dy, dx) + 'rad)';
            ln.style.width = len + 'px';
            var lab = mk('span', 'sr-rlabel', st.world);
            lab.textContent = Math.round(len);
            lab.style.transform = 'translate3d(' + (m.R.x + m.R.w / 2) + 'px,' + (m.R.y + m.R.h + 8) + 'px,0) translate(-50%,-50%)';
            lines.push([ln, lab]);
            if (m.done) { rm(ln); rm(lab); }
          });
        }
      },
      {
        d: slideD,
        start: function () {
          tk.sel.out(); tk.sel = null;
          tk.cl.sag = members.map(function (m) { return sagFor(st, m.R.x - M.x, m.R.y - M.y, m.R.w * m.R.h); });
          if (st.mlog) tk.cl.rec = members.map(function (m, i) { return motionRec(st, 'carry', M.x, M.y, m.R.x, m.R.y, m.R.w * m.R.h, tk.cl.sag[i], 0); });
        },
        tick: function (tk2, p) {
          var T = p * slideD * tk.mw;
          members.forEach(function (m, i) {
            if (m.done) return;
            var q = clamp((T - i * 0.05) / 0.42, 0, 1), e = easeInOut(q), sg = 4 * tk.cl.sag[i];
            var x = lerp(M.x, m.R.x, e), y = lerp(M.y, m.R.y, e) + sg * e * (1 - e);
            if (tk.cl.rec) motionPt(tk.cl.rec[i], x, y, q);
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
              gs.transform = 'translate3d(' + lerp(M.x, m.R.x, ee) + 'px,' + (lerp(M.y, m.R.y, ee) + sg * ee * (1 - ee)) + 'px,0)';
              gs.width = M.w + 'px'; gs.height = M.h + 'px';
              gs.opacity = q > 0 && q < 1 ? String(0.45 - k * 0.2) : '0';
            }
            var carrier = i === n - 1 ? tk.agent : tk.helpers[i];
            if (carrier) { carrier.x = x; carrier.y = y; carrier.setMode('arrow'); }
          });
        },
        end: function () {
          copies.forEach(function (c) { if (c.gh) c.gh.forEach(rm); c.el.style.filter = ''; });
          var gy = itemBox(tk.it);
          lines.forEach(function (pair) { pair.forEach(function (l) { l.classList.add('sr-out'); fading(st, l, gy.y + gy.h + 16, 300); }); });
        }
      },
      {
        d: 0.14 / tk.mw,
        start: function () {
          members.forEach(function (m) { var s = null; if (!m.done) { s = new Sel(st); s.set(m.R.x, m.R.y, m.R.w, m.R.h); } sels.push(s); });
          tk.helpers.forEach(function (h) { release(st, h); });
          tk.helpers = [];
        }
      },
      {
        d: rwTotal / tk.mw,
        start: function () { tk.mp = []; tk.agent.setMode('ibeam'); },
        tick: function (tk2, p) {
          var T = p * rwTotal;
          members.forEach(function (m, i) {
            var r = rw[i], q = (T - r.s) / r.d;
            if (q <= 0 || tk.mp[i] === 'done' || m.done) return;
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
              mpx.kill(); rm(copies[i].el);
              if (sels[i]) sels[i].out();
              tk.mp[i] = 'done';
              memberDone(st, g, m);
            }
          });
        },
        end: function () {
          cloneDone(st, tk.it);
          release(st, tk.agent);
        }
      }
    ];
  }
  // a clone task made its copies: the group is done, or waits for its other copies to come into view
  function cloneDone(st, it) {
    if (it.state === 'done') return;
    if (it.g.members.every(function (m) { return m.done; })) markItemDone(st, it);
    else { it.state = 'pending'; it.task = null; progress(st); }
  }
  // Complete a running task immediately: its part of the page becomes final.
  function completeTask(st, tk) {
    var it = tk.it;
    if (it.type === 'clone') {
      (tk.cl ? tk.cl.members : it.g.members).forEach(function (m) { memberDone(st, it.g, m); });
    } else if (it.type === 'build') {
      revealEl(st, it.L.el, it.L.tree);
      it.L.state = 'done';
    } else if (it.type === 'block') {
      it.L.needsBlock = false; // the frame was not finished: its build task draws it from scratch
    }
    if (it.state !== 'done') {
      if (it.type === 'build') countDone(st, 1, it.section);
      if (it.type === 'clone') cloneDone(st, it); else markItemDone(st, it);
    }
    release(st, tk.agent);
    tk.helpers.forEach(function (h) { release(st, h); });
    tk.finished = true;
  }
  // one copy of a clone group is final: shown, counted once
  function memberDone(st, g, m) {
    if (m.done) return;
    m.done = true;
    revealEl(st, m.el, true);
    countDone(st, g.count, g.section);
  }
  // a member scrolled above the view: final at once; the copy flying to it (if any) is removed
  function memberAbove(st, it, m) {
    if (m.done) return;
    memberDone(st, it.g, m);
    st.aboveSkips++;
    var tk = it.task, cl = tk && tk.cl, i = cl ? cl.members.indexOf(m) : -1;
    if (i < 0) return;
    if (cl.copies[i]) { rm(cl.copies[i].el); if (cl.copies[i].gh) cl.copies[i].gh.forEach(rm); }
    if (cl.sels[i]) cl.sels[i].kill();
    if (cl.lines[i]) cl.lines[i].forEach(rm);
    if (tk.mp && tk.mp[i] && tk.mp[i] !== 'done') { tk.mp[i].kill(); tk.mp[i] = 'done'; }
  }
  // a failed, stuck or out-of-sight task: its part is shown in its final state, its overlay pieces removed
  function abortTask(st, tk, why) {
    if (why) { st.aborts++; warn('showing one part without animation: ' + (why.message || why), typeof why === 'object' ? why : ''); }
    completeTask(st, tk);
    (tk.bag || []).forEach(rm);
    if (tk.sel) tk.sel.kill();
    if (tk.ph) tk.ph.remove();
    if (tk.proxy) rm(tk.proxy.el);
    if (tk.cl) tk.cl.sels.forEach(function (s) { if (s) s.kill(); });
    var L = tk.it.L;
    if (L && tk.it.type === 'build') { if (L.ph) { L.ph.remove(); L.ph = null; } if (L.sel) { L.sel.kill(); L.sel = null; } }
    if (tk.agent.task === tk) release(st, tk.agent);
  }

  // ----------------------------------------------------------------- camera
  function maxScroll() {
    var se = document.scrollingElement || document.documentElement;
    return Math.max(0, se.scrollHeight - window.innerHeight);
  }

  // ---------------------------------------------------------------- agents
  // ---------------------------------------------------------------- motion
  // Free agents (opening, waiting for work, finale) are moved by damped springs towards targets that drift, so
  // they speed up and slow down by themselves and never run on a perfect circle. They fly in a few swarms of
  // different sizes. Agents at work follow their task's path (with a gravity sag, see travel()).
  function hoverMouse() { try { return window.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) { return false; } }
  // a damped spring pulls o (x, y, vx, vy) towards (tx, ty); w = stiffness (rad/s), z = damping ratio (< 1 overshoots)
  function springTo(o, tx, ty, dt, w, z, vmax) {
    var n = dt > 0.017 ? Math.ceil(dt / 0.017) : 1, h = dt / n, w2 = w * w, c = 2 * z * w;
    for (var i = 0; i < n; i++) {
      o.vx += ((tx - o.x) * w2 - o.vx * c) * h;
      o.vy += ((ty - o.y) * w2 - o.vy * c) * h;
      var v = Math.hypot(o.vx, o.vy);
      if (v > vmax) { o.vx *= vmax / v; o.vy *= vmax / v; }
      o.x += o.vx * h; o.y += o.vy * h;
    }
  }
  function makeSwarms(st) {
    var k = !st.o.motion.swarms ? 1 : st.lite ? 2 : st.agents.length >= 14 ? 4 : 3;
    st.swarms = [];
    for (var i = 0; i < k; i++) {
      st.swarms.push({
        // sizes: clearly different (about k : k-1 : ... : 1, with some chance)
        w: k === 1 ? 1 : Math.pow(k - i, 1.2) + rand(-0.2, 0.3), n: 0, th: (i / k) * Math.PI * 2 + rand(-0.5, 0.5),
        sp: rand(0.7, 1.3), rf: k === 1 ? 1 : 0.78 + 0.44 * i / (k - 1) + rand(-0.05, 0.05), fx: rand(0.85, 1.15), fy: rand(0.85, 1.15), n1: rand(0, 6.28), n2: rand(0, 6.28), n3: rand(0, 6.28),
        x: 0, y: 0, vx: 0, vy: 0, ax: null, ay: 0, next: 0
      });
    }
    st.agents.forEach(function (a) { joinSwarm(st, a); });
  }
  // weighted round robin: the first n agents are spread over the swarms in proportion at every n
  function joinSwarm(st, a) {
    var best = st.swarms[0], bv = 1e9;
    st.swarms.forEach(function (s) { var v = (s.n + 1) / s.w; if (v < bv) { bv = v; best = s; } });
    best.n++;
    a.swarm = best;
    a.oR = rand(8, 14 + 7 * Math.sqrt(best.n)); a.oA = rand(0, 6.28); a.oW = rand(-0.8, 0.8);
    a.kf = rand(0.8, 1.2);                       // own stiffness: some lag behind, some lead
    a.T0 = rand(1.3, 2);                         // how long it stays curious about the mouse pointer
    a.keep = rand(44, 60); a.mdir = Math.random() < 0.5 ? -1 : 1; a.mcool = 0; a.mf = null;
  }
  // the agent's place in its swarm
  // (calm: while waiting for work the swarm settles where it is, so resting agents need no repaint)
  function slot(a, t, calm) {
    var s = a.swarm, ang = a.oA + (calm ? 0 : t * a.oW), wb = calm ? 0 : 1;
    return [s.x + Math.cos(ang) * a.oR + Math.sin(t * 1.7 + a.wob) * 5 * wb, s.y + Math.sin(ang) * a.oR * 0.8 + Math.cos(t * 1.3 + a.wob) * 4 * wb];
  }
  // swarms circling an orbit (an ellipse around the focus element) at their own, varying pace and distance
  function orbitSwarms(st, O, t, dt, w) {
    for (var i = 0; i < st.swarms.length; i++) {
      var s = st.swarms[i];
      s.th += dt * w * s.sp * (1 + 0.35 * Math.sin(t * 0.7 + s.n3));
      var br = s.rf * (1 + 0.12 * Math.sin(t * 0.9 + s.n1) + 0.07 * Math.sin(t * 2.3 + s.n2));
      s.x = O.x + Math.cos(s.th) * O.rx * br * s.fx;
      s.y = O.y + Math.sin(s.th) * O.ry * br * s.fy;
    }
  }
  // while the page is built: idle swarms glide between spots in view (mostly on the right), following the scroll
  function wanderSwarms(st, t, dt, vw, vh) {
    var sy = window.scrollY, sx = window.scrollX;
    for (var i = 0; i < st.swarms.length; i++) {
      var s = st.swarms[i];
      if (s.ax == null || t > s.next) { s.next = t + rand(2.5, 5); s.ax = Math.random() < 0.65 ? rand(0.58, 0.92) : rand(0.08, 0.92); s.ay = rand(0.15, 0.8); }
      if (s.y < sy - vh * 0.6 || s.y > sy + vh * 1.6) { s.y = s.y < sy ? sy - 40 : sy + vh + 40; s.vy = 0; }
      springTo(s, sx + s.ax * vw, sy + s.ay * vh, dt, 1.7, 0.9, 900);
    }
  }
  function openingStep(st, t, dt, vw, vh) {
    var sy = window.scrollY;
    if (!st.openO || t > st.openAt) {
      st.openAt = t + 0.5;
      var F = focusAt(st, sy);
      st.openO = orbitOf(st, F, sy);
      st.focusInfo.open = focusLabel(F);
    }
    orbitSwarms(st, st.openO, t, dt, 1.5);
    for (var i = 0; i < st.agents.length; i++) {
      var a = st.agents[i];
      if (!a.active) continue;
      var p = slot(a, t);
      freeStep(st, a, t, dt, p[0], p[1], 5.5 * a.kf, 0.72, 1800);
      a.setMode('arrow');
    }
  }
  function idleStep(st, a, t, dt, vw, vh) {
    var sy = window.scrollY;
    if (a.y < sy - vh * 1.5 || a.y > sy + vh * 2.5) { a.y = a.py = a.y < sy ? sy - 30 : sy + vh + 30; a.vy *= 0.3; a.hist.length = 0; }
    var p = slot(a, t, true);
    freeStep(st, a, t, dt, p[0], p[1], 3.6 * a.kf, 0.8, 1500);
    if (Math.abs(a.vx) + Math.abs(a.vy) < 4 && Math.abs(p[0] - a.x) + Math.abs(p[1] - a.y) < 1) { a.vx = a.vy = 0; a.x = p[0]; a.y = p[1]; } // at rest
    a.setMode('arrow');
  }
  function freeStep(st, a, t, dt, tx, ty, w, z, vmax) {
    var M = st.mouseOn && st.phase !== 'build' ? mousePos(st, t) : null;
    if (M) {
      var tg = mouseSteer(st, a, t, dt, M, tx, ty);
      if (a.mf) { tx = tg[0]; ty = tg[1]; w = Math.max(w, 6 * a.kf); z = 0.7; vmax = Math.max(vmax, 1400); }
    }
    springTo(a, tx, ty, dt, w, z, vmax);
    a.tgx = tx; a.tgy = ty;
    if (M) keepAway(st, a, M);
    a.phys = true;
  }
  // simpler motion when the frame rate stays low (weak device): one trail ghost, no mouse play
  function liteWatch(st, dt) {
    if (st.liteFps || st.o.motion.lite !== 'auto') return;
    var fw = st.fpsWin || (st.fpsWin = { n: 0, s: 0, low: 0 });
    fw.n++; fw.s += dt;
    if (fw.n < 60) return;
    fw.low = fw.n / fw.s < 38 ? fw.low + 1 : 0;
    fw.n = 0; fw.s = 0;
    if (fw.low >= 2) { st.lite = st.liteFps = true; st.mouseOn = false; }
  }

  // --------------------------------------------------------- focus element
  function focusCands(o) {
    var out = [], seen = [];
    function add(list, src) {
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (el && el.nodeType === 1 && seen.indexOf(el) < 0) { seen.push(el); out.push({ el: el, src: src }); }
      }
    }
    function q(sel) { try { return document.querySelectorAll(sel); } catch (e) { warn('focus: invalid selector ' + sel); return []; } }
    var f = o.focus;
    if (f && typeof f === 'string') add(q(f), 'config'); else if (f && f.nodeType === 1) add([f], 'config');
    add(q('[data-swarm-focus]'), 'config');
    add(q('h1'), 'auto');
    add(q('a[class*="btn"],a[class*="button"],a[class*="cta"],button[class*="btn"],button[class*="button"],button[class*="primary"],[class*="cta"],button[type="submit"]'), 'auto');
    add(q('[class*="logo"],[id*="logo"]'), 'auto');
    return out;
  }
  // the first candidate that is (at least half) in view at scroll position top; else the largest picture; else
  // a spot in the view
  function focusAt(st, top) {
    var vw = window.innerWidth, vh = window.innerHeight, sx = window.scrollX, sy = window.scrollY;
    for (var i = 0; i < st.focusCands.length; i++) {
      var c = st.focusCands[i];
      if (!c.el.isConnected) continue;
      var r = c.el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.right < 0 || r.left > vw) continue;
      var y = r.top + sy, vis = Math.min(y + r.height, top + vh) - Math.max(y, top);
      if (vis < Math.min(r.height * 0.5, vh * 0.3)) continue;
      return { x: r.left + sx + r.width / 2, y: y + r.height / 2, w: r.width, h: r.height, src: c.src, el: c.el };
    }
    var best = null, ba = 0;
    st.layers.forEach(function (L) { if (L.kind === 'media' && L.y < top + vh && L.y + L.h > top && L.w * L.h > ba) { ba = L.w * L.h; best = L; } });
    if (best) return { x: best.x + best.w / 2, y: best.y + best.h / 2, w: best.w, h: best.h, src: 'media', el: best.el };
    return { x: sx + vw * 0.6, y: top + vh * 0.48, w: Math.min(vw * 0.3, 360), h: Math.min(vh * 0.2, 200), src: 'view', el: null };
  }
  // the orbit around it: an ellipse just outside the element, kept mostly on screen
  function orbitOf(st, F, top) {
    var vw = window.innerWidth, vh = window.innerHeight, sx = window.scrollX;
    var rx = clamp(F.w / 2 + 46, 70, vw * 0.42), ry = clamp(F.h / 2 + 38, 55, vh * 0.36);
    var mx = Math.min(rx * 0.7, vw / 2), my = Math.min(ry * 0.7, vh / 2);
    return { x: clamp(F.x, sx + mx, sx + vw - mx), y: clamp(F.y, top + my, top + vh - my), rx: rx, ry: ry };
  }
  function focusLabel(F) {
    var e = F.el, d = e ? e.localName + (e.id ? '#' + e.id : e.classList && e.classList[0] ? '.' + e.classList[0] : '') : null;
    return { src: F.src, el: d, x: Math.round(F.x), y: Math.round(F.y), w: Math.round(F.w), h: Math.round(F.h) };
  }

  // ---------------------------------------------------------- mouse pointer
  function mousePos(st, t) {
    var m = st.mouse;
    if (!m || m.out) return null;
    return { x: m.cx + window.scrollX, y: m.cy + window.scrollY, vx: m.vx, vy: m.vy, fresh: t - m.t < 4 };
  }
  // An agent near the pointer moves out of its way (harder when the pointer comes fast). Up to three curious
  // agents then follow it on a small circle for a moment; the faster the pointer moves away from one, the
  // sooner it gives up. They never come closer than MOUSE_MIN (see keepAway).
  function mouseSteer(st, a, t, dt, M, tx, ty) {
    var dx = a.x - M.x, dy = a.y - M.y, d = Math.hypot(dx, dy) || 0.01, ux = dx / d, uy = dy / d;
    var vTo = M.vx * ux + M.vy * uy, mz = st.mz;    // > 0: the pointer comes towards the agent
    var R = a.mf ? a.keep * 0.8 : 78 + a.kf * 20;
    if (d < R) {
      var push = (R - d) / R, acc = push * push * 5200 + Math.max(0, vTo) * push * 6;
      a.vx += ux * acc * dt; a.vy += uy * acc * dt;
      if (!a.mdodge && !a.mf && vTo > 60) { a.mdodge = true; mz.dodges++; }
    } else if (d > R * 1.6) a.mdodge = false;
    if (!a.mf && t > a.mcool && M.fresh && d < 130 + a.kf * 30 && st.mfollow < 3) {
      a.mf = { t0: t, int: 1, ph: Math.atan2(dy, dx), away: 0, n: 0, amax: 0 };
      st.mfollow++;
    }
    if (!a.mf) return null;
    var f = a.mf, va = Math.max(0, -vTo);
    f.int -= dt * (1 + va / 220) / a.T0;
    if (va > 20) { f.away += va; f.n++; f.amax = Math.max(f.amax, va); }
    if (f.int <= 0 || d > 320) {
      mz.follows.push({ dur: +(t - f.t0).toFixed(3), away: f.n ? Math.round(f.away / f.n) : 0, max: Math.round(f.amax) });
      if (mz.follows.length > 60) mz.follows.shift();
      a.mf = null; st.mfollow--; a.mcool = t + rand(1.2, 2.2);
      return null;
    }
    f.ph += a.mdir * 2.6 * dt;
    return [M.x + Math.cos(f.ph) * a.keep, M.y + Math.sin(f.ph) * a.keep];
  }
  function keepAway(st, a, M) {
    var dx = a.x - M.x, dy = a.y - M.y, d = Math.hypot(dx, dy);
    if (d < MOUSE_MIN) {
      var ux = d > 0.01 ? dx / d : 0, uy = d > 0.01 ? dy / d : -1, vin = a.vx * ux + a.vy * uy;
      a.x = M.x + ux * MOUSE_MIN; a.y = M.y + uy * MOUSE_MIN;
      if (vin < 0) { a.vx -= vin * ux; a.vy -= vin * uy; }
      d = MOUSE_MIN;
    }
    if (st.mz.minD == null || d < st.mz.minD) st.mz.minD = Math.round(d * 10) / 10;
  }

  function renderAgents(st, t, dt) {
    var vw = window.innerWidth, vh = window.innerHeight, sy = window.scrollY, sx = window.scrollX;
    var gn = st.liteFps ? 1 : 3;
    for (var i = 0; i < st.agents.length; i++) {
      var a = st.agents[i];
      if (!a.active) continue;
      if (st.phase === 'build' && !a.task) idleStep(st, a, t, dt, vw, vh);
      // agents moved by a task: their velocity is measured, so they glide on when the task lets them go
      if (!a.phys && dt > 0 && a.px != null) { var kv = Math.min(1, dt * 20); a.vx = lerp(a.vx, (a.x - a.px) / dt, kv); a.vy = lerp(a.vy, (a.y - a.py) / dt, kv); }
      a.phys = false; a.px = a.x; a.py = a.y;
      var x = a.x - sx, y = a.y - sy;
      var hh = a.hist;
      hh.unshift(x, y);
      if (hh.length > 16) hh.length = 16;
      var mx = hh.length >= 6 ? x - hh[4] : 0, my = hh.length >= 6 ? y - hh[5] : 0;
      var spd = Math.hypot(mx, my);
      var target = 0;
      if (a.mode === 'arrow' && spd > 7) target = Math.atan2(my, mx) + Math.PI * 0.75;
      a.ang += shortAngle(target - a.ang) * Math.min(1, dt * 12);
      if (a.mode !== 'arrow') a.ang = 0;
      var tr = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) rotate(' + a.ang.toFixed(3) + 'rad)';
      if (tr !== a.tr) { a.el.style.transform = tr; a.tr = tr; } // resting agents: no style write, no repaint
      // motion trails only for agents at work (and in the opening / finale): idle swarms glide without them
      var show = spd > 14 && (st.phase !== 'build' || !!a.task);
      for (var k = 0; k < 3; k++) {
        var g = a.ghosts[k], idx = (k + 1) * 4;
        if (show && k < gn && hh.length > idx + 1) {
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

  // ---------------------------------------------------------------- finale
  function enterDone(st, t) {
    st.phase = 'done';
    st.doneAt = t;
    st.elapsed = t - st.buildStart;
    st.doneLayers = st.totalLayers;
    api._lastStats = fpsStats(st);
    st.guides.forEach(function (g) { g.style.display = 'none'; });
    st.rulerTop.classList.remove('sr-on'); st.rulerLeft.classList.remove('sr-on');
    // every layer is revealed: drop all hiding -> DOM/CSS is the original again
    st.sections.forEach(function (s) { s.tails.forEach(function (el) { revealEl(st, el, true); }); });
    removeStyles();
    if (st.mo) { st.mo.disconnect(); st.mo = null; }
    // the swarms gather around the focus element in view at the final scroll position (pulled in like by
    // gravity: fast at first, a little past the target, then back), then circle it slowly
    var finalY = st.touring ? maxScroll() : window.scrollY;
    var F = focusAt(st, finalY);
    st.finO = orbitOf(st, F, finalY);
    st.focusInfo.done = focusLabel(F);
    st.mfollow = 0;
    st.agents.forEach(function (a) { a.task = null; a.mf = null; a.setMode('arrow'); });
    var ax = st.o.autoExit != null ? st.o.autoExit : !st.dbg ? 3 : st.o.mode === 'tour' ? null : 6;
    if (ax != null) st.timers.push(setTimeout(function () { if (S === st) finishNow(st, 'auto'); }, ax * 1000));
    if (st.dbg) st.dbg.done(st, t);
    if (typeof st.o.onDone === 'function') { try { st.o.onDone({ elapsed: st.elapsed, layers: st.totalLayers, agents: st.activeAgents }); } catch (e) { /* ignore */ } }
  }
  function finaleStep(st, t, dt, vw, vh) {
    if (st.touring && st.dbg) st.dbg.finale(st, t, dt);
    var T = t - st.doneAt;
    orbitSwarms(st, st.finO, t, dt, 0.42);
    // pull (a stiff, under-damped spring: overshoots a little) -> slow circling (soft, well damped)
    var mix = clamp((T - 0.9) / 0.9, 0, 1), z0 = lerp(1, 0.63, clamp(+st.o.motion.spring || 0, 0, 1));
    for (var i = 0; i < st.agents.length; i++) {
      var a = st.agents[i];
      if (!a.active) continue;
      var p = slot(a, t);
      freeStep(st, a, t, dt, p[0], p[1], lerp(6.5, 2.6, mix) * a.kf, lerp(z0, 0.85, mix), lerp(2600, 700, mix));
    }
  }

  // ------------------------------------------------------- exit / replay
  // Shows the finished page at once (no animation): every running task is completed, the overlay and the
  // hiding styles are removed. Only visibility changes, so nothing moves (no layout shift).
  function finishNow(st, why) {
    if (S !== st) return;
    st.active.forEach(function (tk) { if (!tk.finished) { try { completeTask(st, tk); } catch (e) { /* teardown removes everything anyway */ } } });
    teardown(st, true, why);
  }
  function teardown(st, done, why) {
    if (st.phase === 'build') api._lastStats = fpsStats(st);
    api._lastExit = why || (done ? 'done' : 'stop');
    cancelAnimationFrame(st.raf);
    st.timers.forEach(clearTimeout);
    st.listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
    if (st.mo) st.mo.disconnect();
    if (st.dbg) { try { st.dbg.teardown(st); } catch (e) { /* ignore */ } }
    rm(st.root);
    removeStyles();
    dmsStop();
    S = null;
    api.active = false;
    if (done && st.phase !== 'done' && typeof st.o.onDone === 'function') { try { st.o.onDone({ skipped: true, reason: why }); } catch (e) { /* ignore */ } }
  }
  function replay(st) {
    var o = assign({}, st.o, { force: true });
    teardown(st, false, 'replay');
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    ensureHide();
    dmsStart();
    run(o);
  }

  // ------------------------------------------------------------------ stats
  function snapshot(st) {
    var vh = window.innerHeight, ms = maxScroll();
    return {
      phase: st.dead ? 'dead' : st.phase, mode: st.o.mode, debug: !!st.dbg, touring: st.touring, speed: st.speedBase * st.mult,
      layersDone: st.doneLayers, layersTotal: st.totalLayers, agents: st.activeAgents,
      activeTasks: st.active.length, t: now() - st.t0,
      buildT: st.buildStart ? now() - st.buildStart : 0,
      elapsed: st.elapsed || null, scrollProgress: ms ? window.scrollY / ms : 0, viewportHeights: ms / vh + 1,
      hud: st.hud ? st.hud.textContent : '',
      controls: st.dbg ? { position: st.pos, collapsed: !!st.collapsed, corner: st.corner || null } : null,
      seen: st.seenStats, visiblePending: st.visPending || 0, maxAhead: +st.maxAhead.toFixed(3),
      waits: st.waits.length ? { n: st.waits.length, avg: +(st.waits.reduce(function (x, y) { return x + y; }, 0) / st.waits.length).toFixed(3), max: +Math.max.apply(null, st.waits).toFixed(3) } : null,
      aboveSkips: st.aboveSkips, offSkips: st.offSkips, depSkips: st.depSkips, aborts: st.aborts,
      buildVisible: st.vmin, startVis: st.startVis.n ? { n: st.startVis.n, min: +st.startVis.min.toFixed(3), avg: +(st.startVis.sum / st.startVis.n).toFixed(3) } : null,
      inView: st.phase === 'build' ? inViewWork(st) : null, errors: st.errors, holes: (st.holes || []).length,
      lite: !!st.lite, liteFps: !!st.liteFps, mouseOn: !!st.mouseOn, focus: st.focusInfo, diff: st.diff || null, swarms: (st.swarms || []).map(function (s) { var c = 0; st.agents.forEach(function (a) { if (a.active && a.swarm === s) c++; }); return c; }),
      mouse: { dodges: st.mz.dodges, follows: st.mz.follows.length, minD: st.mz.minD, following: st.mfollow },
      fault: st.fault ? { kind: st.fault.kind, fired: st.fault.fired, task: st.fault.task || null } : null
    };
  }
  // test measurement: parts in view still to build (or being built), and tasks running outside the view
  function inViewWork(st) {
    var sy = window.scrollY, vh = window.innerHeight, dh = maxScroll() + vh, left = 0, off = 0;
    for (var k = st.qHead; k < st.queue.length; k++) {
      var it = st.queue[k];
      if (it.state !== 'pending' || it.type === 'block') continue;
      var b = itemBox(it);
      if (b.y < sy + vh && b.y + b.h > sy && itemVis(it, sy, vh, dh) >= st.vmin) left++;
    }
    st.active.forEach(function (tk) { var b = taskBox(tk); if (b.y >= sy + vh || b.y + b.h <= sy) off++; else if (tk.it.type !== 'block') left++; });
    return { left: left, offTasks: off };
  }
  function fpsStats(st) {
    var f = st.frames.slice(10);
    if (!f.length) return null;
    var sum = 0; f.forEach(function (d) { sum += d; });
    var sorted = f.slice().sort(function (a, b) { return b - a; });
    var p95 = sorted[Math.floor(sorted.length * 0.05)] || sorted[0];
    return { frames: f.length, avgFps: +(f.length / sum).toFixed(1), p95FrameMs: +(p95 * 1000).toFixed(1), agents: st.maxAgents };
  }

  // what the debug add-on may use
  var core = {
    version: VERSION, api: api, ABOVE: ABOVE, visPart: visPart, taskBox: taskBox,
    now: now, clamp: clamp, lerp: lerp, rand: rand, mk: mk, rm: rm, alphaOf: alphaOf, store: store, warn: warn,
    state: function () { return S; }, finishNow: finishNow, replay: replay, skipItem: skipItem, startTask: startTask,
    depsOk: depsOk, itemBox: itemBox, maxScroll: maxScroll, growAgents: growAgents, openSection: openSection, settled: settled,
    SCROLLKEY: SCROLLKEY, scrollKey: scrollKey
  };

  window.SwarmRebuild = api;

  // auto start: <script src="swarm-rebuild.js" data-auto data-mode="scroll"></script>
  if (SCRIPT && SCRIPT.hasAttribute('data-auto')) {
    var ds = SCRIPT.dataset, opts = {};
    if (ds.mode) opts.mode = ds.mode;
    if (ds.speed) opts.speed = parseFloat(ds.speed);
    if (ds.agents) opts.agents = parseInt(ds.agents, 10);
    if (ds.exclude) opts.exclude = ds.exclude;
    if (ds.controlsPosition) opts.controlsPosition = ds.controlsPosition;
    if (ds.debug === '' || ds.debug === 'true') opts.debug = true;
    if (ds.debugSrc) opts.debugSrc = ds.debugSrc;
    if (ds.focus) opts.focus = ds.focus;
    if (ds.once === 'false') opts.once = false;
    var go = function () { start(opts); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
})();
