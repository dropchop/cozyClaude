// Procedural pixel-art textures (no external art assets). Each design is ported
// from the SVG/CSS sprites: every `<rect>`/shape becomes a Graphics fill call.
// Drawn small at native pixel size; the scene scales sprites up with nearest-
// neighbour filtering for chunky 16-bit pixels.

const C = {
  grass: 0x5ea63a, grass2: 0x66ad40, grassLt: 0x7cc24e, grassDk: 0x4f8f30,
  outline: 0x2a1c10, wood: 0xb5763a, woodDk: 0x7c4f25, woodDker: 0x4a2c12,
  cream: 0xf6e8c8, skin: 0xf0c090, pants: 0x39406a,
  red: 0xd2603f, blue: 0x5a86c0, green: 0x5fae46, leaf: 0x3f9a3f, leaf2: 0x46a64a,
  yellow: 0xf0c64a, pink: 0xf06ca0, grey: 0x8a8f9a, water: 0x3aa6d8, dirt: 0xcaa368,
  white: 0xffffff,
};

// --- house dimensions/colours per style (idle roof colour is applied as a tint
//     on the white roof texture so status can re-tint it) ---
export const HOUSE_W = 56;
export const HOUSE_H = 56;
const HOUSE_STYLE = {
  cottage: { wall: 0xf6e8c8, roof: 0xd2603f, frame: 0xb5763a, door: 0x8a5326 },
  shop:    { wall: 0xecd6a6, roof: 0x5a86c0, frame: 0x7c4f25, door: 0x8a5326, awning: 0x5a86c0 },
  tower:   { wall: 0xd9d2c0, roof: 0x8a8f9a, frame: 0x7c4f25, door: 0x6b4423, tall: true },
  barn:    { wall: 0xc14a36, roof: 0x7c2f22, frame: 0x8a3526, door: 0x6b4423, wide: true },
  bakery:  { wall: 0xf1dcb4, roof: 0xa9743f, frame: 0xb5763a, door: 0x8a5326, awning: 0xf06ca0 },
  cabin:   { wall: 0xb07a44, roof: 0x3f7a3a, frame: 0x6b4423, door: 0x6b4423, logs: true },
};
export const HOUSE_STYLES = Object.keys(HOUSE_STYLE);

// Idle roof/flag tint per style (status re-tints these at run time).
export const ROOF_COLORS = Object.fromEntries(HOUSE_STYLES.map((s) => [s, HOUSE_STYLE[s].roof]));

// Status → roof/flag tint while a run is happening.
export const STATUS_TINT = {
  idle: null, // use the style's roof colour
  pending: 0xef9a3c,
  running: 0xef9a3c,
  completed: 0x5fae46,
  failed: 0xd2603f,
};

const fr = (g, c, x, y, w, h) => g.fillStyle(c, 1).fillRect(x, y, w, h);

function tex(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

// ---------------- ground ----------------
function grass(scene) {
  tex(scene, 'grass', 16, 16, (g) => {
    fr(g, C.grass, 0, 0, 16, 16);
    fr(g, C.grass2, 0, 8, 16, 8);
    [[4, 5], [11, 2], [2, 12]].forEach(([x, y]) => fr(g, C.grassLt, x, y, 1, 1));
    [[9, 4], [13, 11], [6, 9]].forEach(([x, y]) => fr(g, C.grassDk, x, y, 1, 1));
  });
}

function ground(scene) {
  tex(scene, 'road', 16, 16, (g) => {
    fr(g, 0x9a9387, 0, 0, 16, 16);
    fr(g, 0xaaa499, 1, 1, 6, 6); fr(g, 0x8d867a, 9, 1, 6, 4);
    fr(g, 0x8d867a, 1, 9, 5, 6); fr(g, 0xaaa499, 8, 7, 7, 8);
    fr(g, 0x7c7468, 3, 3, 1, 1); fr(g, 0x7c7468, 11, 11, 1, 1);
  });
  tex(scene, 'path', 16, 16, (g) => {
    fr(g, C.dirt, 0, 0, 16, 16);
    fr(g, 0xb58e51, 2, 3, 2, 1); fr(g, 0xdcb87f, 9, 2, 2, 1);
    fr(g, 0xb58e51, 5, 8, 2, 1); fr(g, 0xdcb87f, 11, 10, 2, 1); fr(g, 0xb58e51, 3, 12, 2, 1);
  });
  tex(scene, 'water', 16, 16, (g) => {
    fr(g, C.water, 0, 0, 16, 16);
    fr(g, 0x2f93c4, 0, 9, 16, 3);
    fr(g, 0xbfe8f7, 2, 4, 5, 1); fr(g, 0xbfe8f7, 9, 11, 5, 1);
  });
}

// ---------------- decorations ----------------
function decorations(scene) {
  tex(scene, 'tree', 18, 22, (g) => {
    fr(g, 0x6b4423, 7, 15, 4, 6); fr(g, 0x4a2c14, 7, 15, 1, 6);
    fr(g, C.outline, 2, 3, 14, 11); fr(g, 0x3f8f3a, 3, 4, 12, 9);
    fr(g, 0x4fae47, 3, 4, 12, 4); fr(g, 0x4fae47, 5, 2, 8, 3);
    fr(g, 0x2f6f2c, 6, 6, 2, 2); fr(g, 0x2f6f2c, 10, 9, 2, 2);
  });
  tex(scene, 'pine', 16, 24, (g) => {
    fr(g, 0x6b4423, 7, 19, 2, 5);
    g.fillStyle(0x2f7a39, 1).fillTriangle(8, 1, 14, 8, 2, 8);
    g.fillStyle(0x358a3f, 1).fillTriangle(8, 5, 15, 13, 1, 13);
    g.fillStyle(0x2f7a39, 1).fillTriangle(8, 9, 16, 19, 0, 19);
    g.fillStyle(0x46a64f, 1).fillTriangle(8, 1, 11, 5, 5, 5);
  });
  tex(scene, 'bush', 18, 12, (g) => {
    fr(g, C.outline, 1, 4, 16, 7); fr(g, 0x3f9a3f, 2, 5, 14, 5);
    fr(g, 0x46a64a, 3, 3, 6, 3); fr(g, 0x46a64a, 9, 4, 6, 2);
    fr(g, C.red, 6, 6, 1, 1); fr(g, C.yellow, 11, 7, 1, 1);
  });
  tex(scene, 'hedge', 24, 14, (g) => {
    fr(g, 0x2f7a39, 0, 2, 24, 11); fr(g, 0x3f9a3f, 0, 2, 24, 3);
    [[3, 4], [11, 3], [18, 4]].forEach(([x, y]) => fr(g, 0x46a64a, x, y, 2, 2));
  });
  tex(scene, 'flower', 8, 12, (g) => {
    fr(g, 0x2f7a2f, 3, 6, 1, 6); fr(g, 0x3f9a3f, 1, 8, 2, 1); fr(g, 0x3f9a3f, 4, 9, 2, 1);
    fr(g, C.pink, 2, 2, 4, 4); fr(g, C.pink, 3, 0, 2, 2); fr(g, C.pink, 3, 6, 2, 1);
    fr(g, C.pink, 0, 3, 2, 2); fr(g, C.pink, 6, 3, 2, 2); fr(g, 0xf7d84a, 3, 3, 2, 2);
  });
  tex(scene, 'mushroom', 10, 10, (g) => {
    fr(g, C.red, 1, 1, 8, 4); fr(g, 0xc23030, 0, 3, 10, 2);
    fr(g, C.white, 3, 2, 2, 1); fr(g, C.white, 6, 3, 1, 1); fr(g, 0xf0e6c8, 3, 5, 4, 4);
  });
  tex(scene, 'rock', 16, 12, (g) => {
    fr(g, C.outline, 1, 3, 14, 8); fr(g, 0x9b9690, 2, 4, 12, 6);
    fr(g, 0xb4afa8, 2, 4, 12, 2); fr(g, 0x7c7872, 5, 7, 3, 2);
  });
  tex(scene, 'fountain', 24, 20, (g) => {
    fr(g, C.outline, 2, 11, 20, 7); fr(g, 0x8a8f9a, 3, 12, 18, 5);
    fr(g, 0xaeb4c0, 3, 12, 18, 2); fr(g, C.water, 4, 14, 16, 3);
    fr(g, 0xbfe8f7, 6, 15, 4, 1); fr(g, 0x8a8f9a, 10, 4, 4, 9);
    fr(g, 0x7ec8f0, 11, 1, 2, 3); fr(g, 0x9bd6f4, 9, 3, 6, 1);
  });
  tex(scene, 'well', 20, 22, (g) => {
    fr(g, 0x6b4423, 3, 2, 2, 8); fr(g, 0x6b4423, 15, 2, 2, 8);
    g.fillStyle(0xb5402f, 1).fillTriangle(2, 2, 18, 2, 10, -1);
    fr(g, C.outline, 4, 9, 12, 11); fr(g, 0x9b9690, 5, 10, 10, 9); fr(g, 0x244a5a, 6, 11, 8, 5);
  });
  tex(scene, 'lamp', 8, 24, (g) => {
    fr(g, 0x2a2a3a, 3, 6, 2, 16); fr(g, 0x2a2a3a, 1, 20, 6, 3);
    fr(g, 0x3a3a4a, 1, 1, 6, 6); fr(g, 0xf7e27a, 2, 2, 4, 4);
  });
  tex(scene, 'sign', 16, 16, (g) => {
    fr(g, 0x6b4423, 7, 7, 2, 9); fr(g, C.outline, 2, 2, 12, 7);
    fr(g, C.dirt, 3, 3, 10, 5); fr(g, 0x8a6736, 4, 5, 8, 1); fr(g, 0x8a6736, 4, 7, 6, 1);
  });
  tex(scene, 'bench', 20, 12, (g) => {
    fr(g, C.wood, 2, 2, 16, 3); fr(g, 0x8a5a2c, 2, 6, 16, 2);
    fr(g, 0x6b4423, 3, 8, 2, 3); fr(g, 0x6b4423, 15, 8, 2, 3);
  });
  tex(scene, 'fence', 20, 14, (g) => {
    [2, 9, 16].forEach((x) => fr(g, C.wood, x, 2, 2, 11));
    fr(g, 0x8a5a2c, 0, 5, 20, 2); fr(g, 0x8a5a2c, 0, 9, 20, 2);
  });
  tex(scene, 'crate', 14, 14, (g) => {
    fr(g, C.outline, 1, 1, 12, 12); fr(g, C.wood, 2, 2, 10, 10);
    g.lineStyle(1, 0x7c4f25, 1).strokeRect(2, 2, 10, 10).lineBetween(2, 2, 12, 12).lineBetween(12, 2, 2, 12);
  });
  tex(scene, 'barrel', 12, 16, (g) => {
    fr(g, C.outline, 1, 1, 10, 14); fr(g, C.wood, 2, 2, 8, 12);
    fr(g, 0x6b4423, 2, 4, 8, 1); fr(g, 0x6b4423, 2, 11, 8, 1); fr(g, 0x8a5a2c, 2, 2, 2, 12);
  });
  tex(scene, 'crops', 20, 14, (g) => {
    fr(g, 0x7a5230, 0, 6, 20, 8); fr(g, 0x8a623c, 0, 6, 20, 2);
    [3, 9, 15].forEach((x) => { fr(g, 0x3f9a3f, x, 2, 2, 6); fr(g, 0x46a64a, x - 1, 1, 4, 2); });
  });
}

// ---------------- houses (wall texture + tintable roof) ----------------
function houses(scene) {
  for (const style of HOUSE_STYLES) {
    const s = HOUSE_STYLE[style];
    const wallW = s.wide ? 48 : s.tall ? 30 : 40;
    const wallH = s.tall ? 40 : 28;
    const wx = (HOUSE_W - wallW) / 2;
    const wy = HOUSE_H - wallH;

    tex(scene, `housewall-${style}`, HOUSE_W, HOUSE_H, (g) => {
      // wall + frame
      fr(g, s.frame, wx - 2, wy - 2, wallW + 4, wallH + 4);
      fr(g, s.wall, wx, wy, wallW, wallH);
      if (s.logs) for (let y = wy; y < wy + wallH; y += 4) fr(g, 0x000000, wx, y, wallW, 1);
      // awning (shop/bakery)
      if (s.awning) for (let x = wx; x < wx + wallW; x += 6) fr(g, x % 12 === wx % 12 ? s.awning : 0xf4ead0, x, wy - 3, 6, 4);
      // windows
      const winY = wy + 5;
      fr(g, s.frame, wx + 5, winY, 8, 8); fr(g, 0xa9dceb, wx + 6, winY + 1, 6, 6);
      fr(g, s.frame, wx + wallW - 13, winY, 8, 8); fr(g, 0xa9dceb, wx + wallW - 12, winY + 1, 6, 6);
      // door
      const dw = 10; const dh = 14; const dx = wx + (wallW - dw) / 2;
      fr(g, 0x4a2c12, dx - 1, wy + wallH - dh, dw + 2, dh);
      fr(g, s.door, dx, wy + wallH - dh + 1, dw, dh);
      fr(g, C.yellow, dx + dw - 3, wy + wallH - dh + 7, 1, 1);
    });

    // Roof drawn WHITE so a tint sets the colour (style idle colour, or status).
    tex(scene, `houseroof-${style}`, HOUSE_W, 22, (g) => {
      const rw = wallW + 8; const rx = (HOUSE_W - rw) / 2; const peak = HOUSE_W / 2;
      g.fillStyle(C.white, 1).fillTriangle(peak, 0, rx + rw, 20, rx, 20);
      // shingle shading lines (kept subtle, drawn darker so tint still reads)
      g.fillStyle(0x000000, 0.12);
      for (let y = 6; y < 20; y += 4) g.fillRect(rx + 4, y, rw - 8, 1);
      // chimney
      g.fillStyle(0x9a5a34, 1).fillRect(rx + rw - 14, 2, 5, 10);
    });
  }

  // tintable flag pennant + a window-glow overlay
  tex(scene, 'flag', 16, 11, (g) => {
    g.fillStyle(C.white, 1).fillPoints([{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 12, y: 5 }, { x: 16, y: 11 }, { x: 0, y: 11 }], true);
  });
  tex(scene, 'smoke', 6, 6, (g) => g.fillStyle(C.white, 1).fillCircle(3, 3, 3));
  // faint build grid cell (transparent fill, thin border)
  tex(scene, 'gridtile', 32, 32, (g) => g.lineStyle(1, 0x3a2a14, 0.4).strokeRect(0, 0, 32, 32));
  tex(scene, 'carrier', 16, 9, (g) => {
    fr(g, 0xdcb255, 1, 0, 14, 9); fr(g, 0x8a5a24, 1, 0, 3, 9); fr(g, 0x8a5a24, 12, 0, 3, 9);
  });
}

// ---------------- villagers (colour variants × 2 walk frames) ----------------
export const VILLAGER_VARIANTS = [
  { shirt: 0xd23c3c, hair: 0x3a2410 }, { shirt: 0x3c6cd2, hair: 0x5a3a1c },
  { shirt: 0x3cb04c, hair: 0x1a1a1a }, { shirt: 0xc64caa, hair: 0xa05a2c },
  { shirt: 0xe0a020, hair: 0xcaa050 }, { shirt: 0x2aa6a6, hair: 0x3a2410 },
];

function villager(g, v, frame) {
  // hair
  fr(g, v.hair, 3, 1, 6, 2); fr(g, v.hair, 2, 2, 1, 2); fr(g, v.hair, 9, 2, 1, 2);
  // face + eyes
  fr(g, C.skin, 3, 3, 6, 3); fr(g, C.outline, 4, 4, 1, 1); fr(g, C.outline, 7, 4, 1, 1);
  // body + arms + belt
  fr(g, v.shirt, 2, 6, 8, 5); fr(g, C.skin, 1, 6, 1, 4); fr(g, C.skin, 10, 6, 1, 4);
  fr(g, C.outline, 2, 10, 8, 1);
  // legs (alternate by frame for the walk cycle)
  const lift = frame === 0 ? 0 : 1;
  fr(g, C.pants, 3, 11, 2, 4 - lift); fr(g, C.pants, 7, 11, 2, 4 - (1 - lift));
  fr(g, C.outline, 3, 15, 2, 1); fr(g, C.outline, 7, 15, 2, 1);
}

function villagers(scene) {
  VILLAGER_VARIANTS.forEach((v, i) => {
    for (let f = 0; f < 2; f++) {
      tex(scene, `villager-${i}-${f}`, 12, 16, (g) => villager(g, v, f));
    }
  });
}

// Build everything the scene needs.
export function makeTextures(scene) {
  grass(scene);
  ground(scene);
  decorations(scene);
  houses(scene);
  villagers(scene);
}

// Map a placement kind → its texture key (1:1 for decorations).
export const decorTextureKey = (kind) => kind;
