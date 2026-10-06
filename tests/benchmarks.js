/* Run the paper's benchmark cases and compare with the published values.
 * Usage: node tests/benchmarks.js            */
'use strict';
const Solver = require('../airdeco-solver.js');
const Model = require('../airdeco-model.js');

const pct = (a, b) => (b ? ((a - b) / b * 100).toFixed(1) + '%' : '');
let worst = 0;
function row(label, got, ref, unit) {
  const e = ref ? Math.abs((got - ref) / ref) : 0;
  worst = Math.max(worst, e);
  console.log(`  ${label.padEnd(34)} ${got.toFixed(3).padStart(10)} ${unit.padEnd(4)} paper ${String(ref).padStart(8)}  ${pct(got, ref)}`);
}

for (const pre of Model.presets) {
  const cfg = Model.clone(pre);
  const t0 = Date.now();
  const r = Solver.simulate(Model.toModel(cfg));
  const S = r.summary;
  console.log(`\n${pre.title}  (${S.steps} steps, ${Date.now() - t0} ms, ${S.stopReason})`);
  const ref = pre.reference;
  if (ref.totals.tSupercritical != null) row('supercritical phase', S.tSupercritical, ref.totals.tSupercritical, 's');
  if (ref.totals.tSubcritical != null) row('subcritical phase', S.tSubcritical, ref.totals.tSubcritical, 's');
  if (ref.totals.tEqualised != null) row('total decompression', S.tEqualised, ref.totals.tEqualised, 's');
  if (S.analyticSupercritical != null) row('closed-form supercritical', S.analyticSupercritical, ref.totals.tSupercritical, 's');
  for (const [i, j, v] of ref.pairs) {
    const q = S.pairs.find((q) => (q.i === i && q.j === j) || (q.i === j && q.j === i));
    const val = q.i === i ? q.max : -q.min;
    const tt = q.i === i ? q.tMax : q.tMin;
    row(`peak p${i + 1}-p${j + 1} (at ${(tt * 1e3).toFixed(1)} ms)`, val / 1e3, v, 'kPa');
  }
  for (const p of ref.panels) {
    const v = S.vents[p[0]];
    if (ref.panelsFromZero) row(`${v.name} full open from t=0`, v.tFull * 1e3, p[2], 'ms');
    else {
      row(`${v.name} release`, v.tRelease * 1e3, p[1], 'ms');
      row(`${v.name} opening`, v.openingTime * 1e3, p[2], 'ms');
    }
  }
}
console.log(`\nLargest relative deviation from the paper: ${(worst * 100).toFixed(1)}%`);
const LIMIT = 0.10;
if (worst > LIMIT) { console.error(`FAIL: deviation above ${LIMIT * 100}%`); process.exit(1); }
console.log('PASS');
