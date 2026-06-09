/* Validation harness — runs the generator over many seeds, both board
 * modes, and asserts every constraint holds. Run: node test-logic.js   */
const Catan = require("./catan-logic.js");
const { BOARDS, HARBOR_RES, isRed, pips } = Catan;

const N = 1000;
let failures = 0;

function fail(mode, seed, msg) {
  failures++;
  if (failures <= 25) console.log(`  ✗ [${mode}] seed ${seed}: ${msg}`);
}

function runMode(mode) {
  const board = BOARDS[mode];
  const totalHex = Object.values(board.resources).reduce((a, b) => a + b, 0);
  const numCount = Object.values(board.numbers).reduce((a, b) => a + b, 0);
  let strictCount = 0;
  const redHist = {}, degreeHist = {};

  for (let s = 1; s <= N; s++) {
    let m;
    try { m = Catan.generate(s, mode); } catch (e) { fail(mode, s, e.message); continue; }
    const { geo, resources, numbers, harbours, robberHex, strict } = m;
    const byId = Object.fromEntries(geo.hexes.map((h) => [h.id, h]));
    if (strict) strictCount++;

    // 1. hex count + resource multiset
    if (geo.hexes.length !== totalHex) fail(mode, s, `hex count ${geo.hexes.length} want ${totalHex}`);
    const rc = {};
    for (const h of geo.hexes) rc[resources[h.id]] = (rc[resources[h.id]] || 0) + 1;
    for (const k of Object.keys(board.resources))
      if ((rc[k] || 0) !== board.resources[k]) fail(mode, s, `resource ${k}=${rc[k]||0} want ${board.resources[k]}`);

    // 2. adjacency symmetric + degree sane
    for (const h of geo.hexes) {
      degreeHist[h.adj.length] = (degreeHist[h.adj.length] || 0) + 1;
      if (h.adj.length < 2 || h.adj.length > 6) fail(mode, s, `hex ${h.id} degree ${h.adj.length}`);
      for (const nb of h.adj) if (!byId[nb].adj.includes(h.id)) fail(mode, s, `adjacency asym ${h.id}<->${nb}`);
    }

    // 3. no two identical resources adjacent
    for (const h of geo.hexes)
      for (const nb of h.adj)
        if (nb > h.id && resources[nb] === resources[h.id])
          fail(mode, s, `same resource adjacent ${resources[h.id]} (${h.id},${nb})`);

    // 4. numbers: count, distribution, only on non-desert
    if (Object.keys(numbers).length !== numCount) fail(mode, s, `placed ${Object.keys(numbers).length} want ${numCount}`);
    const nc = {};
    for (const [id, n] of Object.entries(numbers)) {
      if (resources[id] === "desert") fail(mode, s, `number on desert ${id}`);
      nc[n] = (nc[n] || 0) + 1;
    }
    for (const [n, c] of Object.entries(board.numbers))
      if ((nc[n] || 0) !== c) fail(mode, s, `number ${n}=${nc[n]||0} want ${c}`);

    // 5. no two reds (6/8) adjacent
    for (const h of geo.hexes) {
      const n = numbers[h.id];
      if (n == null || !isRed(n)) continue;
      for (const nb of h.adj)
        if (nb > h.id && isRed(numbers[nb])) fail(mode, s, `reds adjacent (${h.id},${nb})`);
    }

    // 6. reds spread: <= 2 per resource type
    const reds = {};
    for (const h of geo.hexes) if (isRed(numbers[h.id])) reds[resources[h.id]] = (reds[resources[h.id]] || 0) + 1;
    const maxRed = Math.max(0, ...Object.values(reds));
    redHist[maxRed] = (redHist[maxRed] || 0) + 1;
    if (maxRed > 2) fail(mode, s, `resource has ${maxRed} reds`);

    // 7. harbours: correct count, distinct coast edges, correct multiset
    if (harbours.length !== board.harbors.length) fail(mode, s, `harbours ${harbours.length}`);
    const edgeKeys = new Set(harbours.map((h) => `${h.edge.mid.x.toFixed(1)},${h.edge.mid.y.toFixed(1)}`));
    if (edgeKeys.size !== board.harbors.length) fail(mode, s, `harbour edges not distinct`);
    if (harbours.map((h) => h.type).sort().join() !== board.harbors.slice().sort().join())
      fail(mode, s, `harbour types wrong`);
    for (const h of harbours) if (h.edge.hex.adj.length === 6) fail(mode, s, `harbour on interior hex`);

    // 8. robber on a desert
    if (resources[robberHex] !== "desert") fail(mode, s, `robber not on desert`);

    // 9. determinism
    const m2 = Catan.generate(s, mode);
    if (JSON.stringify(m2.resources) !== JSON.stringify(resources) ||
        JSON.stringify(m2.numbers) !== JSON.stringify(numbers) || m2.robberHex !== robberHex)
      fail(mode, s, "non-deterministic");
  }

  console.log(`\n[${mode}] ${N} seeds · ${totalHex} hexes · ${numCount} numbers · ${board.harbors.length} harbors`);
  console.log(`  strict layouts: ${strictCount}/${N} (${(100*strictCount/N).toFixed(1)}%)`);
  console.log(`  hex-degree:`, degreeHist, ` max-reds/resource:`, redHist);
}

runMode("base");
runMode("extension");
console.log(failures === 0 ? "\n✅ ALL CONSTRAINTS HELD (both modes)" : `\n❌ ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
