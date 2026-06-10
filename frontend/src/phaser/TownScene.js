import Phaser from 'phaser';
import { makeTextures, ROOF_COLORS, STATUS_TINT, VILLAGER_VARIANTS } from './textures.js';
import { bus } from './bus.js';
import { SCALE, DEPTH, houseSize, houseAnchor, objectDepth, contentBounds, tubeControl } from './geometry.js';
import { GROUND, LINE_KINDS, lineCells, worldToTile, tileTopLeft, snap } from '../world.js';
import { buildNav, findPath, pickTarget, randomSpawn } from './pathfinding.js';

const N_VILLAGERS = 8;
// cap A* grid-clone calls per frame so synchronized re-targets can't hitch
const MAX_PATHS_PER_FRAME = 2;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3;
const BULLDOZE = 'bulldoze';
const DRAG_THRESHOLD = 6;

export class TownScene extends Phaser.Scene {
  constructor() { super('Town'); }

  create() {
    makeTextures(this);
    this.ground = this.add.tileSprite(0, 0, 20000, 20000, 'grass').setDepth(DEPTH.grass);
    this.gridSprite = this.add.tileSprite(0, 0, 20000, 20000, 'gridtile').setDepth(DEPTH.tube - 1).setVisible(false);
    this.tubeGfx = this.add.graphics().setDepth(DEPTH.tube);
    this.wireGfx = this.add.graphics().setDepth(820000);
    this.selGfx = this.add.graphics().setDepth(850000);
    this.previewGfx = this.add.graphics().setDepth(900000);

    this.houses = new Map();
    this.decor = new Map();
    this.tubes = [];
    this.data = { stations: [], decorations: [], connections: [] };

    this.buildMode = false;
    this.brush = null;
    this.lineMode = 'L';
    this.spaceDown = false;
    this.painting = false;
    this.dragging = false;       // camera pan
    this.drag = null;            // moving a house/decor: { kind, id, dx, dy, moved }
    this.wire = null;            // { from } while pulling a tube
    this.selected = null;        // { type:'house'|'decor'|'tube', id }
    this.runActive = false;
    this.stroke = new Set();
    this.lineStart = null;
    this.previewCells = [];
    this.nav = null;
    this.villagers = [];
    this._navDirty = false;
    this._tmpVec = new Phaser.Math.Vector2();
    this._aheadVec = new Phaser.Math.Vector2();

    this.setupInput();
    this.setupVillagers();

    const busOffs = [
      bus.on('load', (d) => this.renderData(d)),
      bus.on('build:mode', (v) => { this.buildMode = v; this.gridSprite.setVisible(v); }),
      bus.on('build:brush', (v) => { this.brush = v; }),
      bus.on('build:lineMode', (v) => { this.lineMode = v; }),
      bus.on('decor:added', (row) => this.addDecor(row, true)),
      bus.on('decor:addedMany', (rows) => { rows.forEach((r) => this.addDecor(r, false)); this.data.decorations.push(...rows); this.rebuildNav(); }),
      bus.on('conn:added', (row) => { this.data.connections.push(row); this.drawTubes(); }),
      bus.on('house:updated', (s) => this.updateHouse(s)),
      bus.on('house:removed', (id) => this.removeHouse(id)),
      bus.on('house:status', (d) => this.applyHouseStatus(d)),
      bus.on('run:active', (v) => { this.runActive = v; this.tubes.forEach((t) => t.carrier.setVisible(v)); }),
      bus.on('deselect', () => this.deselect()),
    ];
    this.events.once('shutdown', () => busOffs.forEach((off) => off()));

    bus.emit('scene:ready');
  }

  // ---------- input ----------
  setupInput() {
    const cam = this.cameras.main;
    let lastX = 0; let lastY = 0;

    this.input.keyboard?.on('keydown-SPACE', () => { this.spaceDown = true; });
    this.input.keyboard?.on('keyup-SPACE', () => { this.spaceDown = false; });
    this.input.keyboard?.on('keydown-DELETE', () => this.deleteSelected());
    this.input.keyboard?.on('keydown-BACKSPACE', () => this.deleteSelected());

    this.input.on('pointerdown', (p) => {
      // 1) building with a brush
      if (this.buildMode && this.brush && !this.spaceDown) {
        this.painting = true; this.stroke.clear();
        if (this.brush === BULLDOZE) this.bulldozeAt(p);
        else if (LINE_KINDS.has(this.brush)) {
          this.lineStart = worldToTile(p.worldX, p.worldY);
          this.previewCells = [{ tx: this.lineStart.tx, ty: this.lineStart.ty }];
          this.drawPreview();
        } else this.placeAt(p);
        return;
      }
      // 2) move / wire / select (no active brush)
      if (!this.brush && !this.spaceDown) {
        const nub = this.houseNubUnder(p.worldX, p.worldY);
        if (nub) { this.wire = { from: nub }; return; }
        const hid = this.houseUnderPointer(p.worldX, p.worldY);
        if (hid) {
          const rec = this.houses.get(hid);
          this.drag = { kind: 'house', id: hid, dx: rec.container.x - p.worldX, dy: rec.container.y - p.worldY, startX: p.worldX, startY: p.worldY, moved: false };
          return;
        }
        const d = this.decorUnder(p.worldX, p.worldY);
        if (d) {
          this.drag = { kind: 'decor', id: d.id, dx: d.img.x - p.worldX, dy: d.img.y - p.worldY, startX: p.worldX, startY: p.worldY, moved: false };
          return;
        }
      }
      // 3) pan
      this.dragging = true; lastX = p.x; lastY = p.y;
    });

    this.input.on('pointermove', (p) => {
      if (this.painting) {
        if (this.brush === BULLDOZE) this.bulldozeAt(p);
        else if (LINE_KINDS.has(this.brush) && this.lineStart) {
          this.previewCells = lineCells(this.lineStart, worldToTile(p.worldX, p.worldY), this.lineMode);
          this.drawPreview();
        } else if (this.brush) this.placeAt(p);
        return;
      }
      if (this.wire) {
        const from = this.data.stations.find((s) => s.id === this.wire.from);
        const a = houseAnchor(from);
        this.wireGfx.clear().lineStyle(6, 0x8a5a2c, 0.85).lineBetween(a.x, a.y, p.worldX, p.worldY);
        return;
      }
      if (this.drag) {
        if (!this.drag.moved && Phaser.Math.Distance.Between(this.drag.startX, this.drag.startY, p.worldX, p.worldY) > DRAG_THRESHOLD) this.drag.moved = true;
        if (this.drag.moved) {
          this.moveDragged(p.worldX + this.drag.dx, p.worldY + this.drag.dy);
          if (this.drag.kind === 'house') this.trackShake(p.worldX);
        }
        return;
      }
      if (this.dragging) {
        cam.scrollX -= (p.x - lastX) / cam.zoom; cam.scrollY -= (p.y - lastY) / cam.zoom;
        lastX = p.x; lastY = p.y;
      }
    });

    const onUp = (p) => {
      if (this.painting && LINE_KINDS.has(this.brush) && this.previewCells.length) {
        const kind = this.brush;
        const items = this.previewCells.map(({ tx, ty }) => { const tl = tileTopLeft(tx, ty); return { kind, position_x: tl.x, position_y: tl.y }; });
        bus.emit('intent:placeLine', { items });
      }
      if (this.wire) {
        const to = this.houseUnderPointer(p.worldX, p.worldY);
        if (to && to !== this.wire.from) bus.emit('intent:connect', { from: this.wire.from, to });
        this.wire = null; this.wireGfx.clear();
      } else if (this.drag) {
        const { kind, id, moved } = this.drag;
        if (moved) {
          if (kind === 'house') {
            const rec = this.houses.get(id);
            bus.emit('intent:moveNode', { type: 'station', id, x: rec.container.x, y: rec.container.y });
          } else {
            const img = this.decor.get(id);
            const d = this.data.decorations.find((dd) => dd.id === id);
            if (d) { d.position_x = img.x; d.position_y = img.y; }
            bus.emit('intent:moveNode', { type: 'decor', id, x: img.x, y: img.y });
          }
          this.rebuildNav();
        } else {
          this.select(kind, id); // a click (no real drag) selects
        }
        this.drag = null;
      } else if (this.dragging && Phaser.Math.Distance.Between(p.downX, p.downY, p.x, p.y) < DRAG_THRESHOLD) {
        // a pure click on empty space: select a tube if one is under the cursor, else deselect
        const conn = this.tubeUnder(p.worldX, p.worldY);
        if (conn) this.select('tube', conn.id); else this.deselect();
      }
      if (this._navDirty) { this.rebuildNav(); this._navDirty = false; }
      this.painting = false; this.dragging = false; this.lineStart = null;
      this.previewCells = []; this.previewGfx.clear();
    };
    this.input.on('pointerup', onUp);
    this.input.on('pointerupoutside', onUp);

    this.input.on('wheel', (_p, _o, _dx, dy) => {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), MIN_ZOOM, MAX_ZOOM));
    });
  }

  moveDragged(x, y) {
    if (this.drag.kind === 'house') {
      const rec = this.houses.get(this.drag.id);
      rec.container.setPosition(x, y);
      rec.label.setPosition(x + (56 * SCALE) / 2, y - 16);
      const { h } = houseSize();
      rec.container.setDepth(objectDepth(y + h));
      rec.label.setDepth(objectDepth(y + h) + 1);
      const st = this.data.stations.find((s) => s.id === this.drag.id);
      if (st) { st.position_x = x; st.position_y = y; }
      this.drawTubes();
    } else {
      const img = this.decor.get(this.drag.id);
      img.setPosition(x, y).setDepth(GROUND.has(img.getData('kind') || '') ? DEPTH.ground : objectDepth(y + img.height * SCALE));
    }
    this.updateSelGfx();
  }

  // Shake a dragged house left-right rapidly to pop off all its tubes.
  trackShake(x) {
    const d = this.drag;
    const dx = x - (d.lastX ?? x);
    d.lastX = x;
    if (Math.abs(dx) < 4) return; // ignore jitter
    const dir = dx < 0 ? -1 : 1;
    if (d.shakeDir && dir !== d.shakeDir) {
      const now = Date.now();
      d.shakeTimes = (d.shakeTimes || []).filter((t) => now - t < 600);
      d.shakeTimes.push(now);
      if (d.shakeTimes.length >= 4) {
        // persist the (small) move, drop the connections, end the drag
        const rec = this.houses.get(d.id);
        if (rec) bus.emit('intent:moveNode', { type: 'station', id: d.id, x: rec.container.x, y: rec.container.y });
        this.disconnectHouse(d.id);
        this.drag = null;
      }
    }
    d.shakeDir = dir;
  }

  disconnectHouse(id) {
    const gone = this.data.connections.filter((c) => c.from_station_id === id || c.to_station_id === id);
    if (!gone.length) return;
    gone.forEach((c) => bus.emit('intent:deleteConn', c.id));
    this.data.connections = this.data.connections.filter((c) => c.from_station_id !== id && c.to_station_id !== id);
    this.drawTubes();
    this.rebuildNav();
    const rec = this.houses.get(id);
    if (rec) this.tweens.add({ targets: rec.container, scale: SCALE * 1.14, duration: 90, yoyo: true });
  }

  // ---------- hit tests ----------
  houseUnderPointer(wx, wy) {
    const { w, h } = houseSize();
    for (const s of this.data.stations) {
      if (wx >= s.position_x && wx <= s.position_x + w && wy >= s.position_y && wy <= s.position_y + h) return s.id;
    }
    return null;
  }

  houseNubUnder(wx, wy) {
    for (const s of this.data.stations) {
      const nx = s.position_x + 54 * SCALE; const ny = s.position_y + 30 * SCALE;
      if (Phaser.Math.Distance.Between(wx, wy, nx, ny) < 12) return s.id;
    }
    return null;
  }

  decorUnder(wx, wy) {
    let best = null;
    for (const [id, img] of this.decor) {
      const w = img.width * SCALE; const h = img.height * SCALE;
      if (wx >= img.x && wx <= img.x + w && wy >= img.y && wy <= img.y + h) {
        if (!best || img.depth > best.img.depth) best = { id, img };
      }
    }
    return best;
  }

  tubeUnder(wx, wy) {
    const pt = new Phaser.Math.Vector2();
    for (const t of this.tubes) {
      for (let i = 0; i <= 24; i++) {
        t.curve.getPoint(i / 24, pt);
        if (Phaser.Math.Distance.Between(wx, wy, pt.x, pt.y) < 9) return t.conn;
      }
    }
    return null;
  }

  // ---------- selection ----------
  select(kind, id) {
    if (kind === 'house') this.selectHouse(id);
    else { this.selected = { type: kind, id }; bus.emit('select:clear'); this.updateSelGfx(); this.drawTubes(); }
  }

  selectHouse(id) { this.selected = { type: 'house', id }; bus.emit('select:house', id); this.updateSelGfx(); this.drawTubes(); }

  deselect() { this.selected = null; bus.emit('select:clear'); this.updateSelGfx(); this.drawTubes(); }

  updateSelGfx() {
    const g = this.selGfx; g.clear();
    if (!this.selected) return;
    g.lineStyle(2, 0xf0c64a, 1);
    if (this.selected.type === 'house') {
      const rec = this.houses.get(this.selected.id); if (!rec) return;
      const { w, h } = houseSize();
      g.strokeRect(rec.container.x - 2, rec.container.y - 2, w + 4, h + 4);
    } else if (this.selected.type === 'decor') {
      const img = this.decor.get(this.selected.id); if (!img) return;
      g.strokeRect(img.x - 2, img.y - 2, img.width * SCALE + 4, img.height * SCALE + 4);
    }
  }

  deleteSelected() {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return; // typing
    if (!this.selected) return;
    const { type, id } = this.selected;
    if (type === 'house') bus.emit('intent:deleteHouse', id);
    else if (type === 'decor') {
      bus.emit('intent:deleteDecor', id);
      this.decor.get(id)?.destroy(); this.decor.delete(id);
      this.data.decorations = this.data.decorations.filter((d) => d.id !== id);
      this.rebuildNav();
    } else if (type === 'tube') {
      bus.emit('intent:deleteConn', id);
      this.data.connections = this.data.connections.filter((c) => c.id !== id);
      this.drawTubes();
    }
    this.selected = null; this.updateSelGfx();
  }

  // ---------- placement ----------
  placeAt(p) {
    const kind = this.brush;
    let x; let y;
    if (GROUND.has(kind)) { const t = worldToTile(p.worldX, p.worldY); const tl = tileTopLeft(t.tx, t.ty); x = tl.x; y = tl.y; }
    else { x = snap(p.worldX, 16) - 8; y = snap(p.worldY, 16) - 8; }
    const key = `${kind}:${x},${y}`;
    if (this.stroke.has(key)) return;
    this.stroke.add(key);
    bus.emit('intent:placeDecor', { kind, position_x: x, position_y: y });
  }

  bulldozeAt(p) {
    for (const [id, img] of this.decor) {
      const w = img.width * SCALE; const h = img.height * SCALE;
      if (p.worldX >= img.x && p.worldX <= img.x + w && p.worldY >= img.y && p.worldY <= img.y + h) {
        if (this.stroke.has(`bz:${id}`)) continue;
        this.stroke.add(`bz:${id}`);
        bus.emit('intent:deleteDecor', id);
        img.destroy(); this.decor.delete(id);
        this.data.decorations = this.data.decorations.filter((d) => d.id !== id);
        this._navDirty = true; // rebuilt once when the stroke ends (pointerup)
      }
    }
  }

  drawPreview() {
    const g = this.previewGfx; g.clear(); g.fillStyle(0xfff4b4, 0.5);
    for (const { tx, ty } of this.previewCells) {
      const tl = tileTopLeft(tx, ty);
      g.fillRect(tl.x, tl.y, 32, 32);
      g.lineStyle(1, 0xfff4b4, 0.9).strokeRect(tl.x + 0.5, tl.y + 0.5, 31, 31);
    }
  }

  // ---------- rendering ----------
  renderData(data) {
    this.data = { stations: data.stations || [], decorations: data.decorations || [], connections: data.connections || [] };
    this.houses.forEach((h) => { h.container.destroy(); h.label.destroy(); });
    this.decor.forEach((d) => d.destroy());
    this.houses.clear(); this.decor.clear();
    this.selected = null; this.selGfx.clear();
    for (const d of this.data.decorations) this.addDecor(d);
    for (const s of this.data.stations) this.addHouse(s);
    this.drawTubes();
    this.fitCamera();
    this.rebuildNav();
  }

  addDecor(d, isNew) {
    const img = this.add.image(d.position_x, d.position_y, d.kind).setOrigin(0, 0).setScale(SCALE);
    img.setData('decorId', d.id); img.setData('kind', d.kind);
    img.setDepth(GROUND.has(d.kind) ? DEPTH.ground : objectDepth(d.position_y + img.height * SCALE));
    this.decor.set(d.id, img);
    if (isNew) { this.data.decorations.push(d); this.rebuildNav(); }
    return img;
  }

  addHouse(s) {
    const { h } = houseSize();
    const style = s.style || 'cottage';
    const container = this.add.container(s.position_x, s.position_y);
    const wall = this.add.image(0, 0, `housewall-${style}`).setOrigin(0, 0);
    const roof = this.add.image(0, 8, `houseroof-${style}`).setOrigin(0, 0).setTint(ROOF_COLORS[style]);
    const flag = this.add.image(28, -16, 'flag').setOrigin(0, 0).setTint(ROOF_COLORS[style]);
    const nubOut = this.add.circle(54, 30, 3, 0xdcb255).setStrokeStyle(1, 0x6b4a1c);
    const nubIn = this.add.circle(2, 30, 3, 0xcdeaf3).setStrokeStyle(1, 0x6b4a1c);
    container.add([roof, flag, wall, nubIn, nubOut]);
    container.setScale(SCALE).setDepth(objectDepth(s.position_y + h)).setData('stationId', s.id);

    const cx = s.position_x + (56 * SCALE) / 2;
    const label = this.add.text(cx, s.position_y - 16, s.name, {
      fontFamily: 'Press Start 2P, monospace', fontSize: '10px', color: '#fff4d6',
      backgroundColor: '#4a2c12', padding: { x: 4, y: 3 },
    }).setOrigin(0.5, 1).setDepth(objectDepth(s.position_y + h) + 1);

    this.houses.set(s.id, { container, wall, roof, flag, label, station: s, style, status: 'idle' });
  }

  updateHouse(s) {
    const rec = this.houses.get(s.id);
    if (rec) { rec.container.destroy(); rec.label.destroy(); this.houses.delete(s.id); }
    this.data.stations = this.data.stations.map((st) => (st.id === s.id ? s : st));
    this.addHouse(s);
    this.drawTubes();
    this.rebuildNav();
  }

  removeHouse(id) {
    const rec = this.houses.get(id);
    if (rec) { rec.container.destroy(); rec.label.destroy(); this.houses.delete(id); }
    this.data.stations = this.data.stations.filter((s) => s.id !== id);
    this.data.connections = this.data.connections.filter((c) => c.from_station_id !== id && c.to_station_id !== id);
    if (this.selected?.id === id) this.deselect();
    this.drawTubes();
    this.rebuildNav();
  }

  applyHouseStatus({ station_id, status, tokens_used, cost_usd }) {
    const rec = this.houses.get(station_id);
    if (!rec) return;
    rec.status = status;
    const tint = STATUS_TINT[status];
    const color = tint == null ? ROOF_COLORS[rec.style] : tint;
    rec.roof.setTint(color); rec.flag.setTint(color);
    const extra = [tokens_used ? `${tokens_used}t` : '', cost_usd ? `$${Number(cost_usd).toFixed(3)}` : ''].filter(Boolean).join(' ');
    rec.label.setText(extra ? `${rec.station.name}  ${extra}` : rec.station.name);
  }

  drawTubes() {
    const g = this.tubeGfx; g.clear();

    // Build updated curve data without destroying carriers.
    // Carriers are long-lived images keyed by conn.id — only created/destroyed
    // when connections are added or removed, not on every redraw during drag.
    const newTubes = [];
    const seen = new Set();
    for (const conn of this.data.connections) {
      const from = this.data.stations.find((s) => s.id === conn.from_station_id);
      const to = this.data.stations.find((s) => s.id === conn.to_station_id);
      if (!from || !to) continue;
      const a = houseAnchor(from); const b = houseAnchor(to); const ctrl = tubeControl(a, b);
      const curve = new Phaser.Curves.QuadraticBezier(
        new Phaser.Math.Vector2(a.x, a.y), new Phaser.Math.Vector2(ctrl.x, ctrl.y), new Phaser.Math.Vector2(b.x, b.y)
      );
      const sel = this.selected?.type === 'tube' && this.selected.id === conn.id;
      g.lineStyle(11, sel ? 0xf0c64a : 0x5a4026, 1); curve.draw(g, 48);
      g.lineStyle(7, 0xcdeaf3, 0.55); curve.draw(g, 48);
      g.lineStyle(2, 0xffffff, 0.4); curve.draw(g, 48);
      g.fillStyle(0x8a5a2c, 1); g.fillCircle(a.x, a.y, 4); g.fillCircle(b.x, b.y, 4);

      // Reuse existing carrier if present; create only when connection is new.
      const existing = this.tubes.find((t) => t.conn.id === conn.id);
      const carrier = existing
        ? existing.carrier
        : this.add.image(a.x, a.y, 'carrier').setDepth(DEPTH.tube + 1);
      carrier.setVisible(this.runActive);
      seen.add(conn.id);
      newTubes.push({ conn, curve, carrier, t: existing ? existing.t : Math.random() });
    }

    // Destroy carriers for connections that no longer exist.
    this.tubes.forEach((t) => { if (!seen.has(t.conn.id)) t.carrier.destroy(); });
    this.tubes = newTubes;
  }

  fitCamera() {
    const b = contentBounds(this.data.stations, this.data.decorations);
    const cam = this.cameras.main;
    cam.centerOn(b.cx, b.cy);
    cam.setZoom(Phaser.Math.Clamp(Math.min(cam.width / (b.w + 200), cam.height / (b.h + 200)), MIN_ZOOM, 1.5));
  }

  // ---------- NPCs ----------
  setupVillagers() {
    VILLAGER_VARIANTS.forEach((_v, i) => {
      if (!this.anims.exists(`walk-${i}`)) {
        this.anims.create({ key: `walk-${i}`, frames: [{ key: `villager-${i}-0` }, { key: `villager-${i}-1` }], frameRate: 6, repeat: -1 });
      }
    });
    for (let k = 0; k < N_VILLAGERS; k++) {
      const vi = k % VILLAGER_VARIANTS.length;
      const spr = this.add.sprite(0, 0, `villager-${vi}-0`).setOrigin(0.5, 1).setScale(SCALE).setVisible(false);
      this.villagers.push({ spr, vi, path: [], idx: 0, speed: 28 + Math.random() * 26, pause: 0, facing: 1 });
    }
  }

  rebuildNav() { this.nav = buildNav(this.data.stations, this.data.decorations); }

  updateVillagers(delta) {
    if (!this.nav) { this.villagers.forEach((v) => v.spr.setVisible(false)); return; }
    const dt = delta / 1000;
    let pathsThisFrame = 0;
    for (const v of this.villagers) {
      if (!v.spr.visible) { const sp = randomSpawn(this.nav); if (!sp) continue; v.spr.setPosition(sp.x, sp.y).setVisible(true); }
      if (v.pause > 0) { v.pause -= dt; if (v.spr.anims.isPlaying) v.spr.anims.stop(); continue; }
      if (v.idx >= v.path.length) {
        // defer to next frame if we've already hit the per-frame A* budget
        if (pathsThisFrame >= MAX_PATHS_PER_FRAME) { v.pause = 0; continue; }
        pathsThisFrame += 1;
        const tgt = pickTarget(this.nav);
        const path = tgt && findPath(this.nav, { x: v.spr.x, y: v.spr.y }, tgt);
        if (path && path.length) { v.path = path; v.idx = 0; } else { v.pause = 0.3 + Math.random() * 0.4; continue; }
      }
      const wp = v.path[v.idx];
      const dx = wp.x - v.spr.x; const dy = wp.y - v.spr.y; const d = Math.hypot(dx, dy);
      if (d < 2) { v.idx += 1; if (v.idx >= v.path.length) v.pause = 0.4 + Math.random() * 1.4; continue; }
      const step = Math.min(d, v.speed * dt);
      v.spr.x += (dx / d) * step; v.spr.y += (dy / d) * step;
      if (Math.abs(dx) > 0.5) { v.facing = dx < 0 ? -1 : 1; v.spr.setFlipX(v.facing < 0); }
      const depth = objectDepth(v.spr.y);
      if (depth !== v.lastDepth) { v.spr.setDepth(depth); v.lastDepth = depth; }
      if (!v.spr.anims.isPlaying) v.spr.play(`walk-${v.vi}`);
    }
  }

  update(_time, delta) {
    this.updateVillagers(delta);
    if (!this.runActive) return;
    const step = delta / 1400;
    for (const tube of this.tubes) {
      tube.t = (tube.t + step) % 1;
      tube.curve.getPoint(tube.t, this._tmpVec);
      tube.carrier.setPosition(this._tmpVec.x, this._tmpVec.y);
      tube.curve.getPoint(Math.min(1, tube.t + 0.02), this._aheadVec);
      tube.carrier.setRotation(Phaser.Math.Angle.Between(this._tmpVec.x, this._tmpVec.y, this._aheadVec.x, this._aheadVec.y));
    }
  }
}
