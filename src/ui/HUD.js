/**
 * HUD — builds and updates the diegetic combat interface: health, ammo,
 * weapon, crosshair with dynamic spread, hitmarkers, compass, kill feed,
 * objectives, damage vignette and center announcements.
 */
export class HUD {
  constructor(root) {
    this.root = root;
    this.root.innerHTML = `
      <div class="hud-vignette"></div>
      <div class="hud-lowhealth" id="hud-lowhealth"></div>

      <div class="hud-compass"><div class="hud-compass-strip" id="hud-compass-strip"></div></div>

      <div class="hud-topleft">
        <div class="hud-objective" id="hud-objective">SECTOR — <b>ELIMINATE HOSTILES</b></div>
        <div class="hud-score" id="hud-score">0</div>
        <div class="hud-wave" id="hud-wave">WAVE 1</div>
      </div>

      <div class="hud-killfeed" id="hud-killfeed"></div>

      <div class="crosshair" id="hud-crosshair">
        <div class="ch-line ch-top"></div><div class="ch-line ch-bottom"></div>
        <div class="ch-line ch-left"></div><div class="ch-line ch-right"></div>
        <div class="ch-dot"></div>
      </div>
      <div class="hitmarker" id="hud-hitmarker">
        <span class="hm-tl"></span><span class="hm-tr"></span>
        <span class="hm-bl"></span><span class="hm-br"></span>
      </div>

      <div class="hud-status">
        <div class="hud-health-label">VITALS</div>
        <div class="hud-health-bar"><div class="hud-health-fill" id="hud-health-fill"></div></div>
        <div class="hud-health-num" id="hud-health-num">100</div>
      </div>

      <div class="hud-weapon">
        <div class="hud-weapon-name" id="hud-weapon-name">M4-X CARBINE</div>
        <div class="hud-ammo" id="hud-ammo">
          <span class="mag">30</span><span class="sep">/</span><span class="reserve">210</span>
        </div>
        <div class="hud-firemode" id="hud-firemode">AUTO</div>
        <div class="hud-reloading hidden" id="hud-reloading">RELOADING…</div>
      </div>

      <div class="hud-announce" id="hud-announce">
        <div class="a-main" id="hud-announce-main"></div>
        <div class="a-sub" id="hud-announce-sub"></div>
      </div>
    `;
    this.$ = (id) => this.root.querySelector(id);
    this._buildCompass();
    this._hitTimer = 0;
    this._announceTimer = 0;
  }

  _buildCompass() {
    const strip = this.$('#hud-compass-strip');
    const dirs = ['N', '', '', 'NE', '', '', 'E', '', '', 'SE', '', '', 'S', '', '', 'SW', '', '', 'W', '', '', 'NW', '', ''];
    // build 3 copies for wraparound
    let html = '';
    for (let rep = 0; rep < 3; rep++) {
      for (let i = 0; i < dirs.length; i++) {
        const card = ['N', 'E', 'S', 'W', 'NE', 'SE', 'SW', 'NW'].includes(dirs[i]);
        html += `<div class="hud-compass-tick ${card ? 'card' : ''}">${dirs[i] || '·'}</div>`;
      }
    }
    strip.innerHTML = html;
    this._compassTickCount = dirs.length;
  }

  setHealth(hp, max) {
    const t = Math.max(0, hp / max);
    const fill = this.$('#hud-health-fill');
    fill.style.width = (t * 100) + '%';
    fill.classList.toggle('low', t < 0.3);
    this.$('#hud-health-num').textContent = Math.ceil(hp);
    this.$('#hud-lowhealth').style.opacity = t < 0.35 ? (0.35 - t) / 0.35 : 0;
  }

  setAmmo(mag, reserve, magSize) {
    const el = this.$('#hud-ammo');
    el.querySelector('.mag').textContent = mag;
    el.querySelector('.reserve').textContent = reserve;
    el.classList.toggle('empty', mag === 0);
  }

  setWeapon(name, firemode) {
    this.$('#hud-weapon-name').textContent = name;
    this.$('#hud-firemode').textContent = firemode;
  }

  setReloading(on) {
    this.$('#hud-reloading').classList.toggle('hidden', !on);
  }

  setScore(score) { this.$('#hud-score').textContent = score; }
  setWave(text) { this.$('#hud-wave').textContent = text; }
  setObjective(html) { this.$('#hud-objective').innerHTML = html; }

  // crosshair spread in px based on movement/firing/ads
  setSpread(px, aiming) {
    const ch = this.$('#hud-crosshair');
    ch.classList.toggle('hidden', aiming);
    const g = Math.max(2, px);
    ch.querySelector('.ch-top').style.top = -g + 'px';
    ch.querySelector('.ch-bottom').style.bottom = -g + 'px';
    ch.querySelector('.ch-left').style.left = -g + 'px';
    ch.querySelector('.ch-right').style.right = -g + 'px';
  }

  hitmarker(kill = false) {
    const hm = this.$('#hud-hitmarker');
    hm.classList.toggle('kill', kill);
    hm.style.transition = 'none';
    hm.style.opacity = '1';
    hm.style.transform = 'translate(-50%,-50%) rotate(45deg) scale(1.3)';
    requestAnimationFrame(() => {
      hm.style.transition = 'all 0.25s ease-out';
      hm.style.opacity = '0';
      hm.style.transform = 'translate(-50%,-50%) rotate(45deg) scale(1)';
    });
  }

  killfeed(text) {
    const feed = this.$('#hud-killfeed');
    const item = document.createElement('div');
    item.className = 'killfeed-item';
    item.innerHTML = text;
    feed.prepend(item);
    while (feed.children.length > 5) feed.removeChild(feed.lastChild);
    setTimeout(() => { item.style.transition = 'opacity 0.5s'; item.style.opacity = '0'; setTimeout(() => item.remove(), 500); }, 4000);
  }

  announce(main, sub = '', duration = 2.2) {
    const el = this.$('#hud-announce');
    this.$('#hud-announce-main').textContent = main;
    this.$('#hud-announce-sub').textContent = sub;
    el.style.transition = 'none';
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) scale(1.05)';
    requestAnimationFrame(() => {
      el.style.transition = 'all 0.5s ease-out';
      el.style.transform = 'translateX(-50%) scale(1)';
    });
    this._announceTimer = duration;
  }

  damageFlash(dir = 0) {
    const lh = this.$('#hud-lowhealth');
    lh.style.transition = 'none';
    lh.style.boxShadow = 'inset 0 0 180px 60px rgba(255,30,45,0.5)';
    lh.style.opacity = '1';
    requestAnimationFrame(() => {
      lh.style.transition = 'opacity 0.5s, box-shadow 0.5s';
      this.setHealth(this._lastHp ?? 100, this._lastMax ?? 100);
    });
  }

  updateCompass(yaw) {
    // yaw in radians; map to strip offset
    const strip = this.$('#hud-compass-strip');
    const tickW = 40;
    const total = this._compassTickCount;
    let deg = (yaw * 180 / Math.PI) % 360;
    if (deg < 0) deg += 360;
    const ticksFromN = (deg / 360) * total;
    const centerOffset = 170; // half of 340
    const x = centerOffset - (total + ticksFromN) * tickW + tickW / 2;
    strip.style.transform = `translateX(${x}px)`;
  }

  update(dt, yaw) {
    this.updateCompass(yaw);
    if (this._announceTimer > 0) {
      this._announceTimer -= dt;
      if (this._announceTimer <= 0) {
        const el = this.$('#hud-announce');
        el.style.transition = 'opacity 0.6s';
        el.style.opacity = '0';
      }
    }
  }
}
