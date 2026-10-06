/*
 * AirDeco solver — zero-dimensional gas dynamics of rapid and explosive
 * decompression of multi-compartment pressurized aircraft, with passive and
 * active (blowout panel) intercompartment venting.
 *
 * Formulation: A. Pagani, E. Carrera, "Gasdynamics of rapid and explosive
 * decompressions of pressurized aircraft including active venting",
 * Advances in Aircraft and Spacecraft Science 3(1), 77-93, 2016.
 *
 *   Mass balance (Eqs. 1, 6, 7)      dρ_i/dt = (ṁ_in − ṁ_out) / V_i
 *   Choked orifice flow (Eq. 4)      ṁ* = ρ_i (2/(γ+1))^(1/(γ−1)) A_eff √(2γRT_i/(γ+1))
 *   Subcritical orifice flow (Eq. 5) ṁ  = A_eff √(2 p_i ρ_i γ/(γ−1) [(p_j/p_i)^(2/γ) − (p_j/p_i)^((γ+1)/γ)])
 *   Compartment state (Eq. 8)        T/T⁰ = (p/p⁰)^((n−1)/n) = (ρ/ρ⁰)^(n−1),  n = γ (isentropic)
 *   Hinged panel (Eq. 12, 13)        θ'' = 3 Δp A_p cos²θ / (2 m_p b),  A_open = A_p (1 − cos θ)
 *   Translational panel (Eq. 15, 16) x''  = Δp A_p / m_p,  A_open = min[2 (A_p/b + b) x, A_p]
 *   Time integration (Eqs. 17, 18)   explicit Euler
 *
 * Works as a browser global (window.AirDecoSolver) and as a CommonJS module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AirDecoSolver = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const G0 = 9.80665;
  const R_ISA = 287.053;

  /* ---------- International Standard Atmosphere (0–32 km) ---------- */
  function isa(h) {
    h = Math.max(-610, Math.min(h, 32000));
    let T, p;
    if (h <= 11000) {
      T = 288.15 - 0.0065 * h;
      p = 101325 * Math.pow(T / 288.15, G0 / (R_ISA * 0.0065));
    } else if (h <= 20000) {
      T = 216.65;
      p = 22632.06 * Math.exp(-G0 / (R_ISA * T) * (h - 11000));
    } else {
      T = 216.65 + 0.001 * (h - 20000);
      p = 5474.889 * Math.pow(T / 216.65, -G0 / (R_ISA * 0.001));
    }
    return { T, p, rho: p / (R_ISA * T) };
  }

  /* Pressure altitude (m) for a static pressure (Pa). */
  function pressureAltitude(p) {
    if (p >= 22632.06) return (288.15 / 0.0065) * (1 - Math.pow(p / 101325, (R_ISA * 0.0065) / G0));
    if (p >= 5474.889) return 11000 - Math.log(p / 22632.06) * (R_ISA * 216.65) / G0;
    return 20000 + (216.65 / 0.001) * (Math.pow(p / 5474.889, -(R_ISA * 0.001) / G0) - 1);
  }

  /* ---------- Orifice mass flow (Eqs. 2–5) ---------- */
  function makeFlow(gamma, R) {
    const rCrit = Math.pow(2 / (gamma + 1), gamma / (gamma - 1)); // p_j/p_i* = 1/1.893
    const chokeK = Math.pow(2 / (gamma + 1), 1 / (gamma - 1));
    const chokeT = (2 * gamma * R) / (gamma + 1);
    const subK = (2 * gamma) / (gamma - 1);
    const e1 = 2 / gamma, e2 = (gamma + 1) / gamma, eM = (gamma - 1) / gamma;
    /* Returns [ṁ ≥ 0 from upstream to downstream, choked flag, throat Mach]. */
    return function flow(pu, rhou, Tu, pd, Aeff, out) {
      if (Aeff <= 0 || pu <= pd) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
      const r = pd / pu;
      if (r <= rCrit) {
        out[0] = rhou * chokeK * Aeff * Math.sqrt(chokeT * Tu);
        out[1] = 1; out[2] = 1;
      } else {
        out[0] = Aeff * Math.sqrt(subK * pu * rhou * (Math.pow(r, e1) - Math.pow(r, e2)));
        out[1] = 0;
        out[2] = Math.sqrt(Math.max(0, (2 / (gamma - 1)) * (Math.pow(r, -eM) - 1)));
      }
      return out;
    };
  }

  /* ---------- Panel open area ---------- */
  function hingedOpenArea(v, theta) { return v.Ap * (1 - Math.cos(theta)); }
  function translationalOpenArea(v, x) { return Math.min(2 * (v.Ap / v.b + v.b) * x, v.Ap); }

  /*
   * Normalise a model description (see README) into solver form.
   * Units: SI (Pa, K, m, m², m³, kg, s).
   */
  function prepare(model) {
    const gamma = model.gamma || 1.4;
    const R = model.R || 287;
    let n = gamma;
    if (model.thermo === 'polytropic') n = model.polyN || 1.16;
    else if (model.thermo === 'isothermal') n = 1;
    const comps = model.compartments.map((c, i) => {
      const p0 = c.p0 != null ? c.p0 : model.cabin.p0;
      const T0 = c.T0 != null ? c.T0 : model.cabin.T0;
      return { idx: i, name: c.name || ('C' + (i + 1)), V: c.V, p0, T0, rho0: p0 / (R * T0), inflow: c.inflow || 0 };
    });
    const vents = model.vents.map((v, k) => {
      const type = v.type || 'passive';
      const o = {
        idx: k, name: v.name || ('V' + (k + 1)), type,
        a: v.a, b_: v.b == null ? -1 : v.b,
        Cd: v.Cd == null ? 1 : v.Cd,
        tOpen: v.tOpen || 0,
        wallArea: v.wallArea || 0,
      };
      if (type === 'passive') {
        o.A = v.A;
      } else {
        o.b = v.pb;               // panel dimension perpendicular to hinge / one side (m)
        o.w = v.pw;               // other side (m)
        o.Ap = v.pb * v.pw;
        o.A = o.Ap;
        o.mass = v.mass;
        o.prel = v.prel;
        o.dir = v.dir || 'ab';    // 'ab' : opens when p_a − p_b > p_rel ; 'ba' ; 'both'
        o.thetaMax = (v.thetaMax == null ? 90 : v.thetaMax) * Math.PI / 180;
      }
      return o;
    });
    return {
      gamma, R, n, comps, vents,
      pa: model.ambient.p, Ta: model.ambient.T,
      dt: model.dt || 50e-6,
      tEnd: model.tEnd || 5,
      autoStop: model.autoStop !== false,
      eqTol: model.eqTol || 1e-4,
      maxPoints: model.maxPoints || 16000,
    };
  }

  /*
   * Run the simulation.
   * Returns { t, comp: {p,T,rho,m}[], vent: {mdot,A,dp,mach,pos}[], summary }
   */
  function simulate(model, onProgress) {
    const S = prepare(model);
    const { gamma, R, n, comps, vents, pa, Ta, dt } = S;
    const N = comps.length, M = vents.length;
    if (!N) throw new Error('Define at least one compartment.');
    comps.forEach((c) => {
      if (!(c.V > 0)) throw new Error(`Compartment "${c.name}" needs a positive volume.`);
      if (!(c.p0 > 0) || !(c.T0 > 0)) throw new Error(`Compartment "${c.name}" needs a positive initial pressure and temperature.`);
    });
    vents.forEach((v) => {
      if (!(v.a >= 0 && v.a < N)) throw new Error(`Vent "${v.name}": side A is not a valid compartment.`);
      if (v.b_ >= N) throw new Error(`Vent "${v.name}": side B is not a valid compartment.`);
      if (v.a === v.b_) throw new Error(`Vent "${v.name}" connects a compartment to itself.`);
      if (!(v.A > 0)) throw new Error(`Vent "${v.name}" needs a positive area.`);
      if (v.type !== 'passive' && v.type !== 'instant' && !(v.mass > 0)) throw new Error(`Panel "${v.name}" needs a positive mass.`);
    });
    const rhoA = pa / (R * Ta);
    const flow = makeFlow(gamma, R);
    const fo = [0, 0, 0];

    /* State */
    const rho = Float64Array.from(comps, (c) => c.rho0);
    const p = new Float64Array(N), T = new Float64Array(N), dm = new Float64Array(N);
    const pos = new Float64Array(M), vel = new Float64Array(M);
    const released = new Uint8Array(M), sense = new Float64Array(M).fill(1);
    const tRelease = new Float64Array(M).fill(NaN), tFull = new Float64Array(M).fill(NaN);
    const mdot = new Float64Array(M), Aeff = new Float64Array(M), dpv = new Float64Array(M), mach = new Float64Array(M);
    const choked = new Uint8Array(M);

    /* Storage with progressive 2:1 decimation */
    const cap = S.maxPoints;
    const nCh = 1 + 4 * N + 5 * M;
    let buf = new Float64Array(cap * nCh), stored = 0, stride = 1;
    function store(t, step) {
      if (step % stride !== 0) return;
      if (stored >= cap) {
        for (let r = 0; r < cap / 2; r++) buf.copyWithin(r * nCh, 2 * r * nCh, 2 * r * nCh + nCh);
        stored = cap / 2; stride *= 2;
        if (step % stride !== 0) return;
      }
      let o = stored * nCh;
      buf[o++] = t;
      for (let i = 0; i < N; i++) { buf[o++] = p[i]; buf[o++] = T[i]; buf[o++] = rho[i]; buf[o++] = rho[i] * comps[i].V; }
      for (let k = 0; k < M; k++) { buf[o++] = mdot[k]; buf[o++] = Aeff[k]; buf[o++] = dpv[k]; buf[o++] = mach[k]; buf[o++] = pos[k]; }
      stored++;
    }

    /* Peaks and timings */
    const pairMax = []; // all compartment pairs i<j : max and min of p_i − p_j
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) pairMax.push({ i, j, max: 0, tMax: 0, min: 0, tMin: 0 });
    const cs = comps.map(() => ({ pMin: Infinity, pMax: -Infinity, TMin: Infinity, TMax: -Infinity, rhoMin: Infinity, dpdtMin: 0, tdpdtMin: 0, tEq: NaN, tPeakAlt: 0 }));
    const vs = vents.map(() => ({ dpMax: 0, tdpMax: 0, dpMin: 0, tdpMin: 0, mdotMax: 0, tMdotMax: 0, machMax: 0, tChokeStart: NaN, tChokeEnd: NaN, chokedTime: 0, massThrough: 0, tFirstFlow: NaN }));
    const pRef = Math.max(...comps.map((c) => c.p0));
    const pScale = Math.max(Math.abs(pRef - pa), 1);
    let tEqAll = NaN, tAllSubcritical = NaN;
    const pStarAmb = Math.pow((gamma + 1) / 2, gamma / (gamma - 1)) * pa; // Eq. (3): p* = 1.893 p_a
    const pPrev = new Float64Array(N);

    const nMax = Math.ceil(S.tEnd / dt);
    const tHardMax = S.tEnd;
    let t = 0, step = 0, stopReason = 'end time reached';
    let tStopAfter = Infinity;
    const progressEvery = Math.max(1, Math.floor(nMax / 50));

    for (; ; step++) {
      t = step * dt;
      /* Thermodynamic state from density (Eq. 8) */
      for (let i = 0; i < N; i++) {
        const c = comps[i];
        if (rho[i] < 1e-9) rho[i] = 1e-9;
        const r = rho[i] / c.rho0;
        p[i] = c.p0 * Math.pow(r, n);
        T[i] = c.T0 * Math.pow(r, n - 1);
        dm[i] = c.inflow;
      }

      /* Vent areas and flows */
      for (let k = 0; k < M; k++) {
        const v = vents[k];
        const ia = v.a, ib = v.b_;
        const pA = p[ia], pB = ib < 0 ? pa : p[ib];
        dpv[k] = pA - pB;
        let A = 0;
        if (v.type === 'passive') A = t >= v.tOpen ? v.A : 0;
        else if (v.type === 'instant') A = released[k] ? v.Ap : 0;
        else if (v.type === 'hinged') A = released[k] ? hingedOpenArea(v, pos[k]) : 0;
        else if (v.type === 'translational') A = released[k] ? translationalOpenArea(v, pos[k]) : 0;
        Aeff[k] = A * v.Cd;
        let m = 0;
        if (Aeff[k] > 0) {
          if (pA >= pB) {
            flow(pA, rho[ia], T[ia], pB, Aeff[k], fo);
            m = fo[0];
          } else {
            const rB = ib < 0 ? rhoA : rho[ib], TB = ib < 0 ? Ta : T[ib];
            flow(pB, rB, TB, pA, Aeff[k], fo);
            m = -fo[0];
          }
          choked[k] = fo[1]; mach[k] = fo[2];
          /* Limiter: never transfer more than half the mass that would equalise the pair in one step */
          const dpdmA = (n * pA) / (rho[ia] * comps[ia].V);
          const dpdmB = ib < 0 ? 0 : (n * pB) / (rho[ib] * comps[ib].V);
          const mEq = Math.abs(pA - pB) / (dpdmA + dpdmB) / dt * 0.5;
          if (Math.abs(m) > mEq) m = Math.sign(m) * mEq;
        } else { choked[k] = 0; mach[k] = 0; }
        mdot[k] = m;
        dm[ia] -= m;
        if (ib >= 0) dm[ib] += m;
      }

      /* Record & peaks */
      store(t, step);
      for (let i = 0; i < N; i++) {
        const s = cs[i];
        if (p[i] < s.pMin) s.pMin = p[i];
        if (p[i] > s.pMax) s.pMax = p[i];
        if (T[i] < s.TMin) s.TMin = T[i];
        if (T[i] > s.TMax) s.TMax = T[i];
        if (rho[i] < s.rhoMin) s.rhoMin = rho[i];
        if (step > 0) {
          const d = (p[i] - pPrev[i]) / dt;
          if (d < s.dpdtMin) { s.dpdtMin = d; s.tdpdtMin = t; }
        }
        pPrev[i] = p[i];
        if (isNaN(s.tEq) && p[i] - pa <= S.eqTol * pScale) s.tEq = t;
      }
      for (const q of pairMax) {
        const d = p[q.i] - p[q.j];
        if (d > q.max) { q.max = d; q.tMax = t; }
        if (d < q.min) { q.min = d; q.tMin = t; }
      }
      for (let k = 0; k < M; k++) {
        const s = vs[k];
        if (dpv[k] > s.dpMax) { s.dpMax = dpv[k]; s.tdpMax = t; }
        if (dpv[k] < s.dpMin) { s.dpMin = dpv[k]; s.tdpMin = t; }
        if (Math.abs(mdot[k]) > Math.abs(s.mdotMax)) { s.mdotMax = mdot[k]; s.tMdotMax = t; }
        if (mach[k] > s.machMax) s.machMax = mach[k];
        if (choked[k]) {
          if (isNaN(s.tChokeStart)) s.tChokeStart = t;
          s.tChokeEnd = t + dt; s.chokedTime += dt;
        }
        if (isNaN(s.tFirstFlow) && mdot[k] !== 0) s.tFirstFlow = t;
        s.massThrough += mdot[k] * dt;
      }
      let anySuper = false;
      for (let i = 0; i < N; i++) if (p[i] >= pStarAmb) anySuper = true;
      if (anySuper) tAllSubcritical = NaN; else if (isNaN(tAllSubcritical)) tAllSubcritical = t;
      if (isNaN(tEqAll) && cs.every((s) => !isNaN(s.tEq)) && cs.every((s, i) => p[i] - pa <= S.eqTol * pScale)) {
        tEqAll = t;
        if (S.autoStop) tStopAfter = t * 1.08 + 0.02;
      }

      if (t >= tHardMax - 1e-12) break;
      if (t >= tStopAfter) { stopReason = 'pressures equalised with ambient'; break; }
      if (onProgress && step % progressEvery === 0) onProgress(t / tHardMax);

      /* Euler update of density (Eq. 17) */
      for (let i = 0; i < N; i++) rho[i] += (dm[i] / comps[i].V) * dt;

      /* Blowout panel dynamics (Eqs. 12, 15, 18) */
      for (let k = 0; k < M; k++) {
        const v = vents[k];
        if (v.type === 'passive') continue;
        if (!released[k]) {
          const d = dpv[k];
          let go = false;
          if ((v.dir === 'ab' || v.dir === 'both') && d > v.prel) { go = true; sense[k] = 1; }
          else if ((v.dir === 'ba' || v.dir === 'both') && -d > v.prel) { go = true; sense[k] = -1; }
          if (go) {
            released[k] = 1; tRelease[k] = t;
            if (v.type === 'instant') { tFull[k] = t; }
          }
          continue;
        }
        if (v.type === 'instant') continue;
        const dpo = sense[k] * dpv[k]; // pressure differential in the opening direction
        let acc, posMax;
        if (v.type === 'hinged') {
          const c = Math.cos(pos[k]);
          acc = (3 * dpo * v.Ap * c * c) / (2 * v.mass * v.b);
          posMax = v.thetaMax;
        } else {
          acc = (dpo * v.Ap) / v.mass;
          posMax = v.Ap / (2 * (v.Ap / v.b + v.b)); // displacement at which the swept area equals A_p
        }
        pos[k] += vel[k] * dt;
        vel[k] += acc * dt;
        if (pos[k] >= posMax) {
          if (v.type === 'hinged') { pos[k] = posMax; vel[k] = Math.min(vel[k], 0); }
          if (isNaN(tFull[k])) tFull[k] = t + dt;
        }
        if (pos[k] < 0) { pos[k] = 0; vel[k] = Math.max(vel[k], 0); }
      }
    }
    if (onProgress) onProgress(1);

    /* Unpack stored series */
    const nPts = stored;
    const tArr = new Float64Array(nPts);
    const compOut = comps.map(() => ({ p: new Float64Array(nPts), T: new Float64Array(nPts), rho: new Float64Array(nPts), m: new Float64Array(nPts) }));
    const ventOut = vents.map(() => ({ mdot: new Float64Array(nPts), A: new Float64Array(nPts), dp: new Float64Array(nPts), mach: new Float64Array(nPts), pos: new Float64Array(nPts) }));
    for (let r = 0; r < nPts; r++) {
      let o = r * nCh;
      tArr[r] = buf[o++];
      for (let i = 0; i < N; i++) { const c = compOut[i]; c.p[r] = buf[o++]; c.T[r] = buf[o++]; c.rho[r] = buf[o++]; c.m[r] = buf[o++]; }
      for (let k = 0; k < M; k++) { const v = ventOut[k]; v.mdot[r] = buf[o++]; v.A[r] = buf[o++]; v.dp[r] = buf[o++]; v.mach[r] = buf[o++]; v.pos[r] = buf[o++]; }
    }

    /* Summary */
    const ambientVents = vents.filter((v) => v.b_ < 0).map((v) => v.idx);
    let tChokedBreach = 0;
    ambientVents.forEach((k) => { if (!isNaN(vs[k].tChokeEnd)) tChokedBreach = Math.max(tChokedBreach, vs[k].tChokeEnd); });
    /* Supercritical phase as in the paper: until every compartment is below p* = 1.893 p_a */
    const tSup = isNaN(tAllSubcritical) ? t : tAllSubcritical;
    const summary = {
      steps: step, tFinal: t, stopReason, nPoints: nPts,
      thermoExponent: n,
      criticalRatio: Math.pow((gamma + 1) / 2, gamma / (gamma - 1)),
      tEqualised: tEqAll,
      pStar: pStarAmb,
      tSupercritical: ambientVents.length ? tSup : NaN,
      supercriticalEnded: !isNaN(tAllSubcritical),
      tSubcritical: !isNaN(tEqAll) && ambientVents.length ? tEqAll - tSup : NaN,
      tChokedBreach: ambientVents.length ? tChokedBreach : NaN,
      compartments: comps.map((c, i) => ({
        name: c.name, V: c.V, p0: c.p0, T0: c.T0, rho0: c.rho0, m0: c.rho0 * c.V,
        pMin: cs[i].pMin, pMax: cs[i].pMax, TMin: cs[i].TMin, TMax: cs[i].TMax, rhoMin: cs[i].rhoMin,
        pFinal: p[i], TFinal: T[i], rhoFinal: rho[i], mFinal: rho[i] * c.V,
        dpdtMin: cs[i].dpdtMin, tdpdtMin: cs[i].tdpdtMin,
        tEq: cs[i].tEq,
        altMax: pressureAltitude(cs[i].pMin),
      })),
      vents: vents.map((v, k) => ({
        name: v.name, type: v.type, a: v.a, b: v.b_,
        Aeff: v.A * v.Cd,
        dpMax: vs[k].dpMax, tdpMax: vs[k].tdpMax, dpMin: vs[k].dpMin, tdpMin: vs[k].tdpMin,
        mdotMax: vs[k].mdotMax, tMdotMax: vs[k].tMdotMax, machMax: vs[k].machMax,
        chokedTime: vs[k].chokedTime, tChokeStart: vs[k].tChokeStart, tChokeEnd: vs[k].tChokeEnd,
        massThrough: vs[k].massThrough,
        tRelease: tRelease[k], tFull: tFull[k],
        openingTime: tFull[k] - tRelease[k],
        loadMax: v.wallArea ? Math.max(Math.abs(vs[k].dpMax), Math.abs(vs[k].dpMin)) * v.wallArea : NaN,
        wallArea: v.wallArea,
      })),
      pairs: pairMax.map((q) => ({ i: q.i, j: q.j, max: q.max, tMax: q.tMax, min: q.min, tMin: q.tMin })),
    };

    /* Closed-form supercritical duration for a single chamber (isentropic, Daidzic & Simones 2010) */
    if (N === 1 && ambientVents.length === 1 && M === 1 && n === gamma) {
      const c = comps[0], v = vents[0];
      const Ae = v.A * v.Cd;
      const c0 = Math.sqrt(gamma * R * c.T0);
      const K = (Ae / c.V) * Math.pow(2 / (gamma + 1), (gamma + 1) / (2 * (gamma - 1))) * c0;
      const pStar = summary.criticalRatio * pa;
      summary.analyticSupercritical = c.p0 > pStar
        ? (2 / (K * (gamma - 1))) * (Math.pow(c.p0 / pStar, (gamma - 1) / (2 * gamma)) - 1) : 0;
    }

    return { t: tArr, comp: compOut, vent: ventOut, summary, model: S };
  }

  return { simulate, isa, pressureAltitude, makeFlow, prepare };
});
