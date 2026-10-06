/*
 * AirDeco configuration helpers and benchmark presets.
 *
 * A "config" is what the user edits in the interface (engineering units:
 * kPa, °C, m, m², m³, kg, ms). toModel() converts it into the SI model
 * consumed by AirDecoSolver.simulate().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./airdeco-solver.js'));
  else root.AirDecoModel = factory(root.AirDecoSolver);
})(typeof self !== 'undefined' ? self : this, function (Solver) {
  'use strict';

  const K0 = 273.15;

  function ambientState(cfg) {
    const a = cfg.ambient;
    if (a.mode === 'isa') {
      const s = Solver.isa(a.alt_m);
      return { p: s.p, T: s.T + (a.dISA || 0) };
    }
    return { p: a.p_kPa * 1e3, T: a.T_C + K0 };
  }

  function cabinState(cfg, amb) {
    const c = cfg.cabin;
    let p;
    if (c.mode === 'alt') p = Solver.isa(c.alt_m).p;
    else if (c.mode === 'dp') p = amb.p + c.dp_kPa * 1e3;
    else p = c.p_kPa * 1e3;
    return { p0: p, T0: c.T_C + K0 };
  }

  function toModel(cfg) {
    const amb = ambientState(cfg);
    const cab = cabinState(cfg, amb);
    const num = cfg.numerics || {};
    return {
      gamma: cfg.gamma || 1.4,
      R: cfg.R || 287,
      thermo: cfg.thermo || 'isentropic',
      polyN: cfg.polyN || 1.16,
      ambient: amb,
      cabin: cab,
      dt: (num.dt_us || 50) * 1e-6,
      tEnd: num.tEnd_s || 5,
      autoStop: num.autoStop !== false,
      eqTol: num.eqTol || 1e-4,
      maxPoints: num.maxPoints || 16000,
      compartments: cfg.compartments.map((c) => ({
        name: c.name,
        V: +c.V,
        p0: c.p0_kPa != null && c.p0_kPa !== '' ? c.p0_kPa * 1e3 : null,
        T0: c.T0_C != null && c.T0_C !== '' ? +c.T0_C + K0 : null,
        inflow: +c.inflow || 0,
      })),
      vents: cfg.vents.map((v) => ({
        name: v.name,
        type: v.type,
        a: +v.a,
        b: +v.b,
        A: +v.A,
        Cd: v.Cd == null ? 1 : +v.Cd,
        tOpen: (+v.tOpen_ms || 0) * 1e-3,
        pb: +v.pb, pw: +v.pw,
        mass: +v.mass,
        prel: (+v.prel_kPa || 0) * 1e3,
        dir: v.dir || 'ab',
        thetaMax: v.thetaMax == null ? 90 : +v.thetaMax,
        wallArea: +v.wallArea || 0,
      })),
    };
  }

  /* Pressure altitude helper in m for a value in kPa */
  function altitudeOf(p_kPa) { return Solver.pressureAltitude(p_kPa * 1e3); }

  const comp = (name, V, deck, x0, x1, extra) => Object.assign({ name, V, deck, x0, x1, p0_kPa: null, T0_C: null, inflow: 0 }, extra || {});
  const passive = (name, a, b, A, Cd, extra) => Object.assign({ name, type: 'passive', a, b, A, Cd, tOpen_ms: 0, pb: 0.5, pw: 0.5, mass: 5, prel_kPa: 5, dir: 'ab', thetaMax: 90, wallArea: 0 }, extra || {});
  const panel = (name, type, a, b, pb, pw, mass, prel_kPa, Cd, extra) => Object.assign({ name, type, a, b, A: pb * pw, Cd, tOpen_ms: 0, pb, pw, mass, prel_kPa, dir: 'ab', thetaMax: 90, wallArea: 0 }, extra || {});

  const presets = [
    {
      id: 'four',
      title: 'Four-compartment aircraft',
      source: 'Pagani & Carrera (2016), §5.4',
      description: 'Breach in the entryway at 9980 m. Passive door to the cabin, a hinged blowout panel to the cockpit and translational floor panels to the cargo hold.',
      ambient: { mode: 'isa', alt_m: 9980, dISA: 0, p_kPa: 26.5, T_C: -49.85 },
      cabin: { mode: 'abs', p_kPa: 89.786, alt_m: 1000, dp_kPa: 63.3, T_C: 23 },
      thermo: 'isentropic', polyN: 1.16, gamma: 1.4, R: 287,
      numerics: { dt_us: 50, tEnd_s: 6, autoStop: true, eqTol: 1e-4 },
      compartments: [
        comp('Cockpit', 4, 'main', 0, 14),
        comp('Entryway', 3, 'main', 14, 24),
        comp('Passenger cabin', 198, 'main', 24, 100),
        comp('Cargo', 67, 'lower', 14, 100),
      ],
      vents: [
        passive('Entryway breach', 1, -1, 0.6, 0.8),
        passive('Entry–cabin passage', 1, 2, 0.9, 0.7, { pb: 1.8, pw: 0.5 }),
        panel('Cockpit door panel', 'hinged', 0, 1, 0.4, 0.4, 4.32, 6, 0.7, { dir: 'both' }),
        panel('Cargo–cockpit panel', 'translational', 3, 0, 0.3, 0.3, 2.43, 4, 0.7, { dir: 'both' }),
        panel('Cargo–entryway panel', 'translational', 3, 1, 0.3, 0.3, 2.43, 4, 0.7, { dir: 'both' }),
        panel('Cargo–cabin panel', 'translational', 3, 2, 0.3, 0.3, 2.43, 4, 0.7, { dir: 'both' }),
      ],
      reference: {
        note: 'Paper values (Tables 3 and 4). Total decompression ≈ 3.74 s, sonic breach outflow for the first 1.43 s.',
        totals: { tSupercritical: 1.43, tEqualised: 3.74 },
        pairs: [[0, 1, 10.89], [2, 1, 10.09], [3, 0, 8.59], [3, 1, 10.87], [3, 2, 4.23]],
        panels: [[2, 3.3, 55.6], [3, 53.9, 27.2], [4, 1.8, 23.2], [5, 186.6, 34]],
      },
    },
    {
      id: 'two-hinged',
      title: 'Two compartments, hinged panel',
      source: 'Pagani & Carrera (2016), §5.3',
      description: 'Cockpit breach of 0.5 m² (C_D = 0.8). A hinged blowout panel in the cockpit bulkhead releases at 12 kPa.',
      ambient: { mode: 'manual', alt_m: 11800, dISA: 0, p_kPa: 19.73975, T_C: -54.65 },
      cabin: { mode: 'abs', p_kPa: 78.959, alt_m: 2000, dp_kPa: 59.2, T_C: 23 },
      thermo: 'isentropic', polyN: 1.16, gamma: 1.4, R: 287,
      numerics: { dt_us: 50, tEnd_s: 4, autoStop: true, eqTol: 1e-4 },
      compartments: [
        comp('Cockpit', 4, 'full', 0, 18),
        comp('Cabin', 60, 'full', 18, 100),
      ],
      vents: [
        passive('Cockpit window breach', 0, -1, 0.5, 0.8),
        panel('Bulkhead blowout panel', 'hinged', 1, 0, 0.5, 0.5, 6.75, 12, 1.0),
      ],
      reference: {
        note: 'Paper values (Table 2, hinged panel).',
        totals: { tSupercritical: 0.726, tEqualised: 1.7555 },
        pairs: [[1, 0, 44.21]],
        panels: [[1, 0, 40.8]],
        panelsFromZero: true,
      },
    },
    {
      id: 'two-trans',
      title: 'Two compartments, translational panel',
      source: 'Pagani & Carrera (2016), §5.3',
      description: 'Same aircraft as the hinged case, with a translational blowout panel of identical size, mass and release pressure.',
      ambient: { mode: 'manual', alt_m: 11800, dISA: 0, p_kPa: 19.73975, T_C: -54.65 },
      cabin: { mode: 'abs', p_kPa: 78.959, alt_m: 2000, dp_kPa: 59.2, T_C: 23 },
      thermo: 'isentropic', polyN: 1.16, gamma: 1.4, R: 287,
      numerics: { dt_us: 50, tEnd_s: 4, autoStop: true, eqTol: 1e-4 },
      compartments: [
        comp('Cockpit', 4, 'full', 0, 18),
        comp('Cabin', 60, 'full', 18, 100),
      ],
      vents: [
        passive('Cockpit window breach', 0, -1, 0.5, 0.8),
        panel('Bulkhead blowout panel', 'translational', 1, 0, 0.5, 0.5, 6.75, 12, 1.0),
      ],
      reference: {
        note: 'Paper values (Table 2, translational panel).',
        totals: { tSupercritical: 0.712, tEqualised: 1.7407 },
        pairs: [[1, 0, 31.14]],
        panels: [[1, 0, 23.9]],
        panelsFromZero: true,
      },
    },
    {
      id: 'three',
      title: 'Three-compartment cabin',
      source: 'Mavriplis (1963), in Pagani & Carrera (2016), §5.2',
      description: 'Cockpit window loss at 9144 m (30 000 ft) with passive vents between cockpit, cargo and cabin. Areas are effective areas.',
      ambient: { mode: 'isa', alt_m: 9144, dISA: 0, p_kPa: 30.1, T_C: -44.4 },
      cabin: { mode: 'dp', p_kPa: 78.7, alt_m: 2000, dp_kPa: 48.608, T_C: 23 },
      thermo: 'isentropic', polyN: 1.16, gamma: 1.4, R: 287,
      numerics: { dt_us: 50, tEnd_s: 6, autoStop: true, eqTol: 1e-4 },
      compartments: [
        comp('Cockpit', 14.72, 'full', 0, 12),
        comp('Cargo', 98.68, 'lower', 12, 100),
        comp('Passenger cabin', 207.9, 'main', 12, 100),
      ],
      vents: [
        passive('Cockpit window', 0, -1, 0.511, 1),
        passive('Cargo–cockpit vent', 1, 0, 0.019, 1),
        passive('Cargo–cabin vent', 1, 2, 0.789, 1),
        passive('Cabin–cockpit door', 2, 0, 1.115, 1),
      ],
      reference: {
        note: 'Paper values: equalisation in 3.16 s, supercritical phase 0.79 s, largest differential 3.77 kPa at about 0.073 s (in Fig. 7 this peak belongs to the cargo–cockpit curve).',
        totals: { tSupercritical: 0.79, tEqualised: 3.16 },
        pairs: [[1, 0, 3.77]],
        panels: [],
      },
    },
    {
      id: 'single',
      title: 'Single chamber',
      source: 'Pagani & Carrera (2016), §5.1',
      description: 'A 4 m³ chamber with a breach giving V/A = 10 m. Classic check against the closed-form isentropic solution.',
      ambient: { mode: 'manual', alt_m: 10000, dISA: 0, p_kPa: 26.4289, T_C: -50 },
      cabin: { mode: 'abs', p_kPa: 117.013, alt_m: 0, dp_kPa: 90.6, T_C: 23 },
      thermo: 'isentropic', polyN: 1.16, gamma: 1.4, R: 287,
      numerics: { dt_us: 5, tEnd_s: 0.5, autoStop: true, eqTol: 1e-4 },
      compartments: [comp('Chamber', 4, 'full', 20, 80)],
      vents: [passive('Breach', 0, -1, 0.4, 1)],
      reference: {
        note: 'Paper values (Table 1) scaled to V/A = 10 m: 3.23, 3.82 and 7.05 ms per metre of V/A.',
        totals: { tSupercritical: 0.0323, tSubcritical: 0.0382, tEqualised: 0.0705 },
        pairs: [],
        panels: [],
      },
    },
  ];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  return { toModel, ambientState, cabinState, altitudeOf, presets, clone };
});
