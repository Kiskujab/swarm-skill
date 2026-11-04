/*!
 * swarm-rebuild-debug v1.1.0 — test and debug add-on for swarm-rebuild.js.
 * Not for visitors: loaded only with ?rebuild-debug=1 or the debug: true option (the module fetches this
 * file next to itself; with a bundler import it before the module).
 *
 * Adds:
 * - the control bar (Tour, speed, Go live, Replay, ✕; right / left / bottom; collapsible; mobile tab that
 *   never covers fixed bars, phone links or buttons),
 * - the "tour" mode: an automatic scroll through the page at 1x (for recordings), started from the bar or
 *   with mode: 'tour'; the visitor's scrolling takes over,
 * - test hooks: SwarmRebuild._probe(), SwarmRebuild._motion() and the ?rebuild-fault= / ?rebuild-speed= /
 *   ?rebuild-hidden-max= / ?rebuild-motion= / ?rebuild-focus= parameters.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var CSS = [
    "#swarm-rebuild-root {",
    "  --sr-hud-bg: rgba(17, 23, 35, 0.62);",
    "  --sr-hud-solid: #141b28;",
    "  --sr-hud-fg: #e6edf7;",
    "  --sr-btn: rgba(255, 255, 255, 0.08);",
    "  --sr-btn-fg: #c9d3e1;",
    "  --sr-tour-bg: #1b5485;",
    "  --sr-tour-fg: #9fd2ff;",
    "  --sr-live: #1f8fe8;",
    "}",
    "/* Control bar (the only interactive part).",
    "   right / left: compact vertical bar at the edge, a little below the middle; collapses to a thin tab.",
    "   bottom: small horizontal bar; collapses to a thin tab at the bottom edge.",
    "   mobile: a thin tab at the screen edge, near a free corner; tap to open the bar there. */",
    "#swarm-rebuild-root .sr-hud {",
    "  position: absolute; top: 0; left: 0;            /* placed by the script with a transform (no layout shift) */",
    "  display: flex; flex-direction: column; align-items: stretch; gap: 8px;",
    "  width: 66px; padding: 4px 7px 7px; box-sizing: border-box;",
    "  background: var(--sr-hud-bg);",
    "  border: 1px solid rgba(255, 255, 255, 0.1);",
    "  border-radius: 12px;",
    "  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);",
    "  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);",
    "  pointer-events: auto;",
    "  font: 600 10px/1.25 ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif;",
    "}",
    "",
    "/* collapse handle */",
    "#swarm-rebuild-root .sr-tab {",
    "  appearance: none; -webkit-appearance: none; margin: 0; padding: 0; border: 0; cursor: pointer;",
    "  background: none; color: #9eabbd; height: 16px; border-radius: 6px;",
    "  display: flex; align-items: center; justify-content: center; flex: none;",
    "}",
    "#swarm-rebuild-root .sr-tab:hover { color: #fff; background: rgba(255, 255, 255, 0.08); }",
    "#swarm-rebuild-root .sr-tab:focus-visible { outline: 2px solid var(--sr-cyan); outline-offset: 1px; }",
    "#swarm-rebuild-root .sr-chev {",
    "  width: 5px; height: 5px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;",
    "  transform: rotate(-45deg); margin-left: -2px;               /* points right: hide to the right */",
    "}",
    "#swarm-rebuild-root .sr-hud[data-pos=\"left\"] .sr-chev { transform: rotate(135deg); margin: 0 -2px 0 0; }",
    "#swarm-rebuild-root .sr-tbar { display: none; position: relative; overflow: hidden; border-radius: 2px; background: rgba(255, 255, 255, 0.16); }",
    "#swarm-rebuild-root .sr-tbar b { position: absolute; inset: 0; background: var(--sr-blue); transform-origin: 50% 100%; transform: scaleY(var(--sr-p, 0)); }",
    "",
    "/* counters */",
    "#swarm-rebuild-root .sr-stat { display: flex; flex-direction: column; gap: 6px; min-height: 96px; }",
    "#swarm-rebuild-root .sr-scan { color: #c4cfde; font-weight: 500; }",
    "#swarm-rebuild-root .sr-avatars { display: inline-flex; }",
    "#swarm-rebuild-root .sr-avatars i {",
    "  width: 10px; height: 10px; border-radius: 50%; margin-left: -3px;",
    "  box-shadow: 0 0 0 1.5px rgba(19, 26, 39, 0.95);",
    "}",
    "#swarm-rebuild-root .sr-avatars i:first-child { margin-left: 0; }",
    "#swarm-rebuild-root .sr-n-agents, #swarm-rebuild-root .sr-n-layers { display: flex; flex-direction: column; }",
    "#swarm-rebuild-root .sr-stat b { font: 700 15px/1.1 ui-sans-serif, system-ui, sans-serif; color: #fff; font-variant-numeric: tabular-nums; }",
    "#swarm-rebuild-root .sr-stat small { font: 500 9.5px/1.3 ui-sans-serif, system-ui, sans-serif; color: #9eabbd; font-variant-numeric: tabular-nums; white-space: nowrap; }",
    "#swarm-rebuild-root .sr-donetext { color: #c4cfde; font-weight: 500; line-height: 1.35; }",
    "#swarm-rebuild-root .sr-donetext b { font-size: 13px; }",
    "",
    "/* progress */",
    "#swarm-rebuild-root .sr-bar { position: relative; height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.14); overflow: hidden; flex: none; }",
    "#swarm-rebuild-root .sr-bar i { position: absolute; inset: 0; background: var(--sr-blue); transform-origin: 0 50%; transform: scaleX(var(--sr-p, 0)); }",
    "",
    "/* buttons */",
    "#swarm-rebuild-root .sr-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }",
    "#swarm-rebuild-root .sr-btn {",
    "  appearance: none; -webkit-appearance: none; margin: 0; border: 0; cursor: pointer;",
    "  height: 24px; padding: 0; border-radius: 7px; min-width: 0;",
    "  background: var(--sr-btn); color: var(--sr-btn-fg);",
    "  font: 600 10px/24px ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif;",
    "  display: flex; align-items: center; justify-content: center; white-space: nowrap;",
    "}",
    "#swarm-rebuild-root .sr-btn:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }",
    "#swarm-rebuild-root .sr-btn:focus-visible { outline: 2px solid var(--sr-cyan); outline-offset: 1px; }",
    "#swarm-rebuild-root .sr-tour, #swarm-rebuild-root .sr-live, #swarm-rebuild-root .sr-replay { grid-column: 1 / -1; }",
    "#swarm-rebuild-root .sr-tour.sr-on { background: var(--sr-tour-bg); color: var(--sr-tour-fg); }",
    "#swarm-rebuild-root .sr-live { background: var(--sr-live); color: #fff; }",
    "#swarm-rebuild-root .sr-live:hover { background: #3aa0f0; }",
    "",
    "/* states */",
    "#swarm-rebuild-root .sr-hud .sr-avatars, #swarm-rebuild-root .sr-hud .sr-n-agents,",
    "#swarm-rebuild-root .sr-hud .sr-n-layers, #swarm-rebuild-root .sr-hud .sr-donetext,",
    "#swarm-rebuild-root .sr-hud .sr-live, #swarm-rebuild-root .sr-hud .sr-replay { display: none; }",
    "#swarm-rebuild-root .sr-hud[data-state=\"build\"] .sr-scan,",
    "#swarm-rebuild-root .sr-hud[data-state=\"done\"] .sr-scan { display: none; }",
    "#swarm-rebuild-root .sr-hud[data-state=\"build\"] .sr-avatars { display: inline-flex; }",
    "#swarm-rebuild-root .sr-hud[data-state=\"build\"] .sr-n-agents,",
    "#swarm-rebuild-root .sr-hud[data-state=\"build\"] .sr-n-layers { display: flex; }",
    "#swarm-rebuild-root .sr-hud[data-state=\"done\"] .sr-donetext { display: block; }",
    "#swarm-rebuild-root .sr-hud[data-state=\"done\"] .sr-live,",
    "#swarm-rebuild-root .sr-hud[data-state=\"done\"] .sr-replay { display: flex; }",
    "#swarm-rebuild-root .sr-hud[data-state=\"done\"] .sr-tour,",
    "#swarm-rebuild-root .sr-hud[data-state=\"done\"] .sr-speed { display: none; }",
    "#swarm-rebuild-root .sr-hud[data-state=\"done\"] .sr-close { grid-column: 1 / -1; }",
    "",
    "/* collapsed: a thin tab flush with the edge (nothing else is drawn over the page) */",
    "#swarm-rebuild-root .sr-hud.sr-collapsed { width: 14px; padding: 6px 0; gap: 0; border-radius: 8px 0 0 8px; border-right: 0; }",
    "#swarm-rebuild-root .sr-hud[data-pos=\"left\"].sr-collapsed { border-radius: 0 8px 8px 0; border-right: 1px solid rgba(255, 255, 255, 0.1); border-left: 0; }",
    "#swarm-rebuild-root .sr-hud.sr-collapsed > :not(.sr-tab) { display: none !important; }",
    "#swarm-rebuild-root .sr-collapsed .sr-tab { flex-direction: column; gap: 6px; height: auto; padding: 2px 0; }",
    "#swarm-rebuild-root .sr-collapsed .sr-chev { transform: rotate(135deg); margin: 0 0 0 2px; }",
    "#swarm-rebuild-root .sr-hud[data-pos=\"left\"].sr-collapsed .sr-chev { transform: rotate(-45deg); margin: 0 2px 0 0; }",
    "#swarm-rebuild-root .sr-collapsed .sr-tbar { display: block; width: 3px; height: 34px; }",
    "",
    "/* bottom: small horizontal bar */",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]) {",
    "  top: auto; right: auto; left: 50%; bottom: 12px; transform: translateX(-50%);",
    "  flex-direction: row; align-items: center; width: auto; height: 34px; padding: 0 5px 0 4px; gap: 8px; white-space: nowrap;",
    "}",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]) .sr-tab { width: 16px; height: 22px; }",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]) .sr-chev { transform: rotate(45deg); margin: -3px 0 0; }",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]) .sr-stat { flex-direction: row; align-items: center; gap: 8px; min-height: 0; }",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]) .sr-n-agents,",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]) .sr-n-layers { flex-direction: row; align-items: baseline; gap: 3px; }",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]) .sr-stat b { font-size: 11px; }",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]) .sr-stat small { font-size: 10px; }",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]) .sr-n-layers { min-width: 7.6em; }",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]) .sr-donetext b { font-size: 11px; }",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]) .sr-bar { width: 56px; }",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]) .sr-btns { display: flex; gap: 4px; }",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]) .sr-btn { padding: 0 8px; }",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]) .sr-speed,",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]) .sr-close { width: 24px; padding: 0; }",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]).sr-collapsed {",
    "  bottom: 0; width: 64px; height: 14px; padding: 0 6px; border-radius: 8px 8px 0 0; border: 1px solid rgba(255, 255, 255, 0.1); border-bottom: 0;",
    "}",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]).sr-collapsed .sr-tab { flex-direction: row; width: 100%; height: 14px; padding: 0; }",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]).sr-collapsed .sr-chev { transform: rotate(-135deg); margin: 3px 0 0; }",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]).sr-collapsed .sr-tbar { width: 34px; height: 3px; }",
    "#swarm-rebuild-root .sr-hud[data-pos=\"bottom\"]:not([data-mobile]).sr-collapsed .sr-tbar b { transform-origin: 0 50%; transform: scaleX(var(--sr-p, 0)); }",
    "",
    "/* mobile: small, near a free corner (chosen by the script so it never covers phone links, booking or other buttons) */",
    "#swarm-rebuild-root .sr-hud[data-mobile] { width: 60px; padding: 3px 6px 6px; gap: 6px; }",
    "#swarm-rebuild-root .sr-hud[data-mobile] .sr-stat { min-height: 0; }",
    "#swarm-rebuild-root .sr-hud[data-mobile] .sr-avatars { display: none !important; }",
    "#swarm-rebuild-root .sr-hud[data-mobile] .sr-chev { transform: rotate(45deg); margin: -3px 0 0; } /* points down: shrink */",
    "#swarm-rebuild-root .sr-hud[data-mobile].sr-collapsed { width: 20px; padding: 8px 0; }",
    "#swarm-rebuild-root .sr-hud[data-mobile][data-corner$=\"r\"].sr-collapsed { border-radius: 8px 0 0 8px; border: 1px solid rgba(255, 255, 255, 0.1); border-right: 0; }",
    "#swarm-rebuild-root .sr-hud[data-mobile][data-corner$=\"l\"].sr-collapsed { border-radius: 0 8px 8px 0; border: 1px solid rgba(255, 255, 255, 0.1); border-left: 0; }",
    "#swarm-rebuild-root .sr-hud[data-mobile].sr-collapsed .sr-chev { transform: rotate(135deg); margin: 0 0 0 2px; }",
    "#swarm-rebuild-root .sr-hud[data-mobile][data-corner$=\"l\"].sr-collapsed .sr-chev { transform: rotate(-45deg); margin: 0 2px 0 0; }",
    "#swarm-rebuild-root .sr-hud[data-mobile].sr-collapsed .sr-tbar { height: 22px; }"
  ].join('\n');
  var HUD_KEY = 'swarm-rebuild:hud'; // collapse choice for the control bar (this session)
  var CSS_ID = 'swarm-rebuild-debug-css';

  window.SwarmRebuildDebug = function (core, st) {
    var clamp = core.clamp, lerp = core.lerp, mk = core.mk, store = core.store;
    var vw0 = window.innerWidth;

    // ------------------------------------------------------------ control bar
    function init() {
      if (!document.getElementById(CSS_ID)) {
        var css = document.createElement('style');
        css.id = CSS_ID; css.textContent = CSS;
        (document.head || document.documentElement).appendChild(css);
      }
      var o = st.o, k;
      st.pos = { right: 1, left: 1, bottom: 1 }[o.controlsPosition] ? o.controlsPosition : 'right';
      var hud = mk('div', 'sr-hud', st.root);
      st.root.removeAttribute('aria-hidden');
      st.root.querySelector('.sr-deco').setAttribute('aria-hidden', 'true');
      hud.setAttribute('role', 'region');
      hud.setAttribute('aria-label', 'Page rebuild animation (debug)');
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
      for (k = 0; k < 5; k++) { var c = mk('i', '', av); c.style.background = o.colors[k % o.colors.length]; }
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
      st.btnTab.addEventListener('click', function () { setCollapsed(!st.collapsed, true); });
      st.btnTour.addEventListener('click', function () {
        st.touring = !st.touring; st.camV = 0; st.camY = window.scrollY;
        if (st.touring && st.followed) resumeTour();
        hudUpdate(true);
      });
      st.btnSpeed.addEventListener('click', function () { st.mult = st.mult === 1 ? 2 : st.mult === 2 ? 4 : 1; st.btnSpeed.textContent = st.mult + '×'; });
      st.btnLive.addEventListener('click', function () { core.finishNow(st, 'go-live'); });
      st.btnReplay.addEventListener('click', function () { core.replay(st); });
      st.btnClose.addEventListener('click', function () { core.finishNow(st, 'close'); });
      var pref = store(HUD_KEY);
      st.userCollapse = pref === 'collapsed' || pref === 'open';
      setCollapsed(pref ? pref === 'collapsed' : st.mobile, false);
      hudUpdate(true);
      core.api._probe = probe;
      // motion measurements: the path of every move (gravity sag), each task's work time, the mouse follows
      core.api._motion = function (light) {
        var s = st;
        if (!s || !s.mlog) return null;
        var ag = [];
        s.agents.forEach(function (a) { if (a.active) ag.push({ x: Math.round(a.x), y: Math.round(a.y), tx: Math.round(a.tgx || a.x), ty: Math.round(a.tgy || a.y), sw: s.swarms.indexOf(a.swarm), task: !!a.task, mf: !!a.mf }); });
        var out = { phase: s.phase, t: core.now() - s.t0, agents: ag, orbit: s.phase === 'done' ? s.finO : s.openO, follows: s.mz.follows, minD: s.mz.minD, dodges: s.mz.dodges };
        if (!light) { out.moves = s.mlog.moves; out.tasks = s.mlog.tasks; }
        return out;
      };
    }
    function setCollapsed(c, byUser) {
      st.collapsed = c;
      st.hud.classList.toggle('sr-collapsed', c);
      st.btnTab.setAttribute('aria-expanded', c ? 'false' : 'true');
      st.btnTab.setAttribute('aria-label', c ? 'Show animation controls' : 'Hide animation controls');
      if (byUser) { st.userCollapse = true; store(HUD_KEY, c ? 'collapsed' : 'open'); }
      placeHud(true);
    }
    // free space between the page content and the left / right viewport edge
    function measureGutter() {
      var cw = document.documentElement.clientWidth, sx = window.scrollX, minL = cw, maxR = 0;
      function acc(x, w) { if (w < 2 || w > cw * 0.85) return; minL = Math.min(minL, x - sx); maxR = Math.max(maxR, x - sx + w); }
      st.layers.forEach(function (L) { if (L.kind !== 'line') acc(L.x, L.w); });
      st.groups.forEach(function (g) { g.members.forEach(function (m) { if (m.R) acc(m.R.x, m.R.w); }); });
      st.gutter = { left: Math.max(0, minL), right: Math.max(0, cw - maxR) };
    }
    // desktop: if the expanded bar would sit on the page content, start as a thin tab
    function autoCollapse() {
      if (st.userCollapse || st.mobile || st.pos === 'bottom' || !st.gutter) return;
      var need = st.hud.classList.contains('sr-collapsed') ? 80 : st.hud.offsetWidth + 18;
      if (st.gutter[st.pos] < need && !st.collapsed) setCollapsed(true, false);
    }
    function obstacles() {
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
            if (core.alphaOf(cs.backgroundColor) > 0.1 || (parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.paddingLeft) >= 6)) st.avoidEls.push(a);
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
    function placeHud(force) {
      var hud = st.hud;
      if (!hud || !hud.isConnected) return;
      var cw = document.documentElement.clientWidth, vh = window.innerHeight;
      var w = hud.offsetWidth, h = hud.offsetHeight, obs = obstacles(), I = 10;
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
        hudXY(pr[0], pr[1]);
        return;
      }
      if (st.pos === 'bottom') return; // centred at the bottom by CSS
      var x = st.pos === 'left' ? (st.collapsed ? 0 : I) : cw - w - (st.collapsed ? 0 : I);
      if (!force && st.hudTop != null && !hits(obs, x, st.hudTop, w, h)) { hudXY(x, st.hudTop); return; }
      var fr = [0.58, 0.46, 0.7, 0.34, 0.82], top = null;
      for (var j = 0; j < fr.length; j++) {
        var y = clamp(Math.round(vh * fr[j] - h / 2), 8, Math.max(8, vh - h - 8));
        if (!hits(obs, x, y, w, h)) { top = y; break; }
      }
      if (top == null) top = clamp(Math.round(vh * fr[0] - h / 2), 8, Math.max(8, vh - h - 8));
      st.hudTop = top;
      hudXY(x, top);
    }
    // the bar is moved with a transform only, so moving it never counts as a layout shift
    function hudXY(x, y) {
      if (x === st.hudX && y === st.hudY) return;
      st.hudX = x; st.hudY = y;
      st.hud.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    }
    function hudUpdate(force) {
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

    // ------------------------------------------------------------------ tour
    function stopTour() {
      if (st.touring && st.phase !== 'done') {
        // the tour hands over to the visitor: the build goes on where they look (core dispatchFollow)
        st.touring = false;
        if (st.phase === 'build') { st.followed = true; core.growAgents(st, st.maxAgents); }
        hudUpdate(true);
      }
    }
    function inWindow(it) {
      var sy = window.scrollY, vh = window.innerHeight;
      if (sy >= core.maxScroll() - 2) return true; // nothing left to scroll: everything is reachable
      return it.y < sy + vh * 0.9;
    }
    function sectionOpen(s, t) {
      if (st.sectionOpen[s]) return true;
      var prev = st.sections[s - 1];
      var ok = s === 0 || !prev || sectionOpen(s - 1, t) && (prev.items === prev.itemsDone || prev.itemsDone / Math.max(1, prev.items) >= 0.45 || prev.h < window.innerHeight * 0.35);
      if (!ok) return false;
      st.sectionOpen[s] = true;
      if (s > 0 && st.useRulers && t - st.buildStart > 1.5) st.rulersUntil = Math.max(st.rulersUntil, t + 1.2 / st.openScale);
      var target = st.startAgents + Math.round((st.maxAgents - st.startAgents) * (st.nSections > 1 ? s / (st.nSections - 1) : 1));
      core.growAgents(st, target);
      return true;
    }
    // tour: the queue in reading order, never far below the camera
    function dispatch(t) {
      var idle = [];
      for (var i = 0; i < st.agents.length; i++) { var a = st.agents[i]; if (a.active && !a.task) idle.push(a); }
      while (st.qHead < st.queue.length && st.queue[st.qHead].state === 'done') st.qHead++;
      var looked = 0;
      for (var k = st.qHead; k < st.queue.length && idle.length && looked < 14; k++) {
        var it = st.queue[k];
        if (it.state !== 'pending') continue;
        looked++;
        if (!sectionOpen(it.section, t)) break;
        if (!inWindow(it) || !core.depsOk(it)) continue;
        if (it.type !== 'block') { if (st.tokens < 1) break; st.tokens -= 1; }
        var best = 0, bd = 1e12;
        for (var j = 0; j < idle.length; j++) {
          var d = Math.pow(idle[j].x - (it.L ? it.L.x : it.g.master.R.x), 2) + Math.pow(idle[j].y - it.y, 2);
          if (d < bd) { bd = d; best = j; }
        }
        var ag = idle.splice(best, 1)[0];
        core.startTask(st, it, ag, t, idle);
      }
    }
    // "Tour" pressed again after the visitor scrolled: continue from here, finish what lies above out of sight
    function resumeTour() {
      var sy = window.scrollY;
      st.queue.forEach(function (it) { if (it.state === 'pending') { var b = core.itemBox(it); if (b.y + b.h < sy) core.skipItem(st, it, true); } });
      st.active.forEach(function (tk) { var b = core.itemBox(tk.it); if (b.y + b.h < sy) tk.warp = 14; });
    }
    function camera(t, dt, vw, vh) {
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
      if (!next && !st.active.length) desired = core.maxScroll();
      desired = clamp(desired, 0, core.maxScroll());
      if (Math.abs(window.scrollY - st.camY) > 3) st.camY = window.scrollY; // someone else scrolled
      var diff = desired - st.camY;
      var base = 0.09 * vh * sp;
      var vt = diff <= 1 ? 0 : Math.min(diff * 3, base * (diff > vh * 0.32 ? 3 : 1));
      st.camV = lerp(st.camV, vt, 1 - Math.exp(-dt * 2.6 * Math.max(1, Math.sqrt(sp))));
      if (st.camV < 0.5 && vt === 0) st.camV = 0;
      st.camY = clamp(st.camY + st.camV * dt, 0, core.maxScroll());
      if (Math.round(st.camY) !== Math.round(window.scrollY)) window.scrollTo({ top: st.camY, left: window.scrollX, behavior: 'instant' });
    }
    function finale(t, dt) {
      var ms = core.maxScroll();
      if (Math.abs(window.scrollY - st.camY) > 3) { st.touring = false; hudUpdate(true); }
      else if (st.camY < ms - 1) {
        st.camY = lerp(st.camY, ms, 1 - Math.exp(-dt * 3));
        window.scrollTo({ top: st.camY, left: window.scrollX, behavior: 'instant' });
      }
    }

    // ------------------------------------------------------------ test probe
    // Which layers lie above the view (beyond the hysteresis band), and are they all final?
    function probe() {
      var s = core.state();
      if (!s) return null;
      var sy = window.scrollY, vh = window.innerHeight, cut = sy - Math.max(40, vh * core.ABOVE) - 2;
      var out = { phase: s.phase, sy: sy, checked: 0, notFinal: [], overlayAbove: [] };
      function chk(el, y, h, done, what) {
        if (y + h >= cut) return;
        out.checked++;
        var vis = el.isConnected ? getComputedStyle(el).visibility : 'visible';
        if (!done || vis !== 'visible') out.notFinal.push(what + ' @' + Math.round(y) + ' (' + (done ? vis : 'not done') + ')');
      }
      s.layers.forEach(function (L) { chk(L.el, L.y, L.h, L.state === 'done', L.kind); });
      s.groups.forEach(function (g) { g.members.forEach(function (m) { if (m.R) chk(m.el, m.R.y, m.R.h, m.done || (g.item && g.item.state === 'done'), 'clone'); }); });
      // overlay pieces above the view: allowed only for a task whose target is still (partly) in view,
      // e.g. a copy flying from a master card above into a visible slot
      var live = new Set();
      s.active.forEach(function (tk) {
        var b = core.itemBox(tk.it);
        if (b.y + b.h < cut) return;
        (tk.bag || []).forEach(function (e) { live.add(e); });
        if (tk.cl) tk.cl.members.forEach(function (m, i) {
          if (!m.done) return;
          var c = tk.cl.copies[i];
          [c && c.el, tk.cl.sels[i] && tk.cl.sels[i].el].forEach(function (e) { if (e) live.delete(e); }); // finished copies must be gone
        });
      });
      var kids = s.world.children;
      for (var i = 0; i < kids.length; i++) {
        if (live.has(kids[i])) continue;
        var r = kids[i].getBoundingClientRect();
        if (r.bottom < -(sy - cut) && r.height > 0 && getComputedStyle(kids[i]).opacity !== '0') out.overlayAbove.push(kids[i].className + ' @' + Math.round(r.top + sy));
      }
      out.notFinalN = out.notFinal.length; out.notFinal = out.notFinal.slice(0, 5);
      out.overlayAboveN = out.overlayAbove.length; out.overlayAbove = out.overlayAbove.slice(0, 5);
      return out;
    }

    // -------------------------------------------------------- core callbacks
    return {
      init: init,
      bind: function (s, on) {
        on(window, 'wheel', stopTour, { passive: true });
        on(window, 'touchmove', stopTour, { passive: true });
        on(window, 'keydown', function (e) { if (core.scrollKey(e)) stopTour(); }, true);
      },
      scanned: function () { measureGutter(); autoCollapse(); placeHud(true); },
      frame: function (s, t) {
        if (t > (st.placeAt || 0)) { st.placeAt = t + 0.5; placeHud(false); }
        if (st.phase === 'scan' && st.touring && t - st.t0 > st.scanDur * 0.7 && !st.touringShown) { st.touringShown = true; hudUpdate(true); }
      },
      hud: function (s, force) { hudUpdate(force); },
      build: function () { st.hud.setAttribute('data-state', 'build'); placeHud(false); },
      dispatch: function (s, t) { dispatch(t); },
      camera: function (s, t, dt, vw, vh) { camera(t, dt, vw, vh); },
      finale: function (s, t, dt) { finale(t, dt); },
      done: function () {
        st.hud.setAttribute('data-state', 'done');
        st.hudDone.innerHTML = 'Rebuilt by <b>' + st.activeAgents + '</b> agents in <b>' + st.elapsed.toFixed(1) + 's</b>';
        hudUpdate(true);
        placeHud(true);
      },
      resize: function () { if (st.layers.length) { measureGutter(); autoCollapse(); } placeHud(true); },
      teardown: function () { if (core.api._probe === probe) core.api._probe = null; }
    };
  };
})();
