/* ==================================================================
 * Catan map generation logic (pure, no DOM)
 *
 * Two board modes, same constraint engine:
 *   - "base"      : 19 hexes, rows 3-4-5-4-3   (3–4 players)
 *   - "extension" : 30 hexes, rows 3-4-5-6-5-4-3 (5–6 Player Extension)
 *
 * Constraints enforced (both modes):
 *   - no two identical resources adjacent (covers coast runs)
 *   - no two red numbers (6/8) adjacent
 *   - reds spread across resource types (<= 2 per type)
 *   - soft: identical numbers not adjacent; pips balanced per resource
 *   - deserts random; robber on a random desert; harbors spaced round coast
 *
 * Works in the browser (window.Catan) and Node (module.exports).
 * ================================================================== */
(function (root) {
  "use strict";

  const R = 56;                       // hex radius (logic units)
  const W = Math.sqrt(3) * R;         // hex width / horizontal spacing
  const VSTEP = 1.5 * R;              // row spacing

  // resource palette (colors/labels only — counts live in BOARDS)
  const RESOURCES = {
    forest:   { color: "#2f7d32", label: "Forest (lumber)" },
    pasture:  { color: "#86c34a", label: "Pasture (wool)" },
    field:    { color: "#e7c34a", label: "Fields (grain)" },
    hill:     { color: "#c8682f", label: "Hills (brick)" },
    mountain: { color: "#8c97a3", label: "Mountains (ore)" },
    desert:   { color: "#d8c79a", label: "Desert" },
  };

  // per-board parameters. The "extension" block must stay unchanged.
  const BOARDS = {
    base: {
      rows: [3, 4, 5, 4, 3],                                   // 19 hexes
      resources: { forest: 4, pasture: 4, field: 4, hill: 3, mountain: 3, desert: 1 },
      numbers: { 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1 }, // 18
      harbors: ["3:1", "3:1", "3:1", "3:1", "wood", "brick", "wool", "grain", "ore"], // 9
      maxPlayers: 4,
    },
    extension: {
      rows: [3, 4, 5, 6, 5, 4, 3],                             // 30 hexes
      resources: { forest: 6, pasture: 6, field: 6, hill: 5, mountain: 5, desert: 2 },
      numbers: { 2: 2, 3: 3, 4: 3, 5: 3, 6: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 2 }, // 28
      harbors: ["3:1", "3:1", "3:1", "3:1", "3:1", "wood", "brick", "wool", "wool", "grain", "ore"], // 11
      maxPlayers: 6,
    },
  };

  const HARBOR_RES = { wood: "forest", brick: "hill", wool: "pasture", grain: "field", ore: "mountain" };
  const isRed = (n) => n === 6 || n === 8;
  const pips = (n) => 6 - Math.abs(7 - n);      // 2/12->1 ... 6/8->5

  /* ---- seeded RNG (mulberry32) ------------------------------------ */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let rng = Math.random;
  const rint = (n) => Math.floor(rng() * n);
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = rint(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* ---- geometry: centers, adjacency, vertices, sea edges ---------- */
  function buildGeometry(rows) {
    const hexes = [];
    let id = 0;
    for (let r = 0; r < rows.length; r++) {
      const n = rows[r];
      for (let c = 0; c < n; c++) {
        hexes.push({ id: id++, row: r, col: c, cx: (c - (n - 1) / 2) * W, cy: r * VSTEP });
      }
    }
    const dist = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
    for (const h of hexes) h.adj = [];
    for (let i = 0; i < hexes.length; i++)
      for (let j = i + 1; j < hexes.length; j++)
        if (dist(hexes[i], hexes[j]) < W * 1.2) {
          hexes[i].adj.push(hexes[j].id);
          hexes[j].adj.push(hexes[i].id);
        }

    const cx0 = hexes.reduce((s, h) => s + h.cx, 0) / hexes.length;
    const cy0 = hexes.reduce((s, h) => s + h.cy, 0) / hexes.length;
    const vertex = (h, i) => {
      const a = Math.PI / 180 * (60 * i - 90);
      return { x: h.cx + R * Math.cos(a), y: h.cy + R * Math.sin(a) };
    };

    const seaEdges = [];
    for (const h of hexes) {
      for (let i = 0; i < 6; i++) {
        const v1 = vertex(h, i), v2 = vertex(h, (i + 1) % 6);
        const mid = { x: (v1.x + v2.x) / 2, y: (v1.y + v2.y) / 2 };
        let dx = mid.x - h.cx, dy = mid.y - h.cy;
        const len = Math.hypot(dx, dy); dx /= len; dy /= len;
        const nbx = h.cx + dx * W, nby = h.cy + dy * W;
        const hasNeighbour = hexes.some((o) => o !== h && Math.hypot(o.cx - nbx, o.cy - nby) < W * 0.25);
        if (!hasNeighbour)
          seaEdges.push({ hex: h, mid, out: { x: dx, y: dy }, v1, v2,
                          angle: Math.atan2(mid.y - cy0, mid.x - cx0) });
      }
    }
    seaEdges.sort((a, b) => a.angle - b.angle);
    return { hexes, vertex, seaEdges };
  }

  /* ---- resource placement: no identical neighbours ---------------- */
  function placeResources(hexes, counts) {
    for (let attempt = 0; attempt < 6000; attempt++) {
      const pool = { ...counts };
      const assign = new Array(hexes.length).fill(null);
      const order = shuffle(hexes.slice()).sort((a, b) => b.adj.length - a.adj.length);
      let ok = true;
      for (const h of order) {
        const banned = new Set(h.adj.map((id) => assign[id]).filter(Boolean));
        const cands = [];
        for (const [k, n] of Object.entries(pool))
          if (n > 0 && !banned.has(k)) for (let i = 0; i < n; i++) cands.push(k);
        if (!cands.length) { ok = false; break; }
        const pick = cands[rint(cands.length)];
        assign[h.id] = pick; pool[pick]--;
      }
      if (ok) return assign;
    }
    return null;
  }

  /* ---- number placement: backtracking with red/balance rules ------ */
  function placeNumbers(hexes, resources, numberPool) {
    const nonDesert = hexes.filter((h) => resources[h.id] !== "desert");

    function attempt(noSameNeighbour) {
      const order = shuffle(nonDesert.slice()).sort((a, b) => b.adj.length - a.adj.length);
      const counts = { ...numberPool };
      const redPerRes = {}, pipsPerRes = {}, num = {};
      const neighbourNums = (h) => h.adj.map((id) => num[id]).filter((v) => v != null);

      function bt(i) {
        if (i === order.length) return true;
        const h = order[i], res = resources[h.id];
        const nbNums = neighbourNums(h);
        const nbHasRed = nbNums.some(isRed);

        const cands = [];
        for (const key of Object.keys(counts)) {
          const n = +key;
          if (counts[n] <= 0) continue;
          if (isRed(n)) {
            if (nbHasRed) continue;
            if ((redPerRes[res] || 0) >= 2) continue;
          }
          if (noSameNeighbour && nbNums.includes(n)) continue;
          let score = (pipsPerRes[res] || 0) + pips(n);
          if (isRed(n)) score += (redPerRes[res] || 0) * 100;
          score += rng() * 1.5;
          cands.push({ n, score });
        }
        cands.sort((a, b) => a.score - b.score);

        for (const { n } of cands) {
          num[h.id] = n; counts[n]--;
          if (isRed(n)) redPerRes[res] = (redPerRes[res] || 0) + 1;
          pipsPerRes[res] = (pipsPerRes[res] || 0) + pips(n);
          if (bt(i + 1)) return true;
          num[h.id] = undefined; counts[n]++;
          if (isRed(n)) redPerRes[res]--;
          pipsPerRes[res] -= pips(n);
        }
        return false;
      }
      return bt(0) ? num : null;
    }

    for (let i = 0; i < 250; i++) { const r = attempt(true);  if (r) return { num: r, strict: true }; }
    for (let i = 0; i < 250; i++) { const r = attempt(false); if (r) return { num: r, strict: false }; }
    return null;
  }

  // fixed, evenly-woven port order (generic 3:1 alternating with 2:1 specifics)
  function weaveHarbours(harborList) {
    const gen = harborList.filter((t) => t === "3:1");
    const spec = harborList.filter((t) => t !== "3:1");
    const out = []; let g = 0, s = 0, turn = 0;
    while (out.length < harborList.length) {
      if (turn % 2 === 0 && g < gen.length) out.push(gen[g++]);
      else if (s < spec.length) out.push(spec[s++]);
      else if (g < gen.length) out.push(gen[g++]);
      turn++;
    }
    return out;
  }

  /* ---- harbour placement: types spaced round the coast ------------
     mix=true  -> shuffled port types (variable setup)
     mix=false -> fixed woven order (3:1 alternating with 2:1 specifics) */
  function placeHarbours(seaEdges, harborList, mix) {
    const M = seaEdges.length, count = harborList.length;
    const start = rint(M);
    const chosen = [], used = new Set();
    for (let k = 0; k < count; k++) {
      let idx = Math.round(start + (k * M) / count) % M;
      while (used.has(idx)) idx = (idx + 1) % M;
      used.add(idx);
      chosen.push(seaEdges[idx]);
    }
    const types = mix === false ? weaveHarbours(harborList) : shuffle(harborList.slice());
    return chosen.map((edge, i) => ({ edge, type: types[i] }));
  }

  /* ---- top-level generate ----------------------------------------- */
  function generate(seed, mode, opts) {
    mode = BOARDS[mode] ? mode : "extension";
    opts = opts || {};
    const board = BOARDS[mode];
    if (seed == null || Number.isNaN(seed)) seed = (Math.random() * 2 ** 32) >>> 0;
    seed = seed >>> 0;
    rng = mulberry32(seed);

    const geo = buildGeometry(board.rows);
    let resources = null, numbers = null;
    for (let tries = 0; tries < 40 && !numbers; tries++) {
      resources = placeResources(geo.hexes, board.resources);
      if (!resources) continue;
      numbers = placeNumbers(geo.hexes, resources, board.numbers);
    }
    if (!numbers) throw new Error("generation failed for seed " + seed + " mode " + mode);

    const deserts = geo.hexes.filter((h) => resources[h.id] === "desert");
    const robberHex = deserts[rint(deserts.length)].id;
    const mixPorts = opts.mixPorts !== false;
    const harbours = placeHarbours(geo.seaEdges, board.harbors, mixPorts);

    return { mode, geo, resources, numbers: numbers.num, strict: numbers.strict, harbours, robberHex, seed, mixPorts };
  }

  root.Catan = {
    R, W, VSTEP, RESOURCES, BOARDS, HARBOR_RES, isRed, pips,
    buildGeometry, placeResources, placeNumbers, placeHarbours, generate,
  };
})(typeof window !== "undefined" ? window : globalThis);

if (typeof module !== "undefined" && module.exports) module.exports = globalThis.Catan;
