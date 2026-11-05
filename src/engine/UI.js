import { formatTime, clamp } from './utils.js';

const CAR_COLORS = ['#e00000', '#ff5a00', '#ffd000', '#00d26a', '#00c8ff', '#0066ff', '#9b30ff', '#ff2d95', '#f7f7f7', '#141414'];

const html = /* html */`
<div id="hud" class="hidden">
  <div class="hud-top-left glass">
    <div class="row"><span class="lbl">LAP</span><span id="hud-lap" class="val">1/3</span></div>
    <div class="row"><span class="lbl">TIME</span><span id="hud-time" class="val mono">0:00.000</span></div>
    <div class="row"><span class="lbl">BEST</span><span id="hud-best" class="val mono">--:--.---</span></div>
    <div class="row small"><span class="lbl">CHECKPOINT</span><span id="hud-cp" class="val">0/8</span></div>
  </div>
  <div class="hud-top-left glass" id="hud-free">
    <div class="row"><span class="lbl">SCORE</span><span id="hud-score" class="val">0</span></div>
    <div class="row"><span class="lbl">COINS</span><span id="hud-coins" class="val">0</span></div>
    <div class="row small"><span class="lbl">TOP SPEED</span><span id="hud-top" class="val">0 km/h</span></div>
  </div>
  <canvas id="minimap" width="360" height="360"></canvas>
  <div id="pg-hud" class="pg-hud glass hidden"><span class="pg-star">★</span> <b id="pg-stars">0/7</b><span class="pg-sep">·</span><span class="pg-tip">Esc menu · R reset · scroll to zoom</span></div>
  <div id="banner" class="banner"></div>
  <div id="drift-pop" class="drift-pop"><div class="drift-score">0</div><div class="drift-mult">DRIFT x1</div></div>
  <div id="popups"></div>
  <div class="gauge-wrap">
    <svg id="gauge" viewBox="0 0 220 220">
      <defs>
        <linearGradient id="tachGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#00e5ff"/><stop offset="70%" stop-color="#7c4dff"/><stop offset="100%" stop-color="#ff1744"/>
        </linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <circle cx="110" cy="110" r="100" class="g-bg"/>
      <path id="tach-track" class="g-track" d=""/>
      <path id="tach-red" class="g-red" d=""/>
      <path id="tach-fill" class="g-fill" d="" filter="url(#glow)"/>
      <g id="tach-ticks"></g>
      <line id="needle" x1="110" y1="64" x2="110" y2="26" class="g-needle"/>
      <text x="110" y="124" class="g-speed" id="g-speed">0</text>
      <text x="110" y="142" class="g-unit">KM/H</text>
      <text x="110" y="180" class="g-gear" id="g-gear">N</text>
    </svg>
    <div class="nitro"><div class="nitro-lbl">NITRO</div><div class="nitro-bar"><div id="nitro-fill"></div></div></div>
  </div>
  <div id="fps" class="fps hidden">60 FPS</div>
  <div id="hint" class="hint">W/S throttle & brake · A/D steer · SPACE handbrake · SHIFT nitro · C camera · R reset · ESC pause</div>
  <div id="touch" class="touch">
    <div class="tc-left"><button data-touch="left">◀</button><button data-touch="right">▶</button></div>
    <div class="tc-right">
      <button data-touch="nitro" class="tc-small">N₂O</button>
      <button data-touch="handbrake" class="tc-small">HB</button>
      <button data-touch="brake">BRAKE</button>
      <button data-touch="gas" class="tc-gas">GAS</button>
    </div>
    <button data-touch="camera" class="tc-cam">🎥</button>
  </div>
</div>

<div id="countdown" class="countdown"></div>

<div id="menu" class="screen">
  <div class="logo"><span class="l1">VELOCITY</span><span class="l2">RUSH</span><div class="logo-sub">open-world driving · drift · time attack</div></div>
  <div class="menu-panel glass" id="main-panel">
    <button class="btn primary" data-action="playground"><span class="ic">🧸</span>PLAYGROUND<small>Toy car · smash, score goals, find stars</small></button>
    <button class="btn primary" data-action="free"><span class="ic">🌍</span>FREE ROAM<small>Explore, drift, jump & collect coins</small></button>
    <button class="btn primary" data-action="trial"><span class="ic">🏁</span>TIME TRIAL<small>3 laps · beat your ghost</small></button>
    <button class="btn" data-action="garage"><span class="ic">🎨</span>GARAGE</button>
    <button class="btn" data-action="settings"><span class="ic">⚙️</span>SETTINGS</button>
    <button class="btn" data-action="controls"><span class="ic">🎮</span>CONTROLS</button>
  </div>
  <div class="menu-panel glass sub hidden" id="garage-panel">
    <h2>GARAGE</h2>
    <p class="muted">Pick a paint finish</p>
    <div class="swatches">${CAR_COLORS.map((c) => `<button class="swatch" data-color="${c}" style="--c:${c}"></button>`).join('')}</div>
    <label class="row-set">Racing stripes <input type="checkbox" id="opt-stripes"></label>
    <button class="btn" data-action="back">BACK</button>
  </div>
  <div class="menu-panel glass sub hidden" id="settings-panel">
    <h2>SETTINGS</h2>
    <label class="row-set">Graphics
      <select id="opt-quality"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
    <label class="row-set">Time of day
      <select id="opt-time"><option value="day">Day</option><option value="sunset">Sunset</option><option value="night">Night</option></select></label>
    <label class="row-set">Steering sensitivity <input type="range" id="opt-steer" min="0.5" max="2" step="0.1"></label>
    <label class="row-set">Music <input type="range" id="opt-music" min="0" max="1" step="0.05"></label>
    <label class="row-set">Sound FX <input type="range" id="opt-sfx" min="0" max="1" step="0.05"></label>
    <label class="row-set">Show FPS <input type="checkbox" id="opt-fps"></label>
    <p class="muted small">Graphics changes to trees/grass apply on reload.</p>
    <button class="btn" data-action="back">BACK</button>
  </div>
  <div class="menu-panel glass sub hidden" id="controls-panel">
    <h2>CONTROLS</h2>
    <table class="keys">
      <tr><td><kbd>W</kbd><kbd>↑</kbd></td><td>Throttle</td><td>RT</td></tr>
      <tr><td><kbd>S</kbd><kbd>↓</kbd></td><td>Brake / Reverse</td><td>LT</td></tr>
      <tr><td><kbd>A</kbd><kbd>D</kbd></td><td>Steer</td><td>Left stick</td></tr>
      <tr><td><kbd>Space</kbd></td><td>Handbrake (drift!)</td><td>A</td></tr>
      <tr><td><kbd>Shift</kbd></td><td>Nitro boost</td><td>B / RB</td></tr>
      <tr><td><kbd>C</kbd></td><td>Change camera</td><td>Y</td></tr>
      <tr><td><kbd>R</kbd></td><td>Reset to track</td><td>X</td></tr>
      <tr><td><kbd>M</kbd></td><td>Mute</td><td>Back</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Pause</td><td>Start</td></tr>
    </table>
    <p class="muted small">Tip: tap the handbrake while turning, then feather the throttle to hold a drift. Chain drifts for a bigger multiplier.</p>
    <button class="btn" data-action="back">BACK</button>
  </div>
  <div class="menu-footer">Press a mode to start · Gamepad & touch supported</div>
  <a class="back-home hidden" id="back-home" href="/">← Back to portfolio</a>
</div>

<div id="pause" class="screen dim hidden">
  <div class="menu-panel glass pop">
    <h2>PAUSED</h2>
    <button class="btn primary" data-action="resume">RESUME</button>
    <button class="btn" data-action="restart">RESTART</button>
    <button class="btn" data-action="camera"><span>CAMERA: <span id="cam-name">Chase</span></span></button>
    <button class="btn" data-action="quit">MAIN MENU</button>
  </div>
</div>

<div id="results" class="screen dim hidden">
  <div class="menu-panel glass pop">
    <h2 id="res-title">FINISHED!</h2>
    <div id="res-record" class="record hidden">★ NEW RECORD ★</div>
    <div class="res-total"><span>TOTAL</span><b id="res-total">0:00.000</b></div>
    <div id="res-laps" class="res-laps"></div>
    <div class="res-total small"><span>DRIFT SCORE</span><b id="res-score">0</b></div>
    <button class="btn primary" data-action="restart">RACE AGAIN</button>
    <button class="btn" data-action="quit">MAIN MENU</button>
  </div>
</div>
`;

export class UI {
  constructor(settings, audio) {
    this.settings = settings;
    this.audio = audio;
    this.root = document.getElementById('app');
    this.root.innerHTML = html;
    this.$ = (id) => document.getElementById(id);
    this.handlers = {};
    this.popups = this.$('popups');
    this.bannerTimer = 0;
    this.minimap = this.$('minimap');
    this.mctx = this.minimap.getContext('2d');
    this.buildGauge();
    this.bindMenu();
    this.isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    if (!this.isTouch) this.$('touch').remove();
    if (import.meta.env.BASE_URL !== '/') this.$('back-home').classList.remove('hidden');
    this.speedShown = 0;
  }

  on(name, fn) { this.handlers[name] = fn; }
  emit(name, ...args) { if (this.handlers[name]) this.handlers[name](...args); }

  bindMenu() {
    document.querySelectorAll('[data-action]').forEach((b) => {
      b.addEventListener('mouseenter', () => this.audio.uiHover());
      b.addEventListener('click', () => {
        this.audio.ensure();
        this.audio.uiClick();
        const a = b.dataset.action;
        if (a === 'garage' || a === 'settings' || a === 'controls') this.showPanel(`${a}-panel`);
        else if (a === 'back') this.showPanel('main-panel');
        else this.emit(a);
      });
    });
    document.querySelectorAll('.swatch').forEach((s) => {
      if (s.dataset.color === this.settings.carColor) s.classList.add('sel');
      s.addEventListener('click', () => {
        document.querySelectorAll('.swatch').forEach((o) => o.classList.remove('sel'));
        s.classList.add('sel');
        this.audio.ensure();
        this.audio.uiClick();
        this.emit('color', s.dataset.color);
      });
    });
    const q = this.$('opt-quality'), t = this.$('opt-time'), m = this.$('opt-music'), f = this.$('opt-sfx'), fps = this.$('opt-fps'), st = this.$('opt-stripes');
    q.value = this.settings.quality; t.value = this.settings.time; m.value = this.settings.music; f.value = this.settings.sfx; fps.checked = this.settings.showFps; st.checked = this.settings.stripes;
    const sv = this.$('opt-steer');
    sv.value = this.settings.steerSens;
    sv.oninput = () => this.emit('setting', 'steerSens', parseFloat(sv.value));
    q.onchange = () => this.emit('setting', 'quality', q.value);
    t.onchange = () => this.emit('setting', 'time', t.value);
    m.oninput = () => this.emit('setting', 'music', parseFloat(m.value));
    f.oninput = () => this.emit('setting', 'sfx', parseFloat(f.value));
    fps.onchange = () => { this.emit('setting', 'showFps', fps.checked); this.$('fps').classList.toggle('hidden', !fps.checked); };
    st.onchange = () => this.emit('setting', 'stripes', st.checked);
    this.$('fps').classList.toggle('hidden', !this.settings.showFps);
  }

  showPanel(id) {
    document.querySelectorAll('#menu .menu-panel').forEach((p) => p.classList.add('hidden'));
    const p = this.$(id);
    p.classList.remove('hidden');
    p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop');
  }

  showScreen(name) {
    this.$('menu').classList.toggle('hidden', name !== 'menu');
    this.$('pause').classList.toggle('hidden', name !== 'pause');
    this.$('results').classList.toggle('hidden', name !== 'results');
    this.$('hud').classList.toggle('hidden', !(name === 'hud' || name === 'pause'));
    if (name === 'menu') this.showPanel('main-panel');
  }

  setMode(mode) {
    const pg = mode === 'playground';
    document.querySelectorAll('.hud-top-left').forEach((e) => e.classList.add('hidden'));
    if (!pg) (mode === 'trial' ? document.querySelector('.hud-top-left:not(#hud-free)') : this.$('hud-free')).classList.remove('hidden');
    this.$('pg-hud').classList.toggle('hidden', !pg);
    this.minimap.classList.toggle('hidden', pg);
    document.querySelector('.gauge-wrap').classList.toggle('hidden', pg);
    const hint = this.$('hint');
    hint.classList.remove('fade'); void hint.offsetWidth; hint.classList.add('fade');
  }

  // ------------------------------------------------ gauge
  arc(cx, cy, r, a0, a1) {
    const p = (a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  }

  buildGauge() {
    this.a0 = Math.PI * 0.75;
    this.a1 = Math.PI * 2.25;
    this.$('tach-track').setAttribute('d', this.arc(110, 110, 88, this.a0, this.a1));
    const redStart = this.a0 + (this.a1 - this.a0) * (6.8 / 8);
    this.$('tach-red').setAttribute('d', this.arc(110, 110, 88, redStart, this.a1));
    const ticks = this.$('tach-ticks');
    let s = '';
    for (let i = 0; i <= 8; i++) {
      const a = this.a0 + (this.a1 - this.a0) * (i / 8);
      const x0 = 110 + Math.cos(a) * 74, y0 = 110 + Math.sin(a) * 74;
      const x1 = 110 + Math.cos(a) * 66, y1 = 110 + Math.sin(a) * 66;
      const tx = 110 + Math.cos(a) * 56, ty = 110 + Math.sin(a) * 56 + 4;
      s += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" class="g-tick"/>`;
      s += `<text x="${tx}" y="${ty}" class="g-num">${i}</text>`;
    }
    ticks.innerHTML = s;
  }

  updateGauge(car, dt) {
    const kmh = car.kmh;
    this.speedShown += (kmh - this.speedShown) * Math.min(1, dt * 12);
    const rpmFrac = clamp(car.rpm / 8000, 0, 1);
    const a = this.a0 + (this.a1 - this.a0) * rpmFrac;
    const deg = (a * 180) / Math.PI + 90;
    this.$('needle').setAttribute('transform', `rotate(${deg} 110 110)`);
    this.$('tach-fill').setAttribute('d', this.arc(110, 110, 88, this.a0, Math.max(this.a0 + 0.001, a)));
    this.$('g-speed').textContent = Math.round(this.speedShown);
    const gear = car.reverse ? 'R' : car.speed < 0.5 && car.input.throttle < 0.1 ? 'N' : String(car.gear);
    const ge = this.$('g-gear');
    if (ge.textContent !== gear) { ge.textContent = gear; ge.classList.remove('bump'); void ge.getBBox(); ge.classList.add('bump'); }
    ge.classList.toggle('redline', car.rpm > 6900);
    const nf = this.$('nitro-fill');
    nf.style.transform = `scaleX(${car.nitro})`;
    nf.classList.toggle('active', car.nitroActive);
  }

  // ------------------------------------------------ hud text
  updateTrial({ lap, laps, time, best, cp, cps }) {
    this.$('hud-lap').textContent = `${Math.min(lap, laps)}/${laps}`;
    this.$('hud-time').textContent = formatTime(time);
    this.$('hud-best').textContent = formatTime(best);
    this.$('hud-cp').textContent = `${cp}/${cps}`;
  }

  updatePlayground(found, total) {
    const el = this.$('pg-stars');
    el.textContent = `${found}/${total}`;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  updateFree({ score, coins, top }) {
    this.$('hud-score').textContent = Math.round(score).toLocaleString();
    this.$('hud-coins').textContent = coins;
    this.$('hud-top').textContent = `${Math.round(top)} km/h`;
  }

  updateDrift(active, score, mult) {
    const el = this.$('drift-pop');
    el.classList.toggle('show', active);
    if (active) {
      el.querySelector('.drift-score').textContent = Math.round(score).toLocaleString();
      el.querySelector('.drift-mult').textContent = `DRIFT x${mult}`;
      el.style.setProperty('--m', mult);
    }
  }

  popup(text, cls = '') {
    const d = document.createElement('div');
    d.className = `popup ${cls}`;
    d.textContent = text;
    this.popups.appendChild(d);
    setTimeout(() => d.remove(), 1700);
  }

  banner(text, cls = '', duration = 1.8) {
    const b = this.$('banner');
    b.textContent = text;
    b.className = `banner show ${cls}`;
    this.bannerTimer = duration;
  }

  countdown(text, go = false) {
    const c = this.$('countdown');
    c.textContent = text;
    c.className = `countdown ${go ? 'go' : ''}`;
    void c.offsetWidth;
    c.classList.add('show');
  }

  update(dt, fps) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.$('banner').classList.remove('show');
    }
    if (fps != null && this.settings.showFps) this.$('fps').textContent = `${fps} FPS`;
  }

  showResults({ total, laps, best, record, score }) {
    this.$('res-total').textContent = formatTime(total);
    this.$('res-score').textContent = Math.round(score).toLocaleString();
    this.$('res-record').classList.toggle('hidden', !record);
    this.$('res-laps').innerHTML = laps.map((t, i) =>
      `<div class="res-lap ${t === best ? 'best' : ''}" style="animation-delay:${0.2 + i * 0.12}s"><span>LAP ${i + 1}</span><b>${formatTime(t)}</b></div>`).join('');
    this.showScreen('results');
  }

  // ------------------------------------------------ minimap
  setupMinimap(env) {
    this.env = env;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of env.samples) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    this.mapBounds = { minX: minX - 30, maxX: maxX + 30, minZ: minZ - 30, maxZ: maxZ + 30 };
  }

  drawMinimap(car, extras) {
    if (!this.env) return;
    const ctx = this.mctx, W = this.minimap.width, H = this.minimap.height;
    const scale = 0.85; // px per meter (canvas is 2x css size)
    const p = car.mesh.position;
    const yaw = car.yaw;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2 - 4, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(10,16,26,0.62)';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(yaw + Math.PI);
    ctx.scale(scale, scale);
    ctx.translate(-p.x, -p.z);
    // park
    ctx.fillStyle = 'rgba(160,170,180,0.25)';
    ctx.beginPath(); ctx.arc(0, 0, 58, 0, Math.PI * 2); ctx.fill();
    // track
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 22;
    this.trackPath(ctx);
    ctx.strokeStyle = '#e8edf5';
    ctx.lineWidth = 9;
    this.trackPath(ctx);
    // start line
    const s0 = this.env.samples[0];
    ctx.fillStyle = '#ff3d00';
    ctx.beginPath(); ctx.arc(s0.x, s0.z, 6, 0, Math.PI * 2); ctx.fill();
    for (const e of extras) {
      ctx.fillStyle = e.color;
      ctx.beginPath(); ctx.arc(e.x, e.z, e.r || 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // player arrow (always pointing up)
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.fillStyle = '#00e5ff';
    ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(10, 11); ctx.lineTo(0, 5); ctx.lineTo(-10, 11); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 4, 0, Math.PI * 2); ctx.stroke();
  }

  trackPath(ctx) {
    const s = this.env.samples;
    ctx.beginPath();
    ctx.moveTo(s[0].x, s[0].z);
    for (let i = 1; i < s.length; i += 2) ctx.lineTo(s[i].x, s[i].z);
    ctx.closePath();
    ctx.stroke();
  }
}
