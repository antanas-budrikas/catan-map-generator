# Catan Map Generator

A phone-native random board generator for **Catan** — base game (19 hexes) and the
**5–6 Player Extension** (30 hexes). Generates fair, balanced, constraint-checked
islands you can re-roll instantly and share by link.

**Play:** open the hosted page on your phone and tap **Re-roll**.

## Balance rules

Every generated board satisfies:

- No two identical resources adjacent (no resource clumping, no touching deserts).
- No two red numbers (6 / 8) adjacent.
- Red numbers spread across resource types (≤ 2 per type).
- Soft balancing: identical numbers avoided as neighbours; pips evened out per resource.
- Deserts placed at random; robber starts on a random desert.
- 11 harbours (extension) / 9 (base) spaced around the coast — port types shuffled or fixed.

## Options

- **Board:** Base game (3–4 players) or 5–6 Extension.
- **Ocean frame:** sea surround + coastal ports (visual).
- **Mix ports:** shuffle port types vs. a fixed alternating layout.
- Every board is reproducible via the `?seed=…&mode=…&mix=…` URL.

## Files

| File | Role |
|------|------|
| `index.html` | Phone-native viewer (pointy-top board, storybook tiles, 3D tokens). |
| `catan-logic.js` | Pure generation engine (no DOM) — geometry, constraints, both board modes. |
| `test-logic.js` | Node validation harness. `node test-logic.js` checks every constraint over 1000 seeds × both modes. |

## Develop

```bash
node test-logic.js        # validate the generator
python3 -m http.server    # then open http://localhost:8000
```

Unofficial fan-made tool. Not affiliated with CATAN GmbH.
