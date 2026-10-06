/* AirDeco — interface: inputs, aircraft schematic, charts and result tables. */
(function () {
  'use strict';
  const Solver = window.AirDecoSolver;
  const Model = window.AirDecoModel;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const K0 = 273.15;
  const MAX_COMP = 8, MAX_VENT = 16;
  const STORE_KEY = 'airdeco.config.v1';

  const TYPES = {
    passive: 'Passive opening',
    hinged: 'Hinged blowout panel',
    translational: 'Translational blowout panel',
    instant: 'Ideal vent (instant opening)',
  };
  const DECKS = { main: 'Main deck', lower: 'Lower deck', full: 'Full height' };

  /* ------------------------------------------------------------------ state */
  const S = {
    cfg: null,
    presetId: null,
    result: null,
    stale: true,
    view: null,          // [t0, t1]
    cursor: 0,           // cursor time
    units: { p: 'kPa', alt: 'm' },
    dpMode: 'vents',
    hidden: {},
    tab: 'tComp',
    playing: false,
  };

  /* --------------------------------------------------------------- helpers */
  function getPath(o, path) { return path.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
  function setPath(o, path, v) {
    const ks = path.split('.'); const last = ks.pop();
    const tgt = ks.reduce((a, k) => a[k], o); tgt[last] = v;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmt(v, d) {
    if (v == null || !isFinite(v)) return '–';
    const a = Math.abs(v);
    if (d == null) d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : 4;
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).replace('-', '−');
  }
  function fmtT(t) {
    if (!isFinite(t)) return '–';
    return t < 1 ? fmt(t * 1e3, t < 0.01 ? 2 : 1) + ' ms' : fmt(t, 3) + ' s';
  }
  const P_UNITS = { kPa: 1e-3, psi: 1 / 6894.757, hPa: 1e-2 };
  function pU(pa) { return pa * P_UNITS[S.units.p]; }
  function pLbl() { return S.units.p; }
  function altU(m) { return S.units.alt === 'ft' ? m * 3.28084 : m; }
  function altLbl() { return S.units.alt; }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function seriesColor(i) { return cssVar('--s' + ((i % 8) + 1)); }
  function seriesDash(i) { return i < 8 ? [] : i < 16 ? [6, 4] : [2, 3]; }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._h); toast._h = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function hexToRgb(h) {
    h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(c1, c2, f) {
    const a = hexToRgb(c1), b = hexToRgb(c2);
    const r = a.map((x, i) => Math.round(x + (b[i] - x) * f));
    return { css: `rgb(${r[0]},${r[1]},${r[2]})`, lum: (0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2]) / 255 };
  }
  function compName(i) { return i < 0 ? 'Ambient' : (S.cfg.compartments[i] || {}).name || 'C' + (i + 1); }

  /* ----------------------------------------------------------- persistence */
  function saveLocal() { try { localStorage.setItem(STORE_KEY, JSON.stringify({ cfg: S.cfg, presetId: S.presetId, units: S.units })); } catch (e) { /* storage unavailable */ } }
  function loadLocal() {
    try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.cfg && s.cfg.compartments) return s; } catch (e) { /* ignore */ }
    return null;
  }

  function normalise(cfg) {
    const base = Model.clone(Model.presets[0]);
    cfg.ambient = Object.assign({}, base.ambient, cfg.ambient || {});
    cfg.cabin = Object.assign({}, base.cabin, cfg.cabin || {});
    cfg.numerics = Object.assign({}, base.numerics, cfg.numerics || {});
    ['thermo', 'polyN', 'gamma', 'R'].forEach((k) => { if (cfg[k] == null) cfg[k] = base[k]; });
    cfg.compartments = (cfg.compartments || []).map((c) => Object.assign({ name: 'Compartment', V: 10, deck: 'main', x0: 0, x1: 100, p0_kPa: null, T0_C: null, inflow: 0 }, c));
    cfg.vents = (cfg.vents || []).map((v) => Object.assign({ name: 'Vent', type: 'passive', a: 0, b: -1, A: 0.1, Cd: 1, tOpen_ms: 0, pb: 0.5, pw: 0.5, mass: 5, prel_kPa: 5, dir: 'ab', thetaMax: 90, wallArea: 0 }, v));
    return cfg;
  }

  /* ================================================================ INPUTS */
  function bindStatic() {
    $('#rail').addEventListener('input', onInput);
    $('#rail').addEventListener('change', onInput);
    $$('[data-seg]').forEach((b) => b.addEventListener('click', () => {
      if (getPath(S.cfg, b.dataset.seg) === b.dataset.val) return;
      syncModeFields();
      setPath(S.cfg, b.dataset.seg, b.dataset.val);
      renderStatic(); changed();
    }));
  }

  function parseVal(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') { const v = el.value === '' ? null : parseFloat(el.value); return v; }
    return el.value;
  }

  function onInput(e) {
    const el = e.target;
    const path = el.dataset.bind;
    if (!path) return;
    let v = parseVal(el);
    if (el.type === 'number' && el.dataset.optional !== '1' && (v == null || !isFinite(v))) { el.classList.add('bad'); return; }
    el.classList.remove('bad');
    if (['a', 'b'].includes(path.split('.').pop()) && path.startsWith('vents')) v = parseInt(v, 10);
    setPath(S.cfg, path, v);
    const structural = el.dataset.struct === '1';
    if (structural && e.type === 'change') { renderLists(); }
    else if (path.startsWith('compartments') && path.endsWith('name') && e.type === 'change') renderVentList();
    if (path.startsWith('vents') && /\.(pb|pw|Cd|A|type)$/.test(path)) updateVentDerived(parseInt(path.split('.')[1], 10));
    updateDerived();
    renderSchematic();
    changed(e.type === 'input' ? 600 : 250);
  }

  /* Before switching how ambient or cabin are defined, carry the current state over to every field */
  function syncModeFields() {
    const amb = Model.ambientState(S.cfg);
    const cab = Model.cabinState(S.cfg, amb);
    if (S.cfg.ambient.mode === 'isa') {
      S.cfg.ambient.p_kPa = +(amb.p / 1e3).toFixed(4);
      S.cfg.ambient.T_C = +(amb.T - K0).toFixed(2);
    } else {
      S.cfg.ambient.alt_m = Math.round(Solver.pressureAltitude(amb.p));
      S.cfg.ambient.dISA = +((amb.T - Solver.isa(S.cfg.ambient.alt_m).T).toFixed(2));
    }
    S.cfg.cabin.p_kPa = +(cab.p0 / 1e3).toFixed(3);
    S.cfg.cabin.alt_m = Math.round(Solver.pressureAltitude(cab.p0));
    S.cfg.cabin.dp_kPa = +((cab.p0 - amb.p) / 1e3).toFixed(3);
  }

  function renderStatic() {
    const c = S.cfg;
    $$('[data-seg]').forEach((b) => b.setAttribute('aria-pressed', String(getPath(c, b.dataset.seg) === b.dataset.val)));
    $$('#rail > details:not(#secComp):not(#secVent) [data-bind]').forEach((el) => {
      const v = getPath(c, el.dataset.bind);
      if (el.type === 'checkbox') el.checked = !!v; else if (document.activeElement !== el) el.value = v == null ? '' : v;
    });
    $('#ambIsa').hidden = c.ambient.mode !== 'isa';
    $('#ambMan').hidden = c.ambient.mode !== 'manual';
    $('#w_cabAbs').hidden = c.cabin.mode !== 'abs';
    $('#w_cabAlt').hidden = c.cabin.mode !== 'alt';
    $('#w_cabDp').hidden = c.cabin.mode !== 'dp';
    $('#w_polyN').hidden = c.thermo !== 'polytropic';
    $('#thermoNote').textContent = {
      isentropic: 'Adiabatic, reversible expansion (n = γ). The model of the paper; recommended for explosive (< 0.5 s) and rapid (< 10 s) events.',
      polytropic: 'Compartment state follows p/ρⁿ = const. Haber & Clamann measured n ≈ 1.16 for slower events with wall heat transfer and humidity.',
      isothermal: 'Temperature stays at its initial value (n = 1). A lower bound on the outflow rate, as used by Mavriplis (1963).',
    }[c.thermo];
    updateDerived();
  }

  function updateDerived() {
    const c = S.cfg;
    let amb, cab;
    try { amb = Model.ambientState(c); cab = Model.cabinState(c, amb); } catch (e) { return; }
    const ft = (m) => fmt(m * 3.28084, 0) + ' ft';
    $('#h_alt').textContent = isFinite(c.ambient.alt_m) ? ft(c.ambient.alt_m) : '';
    $('#h_pa').textContent = isFinite(c.ambient.p_kPa) ? 'pressure alt. ' + ft(Solver.pressureAltitude(c.ambient.p_kPa * 1e3)) : '';
    $('#h_calt').textContent = isFinite(c.cabin.alt_m) ? ft(c.cabin.alt_m) : '';
    const rhoA = amb.p / ((c.R || 287) * amb.T);
    const g = c.gamma || 1.4;
    const crit = Math.pow((g + 1) / 2, g / (g - 1));
    $('#h_gamma').textContent = 'p*/p = ' + fmt(crit, 3);
    $('#roAmb').innerHTML = [
      ['p<sub>a</sub>', fmt(amb.p / 1e3, 3) + ' kPa'],
      ['T<sub>a</sub>', fmt(amb.T - K0, 2) + ' °C'],
      ['ρ<sub>a</sub>', fmt(rhoA, 4) + ' kg/m³'],
      ['p* = ' + fmt(crit, 3) + ' p<sub>a</sub>', fmt(crit * amb.p / 1e3, 2) + ' kPa'],
    ].map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
    const calt = Solver.pressureAltitude(cab.p0);
    const okAlt = calt <= 2438.4;
    $('#roCab').innerHTML = [
      ['p<sub>c</sub><sup>0</sup>', fmt(cab.p0 / 1e3, 3) + ' kPa'],
      ['Cabin altitude', fmt(calt, 0) + ' m · ' + ft(calt)],
      ['p<sub>c</sub><sup>0</sup> − p<sub>a</sub>', fmt((cab.p0 - amb.p) / 1e3, 2) + ' kPa'],
      ['p<sub>c</sub><sup>0</sup> / p<sub>a</sub>', fmt(cab.p0 / amb.p, 3)],
      ['ρ<sub>c</sub><sup>0</sup>', fmt(cab.p0 / ((c.R || 287) * cab.T0), 4) + ' kg/m³'],
      ['Initial flow', cab.p0 >= crit * amb.p ? 'supercritical' : 'subcritical'],
    ].map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('') +
      `<div style="grid-column:1/-1"><span class="chip ${okAlt ? 'ok' : 'bad'}">${okAlt ? 'Cabin altitude within' : 'Cabin altitude exceeds'} CS-25 8000 ft limit</span></div>`;
    $('#h_cdp').textContent = '';
    $('#metaFlight').textContent = c.ambient.mode === 'isa' ? `ISA ${fmt(c.ambient.alt_m, 0)} m` : `${fmt(amb.p / 1e3, 2)} kPa`;
    $('#metaCabin').textContent = `${fmt(cab.p0 / 1e3, 2)} kPa · ${fmt(cab.T0 - K0, 0)} °C`;
    $('#metaComp').textContent = `${c.compartments.length} · ${fmt(c.compartments.reduce((s, x) => s + (+x.V || 0), 0), 1)} m³`;
    const nb = c.vents.filter((v) => v.b < 0).length;
    $('#metaVent').textContent = `${nb} breach${nb === 1 ? '' : 'es'} · ${c.vents.length - nb} internal`;
    $('#metaSolver').textContent = `${c.thermo} · Δt ${c.numerics.dt_us} µs`;
    const steps = (c.numerics.tEnd_s || 0) / ((c.numerics.dt_us || 50) * 1e-6);
    $('#h_steps').textContent = `≤ ${fmt(steps, 0)} steps`;
  }

  /* ----- compartment & vent lists ----- */
  function numField(label, unit, path, val, extra) {
    extra = extra || {};
    const id = 'f_' + path.replace(/\./g, '_');
    return `<label class="field"${extra.wrap ? ` ${extra.wrap}` : ''}><span>${label}${unit ? ` <i>${unit}</i>` : ''}</span>` +
      `<input id="${id}" type="number" step="any" inputmode="decimal" data-bind="${path}" value="${val == null ? '' : val}"${extra.optional ? ' data-optional="1" placeholder="' + esc(extra.placeholder || '') + '"' : ''}${extra.min != null ? ` min="${extra.min}"` : ''}>` +
      `<em class="hint" id="${id}_h">${extra.hint || ''}</em></label>`;
  }
  function selField(label, path, val, opts, struct) {
    const id = 'f_' + path.replace(/\./g, '_');
    return `<label class="field"><span>${label}</span><select id="${id}" data-bind="${path}"${struct ? ' data-struct="1"' : ''}>` +
      opts.map(([v, t]) => `<option value="${v}"${String(v) === String(val) ? ' selected' : ''}>${esc(t)}</option>`).join('') + '</select><em class="hint"></em></label>';
  }

  function renderCompList() {
    const L = $('#compList');
    L.innerHTML = S.cfg.compartments.map((c, i) => `
      <div class="item" id="comp-${i}" data-comp="${i}">
        <div class="item-head">
          <span class="tag" style="background:${seriesColor(i)}">${i + 1}</span>
          <input class="name" id="f_compartments_${i}_name" data-bind="compartments.${i}.name" value="${esc(c.name)}" aria-label="Compartment name">
          <button class="iconbtn" data-delcomp="${i}" title="Remove compartment" aria-label="Remove compartment ${i + 1}">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3 L11 11 M11 3 L3 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="item-body">
          <div class="fields">
            ${numField('Volume', 'm³', `compartments.${i}.V`, c.V, { min: 0 })}
            ${selField('Deck', `compartments.${i}.deck`, c.deck, Object.entries(DECKS))}
            ${numField('Station from', '%', `compartments.${i}.x0`, c.x0)}
            ${numField('Station to', '%', `compartments.${i}.x1`, c.x1)}
          </div>
          <details class="more"><summary>Initial state override &amp; repressurisation</summary>
            <div class="fields">
              ${numField('Initial p', 'kPa', `compartments.${i}.p0_kPa`, c.p0_kPa, { optional: true, placeholder: 'cabin' })}
              ${numField('Initial T', '°C', `compartments.${i}.T0_C`, c.T0_C, { optional: true, placeholder: 'cabin' })}
              ${numField('Supply inflow', 'kg/s', `compartments.${i}.inflow`, c.inflow, { hint: 'pressurisation air' })}
            </div>
          </details>
        </div>
      </div>`).join('');
    $('#addComp').disabled = S.cfg.compartments.length >= MAX_COMP;
  }

  function ventDiagram(type) {
    const ink = 'var(--ink-2)', acc = 'var(--accent)', mut = 'var(--muted)';
    const wall = `<path d="M4 44 H40 M80 44 H112" stroke="${ink}" stroke-width="2"/>`;
    const lbl = (x, y, t) => `<text x="${x}" y="${y}" font-size="9" fill="${mut}" font-family="var(--f-mono)">${t}</text>`;
    let g = '';
    if (type === 'passive') {
      g = `${wall}<path d="M40 40 V48 M80 40 V48" stroke="${ink}" stroke-width="2"/>
        <path d="M60 58 V30" stroke="${acc}" stroke-width="2" marker-end="url(#arrD)"/>${lbl(48, 68, 'C_D·A')}`;
    } else if (type === 'hinged') {
      g = `${wall}<path d="M40 44 L72 22" stroke="${acc}" stroke-width="3" stroke-linecap="round"/>
        <path d="M80 44 A40 40 0 0 0 72 22" fill="none" stroke="${mut}" stroke-dasharray="2 2"/>
        <circle cx="40" cy="44" r="2.5" fill="${ink}"/>${lbl(56, 26, 'b')}${lbl(58, 41, 'θ')}
        <path d="M46 58 V50 M58 58 V50 M70 58 V50" stroke="${mut}" stroke-width="1.2"/>${lbl(52, 68, 'Δp')}`;
    } else if (type === 'translational') {
      g = `${wall}<rect x="42" y="22" width="36" height="5" rx="1" fill="${acc}"/>
        <path d="M42 44 V27 M78 44 V27" stroke="${mut}" stroke-dasharray="2 2"/>
        <path d="M88 44 V24" stroke="${ink}" marker-end="url(#arrD)"/>${lbl(91, 36, 'x')}
        <path d="M48 58 V50 M60 58 V50 M72 58 V50" stroke="${mut}" stroke-width="1.2"/>${lbl(52, 68, 'Δp')}`;
    } else {
      g = `${wall}<path d="M40 44 H80" stroke="${mut}" stroke-dasharray="3 3" stroke-width="2"/>
        <path d="M60 36 L66 44 L60 52 L54 44 Z" fill="${acc}"/>${lbl(38, 68, 'opens at p_rel')}`;
    }
    return `<svg viewBox="0 0 116 72" aria-hidden="true"><defs><marker id="arrD" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="${ink}"/></marker></defs>${g}</svg>`;
  }

  function renderVentList() {
    const N = S.cfg.compartments.length;
    const sideOpts = (withAmb) => (withAmb ? [[-1, 'Ambient (outside)']] : []).concat(S.cfg.compartments.map((c, i) => [i, `${i + 1} · ${c.name}`]));
    $('#ventList').innerHTML = S.cfg.vents.map((v, k) => {
      const isPanel = v.type !== 'passive';
      const p = `vents.${k}`;
      const dirOpts = [['ab', `A → B (p_A − p_B > p_rel)`], ['ba', `B → A`], ['both', 'Either direction']];
      const fields = isPanel ? `
        <div class="fields">
          ${numField(v.type === 'hinged' ? 'Panel chord b' : 'Side b', 'm', p + '.pb', v.pb, { hint: v.type === 'hinged' ? '⊥ hinge line' : '' })}
          ${numField(v.type === 'hinged' ? 'Hinge length' : 'Side w', 'm', p + '.pw', v.pw)}
          ${v.type !== 'instant' ? numField('Panel mass', 'kg', p + '.mass', v.mass) : ''}
          ${numField('Release Δp', 'kPa', p + '.prel_kPa', v.prel_kPa)}
          ${numField('Discharge C_D', '', p + '.Cd', v.Cd)}
          ${v.type === 'hinged' ? numField('Max. angle', '°', p + '.thetaMax', v.thetaMax) : ''}
        </div>
        <div class="fields two">${selField('Opens when', p + '.dir', v.dir, dirOpts)}${numField('Partition area', 'm²', p + '.wallArea', v.wallArea, { hint: 'for load, optional' })}</div>` : `
        <div class="fields">
          ${numField('Area A', 'm²', p + '.A', v.A)}
          ${numField('Discharge C_D', '', p + '.Cd', v.Cd)}
          ${numField('Opens at', 'ms', p + '.tOpen_ms', v.tOpen_ms, { hint: '0 = at breach' })}
          ${v.b >= 0 ? numField('Partition area', 'm²', p + '.wallArea', v.wallArea, { hint: 'for load' }) : ''}
        </div>`;
      return `
      <div class="item" id="vent-${k}" data-vent="${k}">
        <div class="item-head">
          <span class="tag vent"${v.b < 0 ? ' style="color:var(--crit);border-color:var(--crit)"' : ''}>V${k + 1}</span>
          <input class="name" id="f_vents_${k}_name" data-bind="${p}.name" value="${esc(v.name)}" aria-label="Vent name">
          <button class="iconbtn" data-delvent="${k}" title="Remove vent" aria-label="Remove vent ${k + 1}">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3 L11 11 M11 3 L3 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="item-body">
          <div class="vent-grid">
            <div style="display:flex;flex-direction:column;gap:10px;min-width:0">
              <div class="fields two">
                ${selField('Side A', p + '.a', v.a, sideOpts(false), true)}
                ${selField('Side B', p + '.b', v.b, sideOpts(true), true)}
              </div>
              ${selField('Type', p + '.type', v.type, Object.entries(TYPES), true)}
            </div>
            <figure class="diagram" style="margin:0">${ventDiagram(v.type)}<figcaption>${TYPES[v.type]}</figcaption></figure>
          </div>
          ${fields}
        </div>
      </div>`;
    }).join('');
    S.cfg.vents.forEach((v, k) => updateVentDerived(k));
    $('#addVent').disabled = $('#addBreach').disabled = S.cfg.vents.length >= MAX_VENT || N === 0;
  }

  function updateVentDerived(k) {
    const v = S.cfg.vents[k]; if (!v) return;
    const h = $(`#f_vents_${k}_Cd_h`);
    if (!h) return;
    if (v.type === 'passive') h.textContent = `A_eff = ${fmt(v.A * v.Cd, 4)} m²`;
    else {
      const Ap = v.pb * v.pw;
      h.textContent = `A_p ${fmt(Ap, 3)} · eff ${fmt(Ap * v.Cd, 3)} m²`;
    }
  }

  function renderLists() { S.stale = true; renderCompList(); renderVentList(); updateDerived(); renderSchematic(); }

  function bindLists() {
    $('#compList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-delcomp]'); if (!b) return;
      removeComp(+b.dataset.delcomp);
    });
    $('#ventList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-delvent]'); if (!b) return;
      S.cfg.vents.splice(+b.dataset.delvent, 1);
      renderLists(); changed(100);
    });
    $('#addComp').addEventListener('click', () => {
      if (S.cfg.compartments.length >= MAX_COMP) return;
      const n = S.cfg.compartments.length;
      S.cfg.compartments.push({ name: 'Compartment ' + (n + 1), V: 20, deck: 'main', x0: 0, x1: 100, p0_kPa: null, T0_C: null, inflow: 0 });
      autoArrange(); renderLists(); changed(100);
      flashItem('comp', n);
    });
    $('#addVent').addEventListener('click', () => addVent(false));
    $('#addBreach').addEventListener('click', () => addVent(true));
    $('#arrange').addEventListener('click', () => { autoArrange(); renderCompList(); renderSchematic(); toast('Compartments re-arranged along the fuselage'); });
  }

  function addVent(breach) {
    const N = S.cfg.compartments.length;
    if (!N || S.cfg.vents.length >= MAX_VENT) return;
    const k = S.cfg.vents.length;
    if (breach) S.cfg.vents.push({ name: 'Breach ' + (S.cfg.vents.filter((v) => v.b < 0).length + 1), type: 'passive', a: 0, b: -1, A: 0.2, Cd: 0.8, tOpen_ms: 0, pb: 0.5, pw: 0.5, mass: 5, prel_kPa: 5, dir: 'ab', thetaMax: 90, wallArea: 0 });
    else S.cfg.vents.push({ name: 'Vent ' + (k + 1), type: N > 1 ? 'hinged' : 'passive', a: 0, b: N > 1 ? 1 : -1, A: 0.1, Cd: 0.7, tOpen_ms: 0, pb: 0.4, pw: 0.4, mass: 4, prel_kPa: 5, dir: 'both', thetaMax: 90, wallArea: 0 });
    renderLists(); changed(100); flashItem('vent', k);
  }

  function removeComp(i) {
    const c = S.cfg.compartments[i];
    const before = S.cfg.vents.length;
    S.cfg.vents = S.cfg.vents.filter((v) => v.a !== i && v.b !== i).map((v) => Object.assign(v, { a: v.a > i ? v.a - 1 : v.a, b: v.b > i ? v.b - 1 : v.b }));
    S.cfg.compartments.splice(i, 1);
    const removed = before - S.cfg.vents.length;
    renderLists(); changed(100);
    toast(`Removed ${c.name}` + (removed ? ` and ${removed} connected vent${removed > 1 ? 's' : ''}` : ''));
  }

  function autoArrange() {
    const cs = S.cfg.compartments;
    const w = (c) => Math.max(Math.sqrt(Math.max(+c.V || 1, 0.1)), 1);
    let upper = cs.filter((c) => c.deck !== 'lower');
    let lower = cs.filter((c) => c.deck === 'lower');
    if (!upper.length) { upper = lower; lower = []; upper.forEach((c) => { c.deck = 'main'; }); }
    const tot = upper.reduce((s, c) => s + w(c), 0);
    let x = 0;
    upper.forEach((c) => { c.x0 = Math.round(x * 10) / 10; x += (w(c) / tot) * 100; c.x1 = Math.round(x * 10) / 10; });
    if (lower.length) {
      const mains = upper.filter((c) => c.deck === 'main');
      let a = mains.length ? Math.min(...mains.map((c) => c.x0)) : 0, b = mains.length ? Math.max(...mains.map((c) => c.x1)) : 100;
      if (b - a < 20) { a = 0; b = 100; }
      const tl = lower.reduce((s, c) => s + w(c), 0);
      let xx = a;
      lower.forEach((c) => { c.x0 = Math.round(xx * 10) / 10; xx += (w(c) / tl) * (b - a); c.x1 = Math.round(xx * 10) / 10; });
    }
  }

  function flashItem(kind, i) {
    const sec = kind === 'comp' ? $('#secComp') : $('#secVent');
    sec.open = true;
    const el = $(`#${kind}-${i}`); if (!el) return;
    el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400);
  }

  /* ============================================================ SCHEMATIC */
  const HULL = 'M150,78 L870,78 C918,78 958,76 990,79 L992,104 C952,128 902,222 800,222 L150,222 C96,222 54,206 32,172 C21,155 22,140 34,126 C60,96 100,78 150,78 Z';
  const Y_TOP = 78, Y_FLOOR = 168, Y_BOT = 222;
  const sx = (pct) => 72 + (Math.max(0, Math.min(100, pct)) / 100) * 846;

  function compRects() {
    return S.cfg.compartments.map((c) => {
      let x0 = +c.x0, x1 = +c.x1; if (!(x1 > x0)) { x1 = x0 + 5; }
      const y0 = c.deck === 'lower' ? Y_FLOOR : Y_TOP;
      const y1 = c.deck === 'main' ? Y_FLOOR : Y_BOT;
      const X0 = sx(x0), X1 = sx(x1);
      return { x: X0, y: y0, w: X1 - X0, h: y1 - y0, cx: (X0 + X1) / 2, cy: (y0 + y1) / 2 };
    });
  }

  function ventGeometry(rects) {
    const out = [];
    const groups = {};
    S.cfg.vents.forEach((v, k) => {
      const A = rects[v.a];
      if (!A) { out.push(null); return; }
      let g;
      if (v.b < 0 || !rects[v.b]) {
        const lower = S.cfg.compartments[v.a].deck === 'lower';
        g = { kind: 'skin', x: A.cx, y: lower ? Y_BOT : Y_TOP, nx: 0, ny: lower ? 1 : -1, span: [A.x + 10, A.x + A.w - 10], axis: 'x' };
      } else {
        const B = rects[v.b];
        const yo0 = Math.max(A.y, B.y), yo1 = Math.min(A.y + A.h, B.y + B.h);
        const xo0 = Math.max(A.x, B.x), xo1 = Math.min(A.x + A.w, B.x + B.w);
        const touchX = Math.abs(A.x + A.w - B.x) < 2 ? A.x + A.w : Math.abs(B.x + B.w - A.x) < 2 ? A.x : null;
        const touchY = Math.abs(A.y + A.h - B.y) < 2 ? A.y + A.h : Math.abs(B.y + B.h - A.y) < 2 ? A.y : null;
        if (touchX != null && yo1 - yo0 > 6) g = { kind: 'v', x: touchX, y: (yo0 + yo1) / 2, nx: B.cx > touchX ? 1 : -1, ny: 0, span: [yo0 + 12, yo1 - 12], axis: 'y' };
        else if (touchY != null && xo1 - xo0 > 6) g = { kind: 'h', x: (xo0 + xo1) / 2, y: touchY, nx: 0, ny: B.cy > touchY ? 1 : -1, span: [xo0 + 14, xo1 - 14], axis: 'x' };
        else if (touchX != null && touchY != null) {
          const inA = A.w < B.w; const R = inA ? A : B; // put it on the floor of the smaller compartment, next to the corner
          const x = touchX + (R.cx < touchX ? -16 : 16);
          g = { kind: 'h', x, y: touchY, nx: 0, ny: B.cy > touchY ? 1 : -1, span: [x, x], axis: 'x' };
        } else {
          g = { kind: 'link', x: (A.cx + B.cx) / 2, y: (A.cy + B.cy) / 2, nx: B.cx - A.cx, ny: B.cy - A.cy, ax: A.cx, ay: A.cy, bx: B.cx, by: B.cy, span: null };
          const L = Math.hypot(g.nx, g.ny) || 1; g.nx /= L; g.ny /= L;
        }
      }
      const key = v.b < 0 ? `s${v.a}` : g.kind + [Math.min(v.a, v.b), Math.max(v.a, v.b)].join('-');
      (groups[key] = groups[key] || []).push(k);
      out.push(g);
    });
    Object.values(groups).forEach((ks) => {
      if (ks.length < 2) return;
      const g0 = out[ks[0]]; if (!g0.span) return;
      const [s0, s1] = g0.span; const n = ks.length;
      ks.forEach((k, j) => {
        const pos = s1 > s0 ? s0 + ((j + 0.5) / n) * (s1 - s0) : s0 + (j - (n - 1) / 2) * 30;
        if (g0.axis === 'x') out[k].x = pos; else out[k].y = pos;
      });
    });
    return out;
  }

  function stateAt(t) {
    const r = S.result; if (!r) return null;
    const T = r.t; let lo = 0, hi = T.length - 1;
    if (t <= T[0]) return 0; if (t >= T[hi]) return hi;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
    return t - T[lo] < T[hi] - t ? lo : hi;
  }

  function renderSchematic() {
    const svg = $('#schem');
    const rects = compRects();
    const vg = ventGeometry(rects);
    const res = S.result && !S.stale && S.result.comp.length === S.cfg.compartments.length && S.result.vent.length === S.cfg.vents.length ? S.result : null;
    const idx = res ? stateAt(S.cursor) : -1;
    const lo = cssVar('--ramp-lo'), hi = cssVar('--ramp-hi');
    let pMin = 0, pMax = 1;
    if (res) { pMin = res.model.pa; pMax = Math.max(...res.model.comps.map((c) => c.p0)); }
    const parts = [];
    parts.push(`<defs>
      <clipPath id="hullClip"><path d="${HULL}"/></clipPath>
      <marker id="flowArr" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="var(--accent)"/></marker>
      <marker id="outArr" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="var(--crit)"/></marker>
    </defs>`);
    // tail fin, stabiliser, wing & engine
    parts.push(`<path d="M846,79 L928,12 L968,12 L986,80 Z" fill="var(--skin-fill)" stroke="var(--skin)" stroke-width="1.5"/>
      <path d="M872,34 L950,34" stroke="var(--skin)" stroke-width="1" opacity=".7"/>
      <path d="M430,214 L600,214 L690,262 L650,266 Z" fill="var(--skin-fill)" stroke="var(--skin)" stroke-width="1.2"/>
      <rect x="452" y="236" width="104" height="30" rx="14" fill="var(--skin-fill)" stroke="var(--skin)" stroke-width="1.5"/>
      <path d="M468 236 V266 M540 236 V266" stroke="var(--skin)" stroke-width="1"/>
      <path d="M492 222 L500 236 M520 222 L528 236" stroke="var(--skin)" stroke-width="1.5"/>`);
    parts.push(`<path d="${HULL}" fill="var(--hull)"/>`);
    // compartments
    parts.push('<g clip-path="url(#hullClip)">');
    const ink = [];
    S.cfg.compartments.forEach((c, i) => {
      const R = rects[i];
      let fill, txt = 'var(--ink)', sub = 'var(--ink-2)';
      if (res && idx >= 0) {
        const p = res.comp[i].p[idx];
        const f = Math.max(0, Math.min(1, (p - pMin) / (pMax - pMin || 1)));
        const m = mix(lo, hi, f); fill = m.css;
        if (m.lum < 0.5) { txt = '#ffffff'; sub = 'rgba(255,255,255,.82)'; } else { txt = '#0f1a2b'; sub = 'rgba(15,26,43,.75)'; }
      } else fill = mix(cssVar('--hull'), seriesColor(i), 0.2).css;
      parts.push(`<g class="comp" data-comp="${i}"><title>${esc(c.name)} · ${fmt(+c.V, 2)} m³</title>
        <rect class="cell" x="${R.x}" y="${R.y}" width="${R.w}" height="${R.h}" fill="${fill}" stroke="var(--surface)" stroke-width="3"/></g>`);
      ink.push([txt, sub]);
    });
    // windows on main deck
    let win = '';
    for (let x = 175; x < 840; x += 22) win += `<rect x="${x}" y="96" width="9" height="13" rx="4" fill="var(--surface)" opacity=".55"/>`;
    parts.push(`<g pointer-events="none">${win}</g>`);
    parts.push('</g>');
    parts.push(`<path d="${HULL}" fill="none" stroke="var(--skin)" stroke-width="3"/>`);
    parts.push(`<path d="M44,128 C58,108 78,98 100,94 L104,112 L52,128 Z" fill="var(--skin)" opacity=".75" pointer-events="none"/>`);
    // compartment labels
    S.cfg.compartments.forEach((c, i) => {
      const R = rects[i];
      const narrow = R.w < 92;
      const col = seriesColor(i);
      const cy = R.cy - (R.h > 70 ? 8 : 4);
      let lines = '';
      if (!narrow) {
        lines += `<text x="${R.cx}" y="${cy + 4}" text-anchor="middle" font-size="12.5" font-weight="600" fill="${ink[i][0]}">${esc(c.name.length > 22 ? c.name.slice(0, 21) + '…' : c.name)}</text>`;
        if (res && idx >= 0) {
          const T = res.comp[i].T[idx] - K0;
          lines += `<text x="${R.cx}" y="${cy + 19}" text-anchor="middle" font-size="11" fill="${ink[i][1]}" font-family="var(--f-mono)">${fmt(pU(res.comp[i].p[idx]), 2)} ${pLbl()} · ${fmt(T, 1)} °C</text>`;
        } else lines += `<text x="${R.cx}" y="${cy + 19}" text-anchor="middle" font-size="11" fill="${ink[i][1]}" font-family="var(--f-mono)">${fmt(+c.V, 1)} m³</text>`;
      }
      const bx = narrow ? R.cx : R.x + 14, by = narrow ? R.cy : R.y + 14;
      parts.push(`<g pointer-events="none"><circle cx="${bx}" cy="${by}" r="9" fill="${col}" stroke="var(--surface)" stroke-width="1.5"/>
        <text x="${bx}" y="${by + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" font-family="var(--f-mono)">${i + 1}</text>${lines}</g>`);
    });
    // vents
    let mMax = 1e-9;
    if (res) {
      if (res._mMax == null) { res._mMax = 1e-9; res.vent.forEach((v) => { for (let r = 0; r < v.mdot.length; r++) res._mMax = Math.max(res._mMax, Math.abs(v.mdot[r])); }); }
      mMax = res._mMax;
    }
    S.cfg.vents.forEach((v, k) => {
      const g = vg[k]; if (!g) return;
      parts.push(drawVent(v, k, g, res, idx, mMax));
    });
    svg.innerHTML = parts.join('');
    $('#schemMeta').textContent = res ? `t = ${fmtT(S.cursor)} · fill shows compartment pressure` : 'Side view · click a compartment or vent to edit it';
    renderSchemLegend(res);
  }

  function drawVent(v, k, g, res, idx, mMax) {
    const L = 24;
    const ex = g.kind === 'v' ? 0 : g.kind === 'link' ? -g.ny : 1;
    const ey = g.kind === 'v' ? 1 : g.kind === 'link' ? g.nx : 0;
    const { x, y } = g;
    const x0 = x - (ex * L) / 2, y0 = y - (ey * L) / 2, x1 = x + (ex * L) / 2, y1 = y + (ey * L) / 2;
    const ink = 'var(--ink-2)', acc = 'var(--accent)';
    let open = 1, pos = 0, mdot = 0, dp = 0;
    const isBreach = v.b < 0 && v.type === 'passive';
    if (res && idx >= 0) {
      const rv = res.vent[k]; mdot = rv.mdot[idx]; dp = rv.dp[idx]; pos = rv.pos[idx];
      const amax = res.model.vents[k].A * res.model.vents[k].Cd;
      open = amax > 0 ? rv.A[idx] / amax : 0;
    } else if (v.type !== 'passive') open = 0;
    // panel opens toward side B (sense +1) or A
    let s = v.dir === 'ba' ? -1 : 1;
    if (res && v.dir === 'both' && open > 0) s = dp >= 0 ? 1 : -1;
    const nx = g.nx * s, ny = g.ny * s;
    let shape = '';
    const gap = `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="var(--hull)" stroke-width="5"/>`;
    const ticks = `<line x1="${x0 - ey * 4}" y1="${y0 + ex * 4}" x2="${x0 + ey * 4}" y2="${y0 - ex * 4}" stroke="${ink}" stroke-width="2"/><line x1="${x1 - ey * 4}" y1="${y1 + ex * 4}" x2="${x1 + ey * 4}" y2="${y1 - ex * 4}" stroke="${ink}" stroke-width="2"/>`;
    if (isBreach) {
      const pts = [];
      for (let j = 0; j < 14; j++) { const a = (j / 14) * Math.PI * 2, r = j % 2 ? 5 : 11; pts.push(`${x + r * Math.cos(a)},${y + r * Math.sin(a)}`); }
      shape = `<polygon points="${pts.join(' ')}" fill="var(--crit)" stroke="var(--surface)" stroke-width="1.5"/>`;
    } else if (v.type === 'passive') {
      const on = !res || open > 0;
      shape = gap + ticks + (on ? '' : `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${ink}" stroke-width="2" stroke-dasharray="2 3"/>`);
    } else if (v.type === 'hinged') {
      const th = res ? pos : 0;
      // hinge at (x0,y0); rotate toward the downstream normal
      const ex2 = Math.cos(th) * ex + Math.sin(th) * nx, ey2 = Math.cos(th) * ey + Math.sin(th) * ny;
      shape = gap + `<line x1="${x0}" y1="${y0}" x2="${x0 + ex2 * L}" y2="${y0 + ey2 * L}" stroke="${open > 0 ? acc : ink}" stroke-width="3.5" stroke-linecap="round"/><circle cx="${x0}" cy="${y0}" r="3" fill="${ink}"/>`;
    } else if (v.type === 'translational') {
      const vv = res ? res.model.vents[k] : null;
      const xFull = vv ? vv.Ap / (2 * (vv.Ap / vv.b + vv.b)) : 1;
      const d = res ? Math.min(1, pos / (xFull || 1)) * 12 + (pos > xFull ? Math.min(10, (pos - xFull) * 400) : 0) : 0;
      shape = gap + `<line x1="${x0 + nx * d}" y1="${y0 + ny * d}" x2="${x1 + nx * d}" y2="${y1 + ny * d}" stroke="${open > 0 ? acc : ink}" stroke-width="4" stroke-linecap="round"/>` +
        (d > 0.5 ? `<path d="M${x0} ${y0} L${x0 + nx * d} ${y0 + ny * d} M${x1} ${y1} L${x1 + nx * d} ${y1 + ny * d}" stroke="var(--muted)" stroke-dasharray="2 2"/>` : '');
    } else {
      shape = gap + (open > 0 ? ticks : `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${ink}" stroke-width="3"/>`) +
        `<path d="M${x} ${y - 5} L${x + 5} ${y} L${x} ${y + 5} L${x - 5} ${y} Z" fill="${open > 0 ? acc : ink}"/>`;
    }
    let link = '';
    if (g.kind === 'link') link = `<path d="M${g.ax} ${g.ay} L${g.bx} ${g.by}" stroke="var(--muted)" stroke-width="1.2" stroke-dasharray="4 4" fill="none"/>`;
    // flow arrow
    let arrow = '';
    if (res && Math.abs(mdot) > 0.004 * mMax) {
      const sg = mdot > 0 ? 1 : -1;
      const ax = g.nx * sg, ay = g.ny * sg;
      const w = 1.5 + 6 * Math.sqrt(Math.abs(mdot) / mMax);
      const len = 16 + 18 * Math.sqrt(Math.abs(mdot) / mMax);
      const col = v.b < 0 ? 'var(--crit)' : 'var(--accent)';
      const off = g.kind === 'skin' ? len / 2 + 6 : 0;
      const cx = x + ax * off, cy = y + ay * off;
      arrow = `<line x1="${cx - (ax * len) / 2}" y1="${cy - (ay * len) / 2}" x2="${cx + (ax * len) / 2}" y2="${cy + (ay * len) / 2}" stroke="${col}" stroke-width="${w}" stroke-linecap="round" marker-end="url(#${v.b < 0 ? 'outArr' : 'flowArr'})" opacity=".85"/>`;
    }
    // label position: offset along boundary
    const lx = g.kind === 'v' ? x : g.kind === 'skin' ? x + 15 : x + 15, ly = g.kind === 'v' ? y - 18 : g.kind === 'skin' ? (g.ny < 0 ? y - 8 : y + 14) : y - 7;
    const lab = `<text x="${lx}" y="${ly}" text-anchor="${g.kind === 'v' ? 'middle' : 'start'}" font-size="10.5" font-weight="600" font-family="var(--f-mono)" fill="${v.b < 0 ? 'var(--crit)' : 'var(--ink-2)'}" paint-order="stroke" stroke="var(--hull)" stroke-width="3">V${k + 1}</text>`;
    const title = `${v.name} · ${TYPES[v.type]} · ${compName(v.a)} ↔ ${compName(v.b)}` + (res ? ` · Δp ${fmt(pU(dp), 2)} ${pLbl()} · ṁ ${fmt(mdot, 2)} kg/s` : '');
    return `${link}<g class="vent-g" data-vent="${k}"><title>${esc(title)}</title><rect x="${x - 16}" y="${y - 16}" width="32" height="32" fill="transparent"/>${shape}${arrow}${lab}</g>`;
  }

  function renderSchemLegend(res) {
    const sw = (inner) => `<svg width="26" height="16" viewBox="0 0 26 16" aria-hidden="true">${inner}</svg>`;
    const items = [
      [sw('<polygon points="13,2 15,6 20,5 17,9 20,13 15,11 13,15 11,11 6,13 9,9 6,5 11,6" fill="var(--crit)"/>'), 'Breach'],
      [sw('<line x1="3" y1="8" x2="23" y2="8" stroke="var(--ink-2)" stroke-width="2" stroke-dasharray="1 0"/><line x1="3" y1="4" x2="3" y2="12" stroke="var(--ink-2)" stroke-width="2"/><line x1="23" y1="4" x2="23" y2="12" stroke="var(--ink-2)" stroke-width="2"/><line x1="5" y1="8" x2="21" y2="8" stroke="var(--surface)" stroke-width="3"/>'), 'Passive opening'],
      [sw('<line x1="3" y1="12" x2="20" y2="3" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/><circle cx="3" cy="12" r="2.5" fill="var(--ink-2)"/>'), 'Hinged panel'],
      [sw('<line x1="4" y1="5" x2="22" y2="5" stroke="var(--accent)" stroke-width="3.5" stroke-linecap="round"/><path d="M4 12 V6 M22 12 V6" stroke="var(--muted)" stroke-dasharray="2 2"/>'), 'Translational panel'],
      [sw('<line x1="3" y1="8" x2="23" y2="8" stroke="var(--ink-2)" stroke-width="3"/><path d="M13 3 L18 8 L13 13 L8 8 Z" fill="var(--ink-2)"/>'), 'Ideal vent'],
    ];
    let html = items.map(([s, t]) => `<span>${s} ${t}</span>`).join('');
    if (res) html += `<span class="ramp" style="margin-left:auto">${fmt(pU(res.model.pa), 1)} <i></i> ${fmt(pU(Math.max(...res.model.comps.map((c) => c.p0))), 1)} ${pLbl()}</span>` +
      `<span>${sw('<line x1="2" y1="8" x2="20" y2="8" stroke="var(--accent)" stroke-width="3"/><path d="M18 4 L24 8 L18 12 Z" fill="var(--accent)"/>')} Mass flow</span>`;
    $('#schemLegend').innerHTML = html;
  }

  function bindSchematic() {
    $('#schem').addEventListener('click', (e) => {
      const v = e.target.closest('[data-vent]');
      if (v) { flashItem('vent', +v.dataset.vent); return; }
      const c = e.target.closest('[data-comp]');
      if (c) flashItem('comp', +c.dataset.comp);
    });
    const sl = $('#tSlider');
    sl.addEventListener('input', () => {
      if (!S.result) return;
      const [a, b] = S.view; setCursor(a + (b - a) * (+sl.value / 1000), true);
    });
    $('#play').addEventListener('click', togglePlay);
  }

  function togglePlay() {
    if (!S.result) return;
    S.playing = !S.playing;
    $('#play').innerHTML = S.playing
      ? '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1 H5 V11 H2 Z M7 1 H10 V11 H7 Z" fill="currentColor"/></svg> Pause'
      : '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1 L11 6 L2 11 Z" fill="currentColor"/></svg> Play';
    if (!S.playing) return;
    const [a, b] = S.view;
    if (S.cursor >= b - (b - a) * 0.01) S.cursor = a;
    let last = performance.now();
    const dur = 7000;
    const tick = (now) => {
      if (!S.playing) return;
      const [a2, b2] = S.view;
      const t = Math.min(b2, S.cursor + ((now - last) / dur) * (b2 - a2)); last = now;
      setCursor(t, false);
      if (t >= b2) { togglePlay(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  let rafCursor = 0;
  function setCursor(t, fromSlider) {
    S.cursor = t;
    if (!fromSlider && S.view) {
      const [a, b] = S.view; $('#tSlider').value = String(Math.round(((t - a) / (b - a || 1)) * 1000));
    }
    $('#tRead').textContent = 't = ' + fmtT(t);
    if (rafCursor) return;
    rafCursor = requestAnimationFrame(() => {
      rafCursor = 0;
      renderSchematic();
      charts.forEach((c) => c.drawOverlay());
    });
  }

  /* =============================================================== CHARTS */
  function niceTicks(a, b, n) {
    if (!(b > a)) { b = a + 1; }
    const span = b - a, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const err = step0 / mag;
    const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
    const out = [];
    for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return { ticks: out, step };
  }
  function tickFmt(v, step) {
    const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    return v.toLocaleString('en-US', { minimumFractionDigits: Math.min(d, 6), maximumFractionDigits: Math.min(d, 6) }).replace('-', '−');
  }

  class TimeChart {
    constructor(def) {
      this.def = def;
      const el = document.createElement('div');
      el.className = 'chart';
      el.innerHTML = `<div class="chart-top"><h3>${def.title}</h3><span class="unit"></span>${def.controls || ''}</div>
        <div class="legend"></div><div class="plot"><canvas class="base"></canvas><canvas class="ov"></canvas><div class="tip" hidden></div></div>`;
      this.el = el;
      this.base = $('canvas.base', el); this.ov = $('canvas.ov', el); this.tip = $('.tip', el);
      this.legend = $('.legend', el);
      this.series = []; this.hover = false;
      this.bindEvents();
    }
    setData(series, refs, unit) {
      this.series = series; this.refs = refs || []; this.unit = unit;
      $('.unit', this.el).textContent = unit;
      const hid = S.hidden[this.def.id] = S.hidden[this.def.id] || {};
      series.forEach((s) => { if (hid[s.key] == null && s.defaultHidden) hid[s.key] = true; });
      this.legend.innerHTML = series.map((s, j) => {
        const dash = s.dash && s.dash.length ? `stroke-dasharray="${s.dash.join(' ')}"` : '';
        return `<button type="button" data-j="${j}" aria-pressed="${!hid[s.key]}"><svg width="18" height="8" aria-hidden="true"><line x1="1" y1="4" x2="17" y2="4" stroke="${s.color}" stroke-width="2.5" ${dash} stroke-linecap="round"/></svg>${esc(s.name)}</button>`;
      }).join('');
      $$('button', this.legend).forEach((b) => b.addEventListener('click', () => {
        const s = this.series[+b.dataset.j]; hid[s.key] = !hid[s.key];
        b.setAttribute('aria-pressed', String(!hid[s.key])); this.draw();
      }));
      this.legend.hidden = series.length < 2;
      this.draw();
    }
    visible() { const hid = S.hidden[this.def.id] || {}; return this.series.filter((s) => !hid[s.key]); }
    geom() {
      const r = this.base.parentElement.getBoundingClientRect();
      return { W: r.width, H: r.height, l: 58, r: 12, t: 10, b: 30 };
    }
    prep(cv) {
      const g = this.geom(), dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(g.W * dpr) || cv.height !== Math.round(g.H * dpr)) { cv.width = Math.round(g.W * dpr); cv.height = Math.round(g.H * dpr); }
      const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, g.W, g.H);
      return [ctx, g];
    }
    draw() {
      const [ctx, g] = this.prep(this.base);
      const r = S.result; if (!r || !S.view) { this.drawOverlay(); return; }
      const T = r.t;
      const [t0, t1] = S.view;
      const i0 = Math.max(0, lowerIdx(T, t0) - 1), i1 = Math.min(T.length - 1, lowerIdx(T, t1) + 1);
      const vis = this.visible();
      let ymin = Infinity, ymax = -Infinity;
      vis.forEach((s) => { for (let i = i0; i <= i1; i++) { const y = s.y[i]; if (y < ymin) ymin = y; if (y > ymax) ymax = y; } });
      this.refs.forEach((rf) => { if (rf.y < ymin) ymin = rf.y; if (rf.y > ymax) ymax = rf.y; });
      if (this.def.zero) { ymin = Math.min(ymin, 0); ymax = Math.max(ymax, 0); }
      if (!isFinite(ymin)) { ymin = 0; ymax = 1; }
      if (ymax - ymin < 1e-9) { ymax += Math.abs(ymax) * 0.05 + 1e-3; ymin -= Math.abs(ymin) * 0.05 + 1e-3; }
      const pad = (ymax - ymin) * 0.06; ymin -= pad; ymax += pad;
      if (this.def.zero && ymin > -pad * 1.01 && ymin < 0) ymin = Math.min(ymin, 0);
      const yt = niceTicks(ymin, ymax, 5), xt = niceTicks(t0, t1, Math.max(3, Math.floor(g.W / 90)));
      this.sc = { t0, t1, ymin, ymax, g, i0, i1 };
      const X = (t) => g.l + ((t - t0) / (t1 - t0)) * (g.W - g.l - g.r);
      const Y = (v) => g.t + (1 - (v - ymin) / (ymax - ymin)) * (g.H - g.t - g.b);
      const grid = cssVar('--grid'), muted = cssVar('--muted'), line = cssVar('--line');
      ctx.font = `11px ${cssVar('--f-mono') || 'monospace'}`;
      ctx.fillStyle = muted; ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      yt.ticks.forEach((v) => {
        const y = Math.round(Y(v)) + 0.5; if (y < g.t - 1 || y > g.H - g.b + 1) return;
        ctx.beginPath(); ctx.moveTo(g.l, y); ctx.lineTo(g.W - g.r, y); ctx.stroke();
        ctx.fillText(tickFmt(v, yt.step), g.l - 6, y);
      });
      const msAxis = t1 - t0 < 0.5;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      xt.ticks.forEach((v) => {
        const x = Math.round(X(v)) + 0.5; if (x < g.l - 1 || x > g.W - g.r + 1) return;
        ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(x, g.t); ctx.lineTo(x, g.H - g.b); ctx.stroke();
        ctx.fillText(msAxis ? tickFmt(v * 1e3, xt.step * 1e3) : tickFmt(v, xt.step), x, g.H - g.b + 6);
      });
      ctx.textAlign = 'right'; ctx.fillText(msAxis ? 't (ms)' : 't (s)', g.W - g.r, g.H - 12);
      ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(g.l + 0.5, g.t); ctx.lineTo(g.l + 0.5, g.H - g.b); ctx.lineTo(g.W - g.r, g.H - g.b + 0.5); ctx.stroke();
      if (this.def.zero && ymin < 0 && ymax > 0) { ctx.strokeStyle = muted; ctx.beginPath(); ctx.moveTo(g.l, Math.round(Y(0)) + 0.5); ctx.lineTo(g.W - g.r, Math.round(Y(0)) + 0.5); ctx.stroke(); }
      // reference lines
      this.refs.forEach((rf) => {
        const y = Math.round(Y(rf.y)) + 0.5;
        ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = muted; ctx.beginPath(); ctx.moveTo(g.l, y); ctx.lineTo(g.W - g.r, y); ctx.stroke(); ctx.restore();
        ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(rf.label, g.W - g.r - 2, y - 2);
      });
      // series
      ctx.save(); ctx.beginPath(); ctx.rect(g.l, g.t - 2, g.W - g.l - g.r, g.H - g.t - g.b + 4); ctx.clip();
      const pw = g.W - g.l - g.r;
      vis.forEach((s) => {
        ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash(s.dash || []);
        ctx.beginPath();
        const n = i1 - i0 + 1;
        if (n > pw * 2) {
          // min/max per pixel column
          let col = -1, mn = 0, mx = 0, first = true, lastY = 0;
          for (let i = i0; i <= i1; i++) {
            const c = Math.floor(X(T[i])), y = Y(s.y[i]);
            if (c !== col) {
              if (col >= 0) { if (first) { ctx.moveTo(col, lastY); first = false; } ctx.lineTo(col, mn); ctx.lineTo(col, mx); ctx.lineTo(col, lastY); }
              col = c; mn = mx = y;
            } else { if (y < mn) mn = y; if (y > mx) mx = y; }
            lastY = y;
          }
          if (col >= 0) { ctx.lineTo(col, mn); ctx.lineTo(col, mx); }
        } else {
          for (let i = i0; i <= i1; i++) { const x = X(T[i]), y = Y(s.y[i]); if (i === i0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        }
        ctx.stroke();
      });
      ctx.restore();
      this.drawOverlay();
    }
    drawOverlay() {
      const [ctx, g] = this.prep(this.ov);
      if (!S.result || !this.sc) return;
      const { t0, t1, ymin, ymax } = this.sc;
      const X = (t) => g.l + ((t - t0) / (t1 - t0)) * (g.W - g.l - g.r);
      const Y = (v) => g.t + (1 - (v - ymin) / (ymax - ymin)) * (g.H - g.t - g.b);
      if (this.drag) {
        const a = Math.min(this.drag.x0, this.drag.x1), b = Math.max(this.drag.x0, this.drag.x1);
        ctx.fillStyle = cssVar('--accent-soft'); ctx.globalAlpha = 0.6; ctx.fillRect(a, g.t, b - a, g.H - g.t - g.b); ctx.globalAlpha = 1;
      }
      const t = S.cursor;
      if (t < t0 || t > t1) { this.tip.hidden = true; return; }
      const x = Math.round(X(t)) + 0.5;
      ctx.strokeStyle = cssVar('--ink-2'); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, g.t); ctx.lineTo(x, g.H - g.b); ctx.stroke(); ctx.setLineDash([]);
      const i = stateAt(t);
      const vis = this.visible();
      const surf = cssVar('--surface');
      vis.forEach((s) => {
        const y = Y(s.y[i]); if (y < g.t - 2 || y > g.H - g.b + 2) return;
        ctx.beginPath(); ctx.arc(X(S.result.t[i]), y, 4, 0, Math.PI * 2); ctx.fillStyle = s.color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = surf; ctx.stroke();
      });
      if (this.hover && vis.length) {
        const rows = vis.map((s) => ({ s, v: s.y[i] })).sort((a, b) => b.v - a.v).slice(0, 12);
        this.tip.innerHTML = `<div class="t">t = ${fmtT(S.result.t[i])}</div>` + rows.map(({ s, v }) =>
          `<div class="r"><span><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</span><b>${this.def.fmt ? this.def.fmt(v) : fmt(v)}</b></div>`).join('');
        this.tip.hidden = false;
        const tw = this.tip.offsetWidth, left = x + 14 + tw > g.W ? x - 14 - tw : x + 14;
        this.tip.style.left = Math.max(0, left) + 'px'; this.tip.style.top = '8px';
      } else this.tip.hidden = true;
    }
    tAt(clientX) {
      const r = this.ov.getBoundingClientRect(), g = this.geom();
      const { t0, t1 } = this.sc;
      const fx = (clientX - r.left - g.l) / (g.W - g.l - g.r);
      return { t: t0 + Math.max(0, Math.min(1, fx)) * (t1 - t0), x: clientX - r.left };
    }
    bindEvents() {
      const ov = this.ov;
      ov.addEventListener('pointermove', (e) => {
        if (!S.result || !this.sc) return;
        const { t, x } = this.tAt(e.clientX);
        this.hover = true;
        if (this.drag) { this.drag.x1 = x; this.drag.t1 = t; }
        setCursor(t, false);
      });
      ov.addEventListener('pointerleave', () => { this.hover = false; this.tip.hidden = true; this.drawOverlay(); });
      ov.addEventListener('pointerdown', (e) => {
        if (!S.result || !this.sc || e.pointerType === 'touch') return;
        const { t, x } = this.tAt(e.clientX);
        this.drag = { x0: x, x1: x, t0: t, t1: t };
        ov.setPointerCapture(e.pointerId);
      });
      ov.addEventListener('pointerup', () => {
        const d = this.drag; this.drag = null;
        if (d && Math.abs(d.x1 - d.x0) > 6) setView(Math.min(d.t0, d.t1), Math.max(d.t0, d.t1));
        else this.drawOverlay();
      });
      ov.addEventListener('dblclick', () => setView(null));
    }
  }

  function lowerIdx(T, t) { let lo = 0, hi = T.length - 1; if (t <= T[0]) return 0; if (t >= T[hi]) return hi; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; } return lo; }

  function setView(a, b) {
    if (!S.result) return;
    const tEnd = S.result.t[S.result.t.length - 1];
    if (a == null) S.view = [0, tEnd]; else S.view = [Math.max(0, a), Math.min(tEnd, b)];
    $$('#zoomSeg button').forEach((x) => {
      const z = x.dataset.z;
      x.setAttribute('aria-pressed', String(z === 'all' ? (S.view[0] === 0 && S.view[1] === tEnd) : (S.view[0] === 0 && Math.abs(S.view[1] - Math.min(+z, tEnd)) < 1e-9)));
      x.disabled = z !== 'all' && +z >= tEnd;
    });
    if (S.cursor < S.view[0] || S.cursor > S.view[1]) S.cursor = S.view[0];
    charts.forEach((c) => c.draw());
    setCursor(S.cursor, false);
  }

  const chartDefs = [
    { id: 'p', title: 'Compartment pressure' },
    { id: 'dp', title: 'Differential pressure', zero: true, controls: '<div class="seg" role="group" aria-label="Differential pressure set"><button type="button" data-dp="vents">Across vents</button><button type="button" data-dp="pairs">All pairs</button></div>' },
    { id: 'T', title: 'Air temperature' },
    { id: 'rho', title: 'Air density' },
    { id: 'mdot', title: 'Mass flow through vents', zero: true },
    { id: 'A', title: 'Effective open area' },
    { id: 'alt', title: 'Cabin pressure altitude' },
    { id: 'mach', title: 'Throat Mach number' },
  ];
  let charts = [];

  function buildCharts() {
    const host = $('#charts'); host.innerHTML = '';
    charts = chartDefs.map((d) => { const c = new TimeChart(d); host.appendChild(c.el); return c; });
    $$('[data-dp]', host).forEach((b) => b.addEventListener('click', () => { S.dpMode = b.dataset.dp; fillCharts(); }));
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => charts.forEach((c) => c.draw()), 120); });
    $$('#zoomSeg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.z === 'all' ? null : 0, +b.dataset.z)));
  }

  function fillCharts() {
    const r = S.result; if (!r) { charts.forEach((c) => c.setData([], [], '')); return; }
    const N = r.comp.length;
    const comps = r.model.comps, vents = r.model.vents;
    const mapArr = (a, f) => { const o = new Float64Array(a.length); for (let i = 0; i < a.length; i++) o[i] = f(a[i]); return o; };
    const cSeries = (key, f) => comps.map((c, i) => ({ key: 'c' + i, name: `${i + 1} ${c.name}`, color: seriesColor(i), dash: [], y: mapArr(r.comp[i][key], f) }));
    const vSeries = (key, f, filter) => vents.map((v, k) => ({ v, k })).filter(({ v }) => !filter || filter(v)).map(({ v, k }) => ({
      key: 'v' + k, name: `V${k + 1} ${v.name}`, color: seriesColor(k), dash: seriesDash(k), y: mapArr(r.vent[k][key], f || ((x) => x)), defaultHidden: false,
    }));
    const by = Object.fromEntries(charts.map((c) => [c.def.id, c]));
    const pa = r.model.pa;
    by.p.def.fmt = (v) => fmt(v, 3);
    by.p.setData(cSeries('p', pU), [{ y: pU(pa), label: 'ambient' }, { y: pU(r.summary.pStar), label: 'p* = 1.893 pₐ' }], pLbl());
    by.dp.def.fmt = (v) => fmt(v, 3);
    let dps;
    if (S.dpMode === 'pairs') {
      const pairs = [];
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const y = new Float64Array(r.t.length); const a = r.comp[i].p, b = r.comp[j].p;
        for (let q = 0; q < y.length; q++) y[q] = pU(a[q] - b[q]);
        let pk = 0; for (let q = 0; q < y.length; q++) pk = Math.max(pk, Math.abs(y[q]));
        pairs.push({ key: `p${i}-${j}`, name: `p${i + 1} − p${j + 1}`, y, pk });
      }
      pairs.sort((a, b) => b.pk - a.pk);
      dps = pairs.map((p, j) => Object.assign(p, { color: seriesColor(j), dash: seriesDash(j), defaultHidden: j >= 8 }));
    } else {
      dps = vSeries('dp', pU).map((s) => Object.assign(s, { name: s.name, defaultHidden: vents[+s.key.slice(1)].b_ < 0 && vents.some((v) => v.b_ >= 0) }));
    }
    by.dp.setData(dps, [], pLbl() + (S.dpMode === 'vents' ? ' · p_A − p_B' : ''));
    $$('[data-dp]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dp === S.dpMode)));
    by.T.def.fmt = (v) => fmt(v, 2);
    by.T.setData(cSeries('T', (x) => x - K0), [{ y: r.model.Ta - K0, label: 'ambient' }], '°C');
    by.rho.def.fmt = (v) => fmt(v, 4);
    by.rho.setData(cSeries('rho', (x) => x), [{ y: pa / (r.model.R * r.model.Ta), label: 'ambient' }], 'kg/m³');
    by.mdot.def.fmt = (v) => fmt(v, 3);
    by.mdot.setData(vSeries('mdot'), [], 'kg/s · + from A to B');
    by.A.def.fmt = (v) => fmt(v, 4);
    by.A.setData(vSeries('A'), [], 'm² (C_D·A_open)');
    by.alt.def.fmt = (v) => fmt(v, 0);
    const altRef = altU(2438.4);
    by.alt.setData(cSeries('p', (x) => altU(Solver.pressureAltitude(x))), [{ y: altRef, label: S.units.alt === 'ft' ? '8 000 ft' : '2 438 m (8 000 ft)' }], altLbl());
    by.mach.def.fmt = (v) => fmt(v, 3);
    by.mach.setData(vSeries('mach'), [{ y: 1, label: 'choked' }], '–');
  }

  /* ============================================================== RESULTS */
  function renderKpis() {
    const r = S.result, sm = r.summary, N = r.comp.length;
    let best = null;
    sm.pairs.forEach((q) => {
      const v = Math.max(q.max, -q.min); if (!best || v > best.v) best = { v, q, t: q.max >= -q.min ? q.tMax : q.tMin, sign: q.max >= -q.min };
    });
    const cTmin = sm.compartments.reduce((a, c, i) => (c.TMin < a.v ? { v: c.TMin, i } : a), { v: Infinity, i: 0 });
    const altMax = Math.max(...sm.compartments.map((c) => c.altMax));
    const breach = sm.vents.filter((v) => v.b < 0);
    const mBreach = breach.reduce((s, v) => Math.max(s, Math.abs(v.mdotMax)), 0);
    const loads = sm.vents.filter((v) => isFinite(v.loadMax));
    const tiles = [];
    if (N > 1 && best) {
      const pairName = best.sign ? `p${best.q.i + 1} − p${best.q.j + 1}` : `p${best.q.j + 1} − p${best.q.i + 1}`;
      tiles.push({ alert: true, v: fmt(pU(best.v), 2), u: pLbl(), d: `Peak differential, ${pairName} at ${fmtT(best.t)}` });
    }
    tiles.push({ v: isFinite(sm.tEqualised) ? fmt(sm.tEqualised, sm.tEqualised < 1 ? 4 : 3) : '> ' + fmt(sm.tFinal, 2), u: 's', d: 'Total decompression time' });
    tiles.push({ v: (sm.supercriticalEnded ? '' : '> ') + fmt(sm.tSupercritical, sm.tSupercritical < 1 ? 4 : 3), u: 's', d: `Supercritical phase · breach choked ${fmtT(sm.tChokedBreach)}` });
    tiles.push({ v: fmt(cTmin.v - K0, 1), u: '°C', d: `Lowest air temperature, ${r.model.comps[cTmin.i].name}` });
    tiles.push({ v: fmt(altU(altMax), 0), u: altLbl(), d: 'Peak cabin pressure altitude' });
    if (loads.length) {
      const L = loads.reduce((a, v) => (v.loadMax > a.loadMax ? v : a));
      tiles.push({ v: fmt(L.loadMax / 1e3, 1), u: 'kN', d: `Peak partition load, ${L.name}` });
    } else tiles.push({ v: fmt(mBreach, 2), u: 'kg/s', d: 'Peak breach mass flow' });
    $('#kpis').innerHTML = tiles.map((t) => `<div class="kpi${t.alert ? ' alert' : ''}"><span class="v">${t.v}<small>${t.u}</small></span><span class="d">${t.d}</span></div>`).join('');
  }

  function renderValidation() {
    const box = $('#validate');
    const pre = Model.presets.find((p) => p.id === S.presetId);
    if (!pre || !S.result || !pre.reference || JSON.stringify(S.cfg) !== S.presetSnapshot) { box.hidden = true; return; }
    const sm = S.result.summary, ref = pre.reference;
    const rows = [];
    const add = (q, got, want, unit, d) => rows.push({ q, got, want, unit, d });
    if (ref.totals.tSupercritical != null) add('Supercritical phase', sm.tSupercritical, ref.totals.tSupercritical, 's', 4);
    if (ref.totals.tSubcritical != null) add('Subcritical phase', sm.tSubcritical, ref.totals.tSubcritical, 's', 4);
    if (ref.totals.tEqualised != null) add('Total decompression time', sm.tEqualised, ref.totals.tEqualised, 's', 4);
    if (sm.analyticSupercritical != null) add('Supercritical phase, closed form', sm.analyticSupercritical, ref.totals.tSupercritical, 's', 4);
    ref.pairs.forEach(([i, j, v]) => {
      const q = sm.pairs.find((q) => (q.i === i && q.j === j) || (q.i === j && q.j === i));
      const val = q.i === i ? q.max : -q.min;
      add(`Peak p${i + 1} − p${j + 1}`, val / 1e3, v, 'kPa', 2);
    });
    ref.panels.forEach(([k, t0, top]) => {
      const v = sm.vents[k];
      if (ref.panelsFromZero) add(`${v.name}: fully open at`, v.tFull * 1e3, top, 'ms', 1);
      else { add(`${v.name}: release`, v.tRelease * 1e3, t0, 'ms', 1); add(`${v.name}: opening time`, v.openingTime * 1e3, top, 'ms', 1); }
    });
    $('#valTable').innerHTML = '<thead><tr><th>Quantity</th><th>AirDeco</th><th>Paper</th><th>Deviation</th></tr></thead><tbody>' + rows.map((r) => {
      const dev = (r.got - r.want) / r.want * 100;
      return `<tr><td class="txt">${esc(r.q)}</td><td>${fmt(r.got, r.d)} ${r.unit}</td><td>${fmt(r.want, r.d)} ${r.unit}</td><td class="dev ${Math.abs(dev) <= 3 ? 'ok' : 'off'}">${dev >= 0 ? '+' : '−'}${fmt(Math.abs(dev), 1)} %</td></tr>`;
    }).join('') + '</tbody>';
    $('#valSource').textContent = pre.source;
    $('#valNote').textContent = ref.note + ' The check disappears once you edit the case.';
    box.hidden = false;
  }

  function renderTables() {
    const r = S.result, sm = r.summary;
    const pl = pLbl();
    $('#tComp').innerHTML = `<table class="data"><thead><tr>
      <th>Compartment</th><th>V (m³)</th><th>p⁰ (${pl})</th><th>T⁰ (°C)</th><th>m⁰ (kg)</th><th>p min (${pl})</th><th>T min (°C)</th><th>ρ min (kg/m³)</th>
      <th>max −dp/dt (${pl}/s)</th><th>at</th><th>Peak cabin alt. (${altLbl()})</th><th>Reaches ambient</th></tr></thead><tbody>` +
      sm.compartments.map((c, i) => `<tr><td class="txt"><span class="sw" style="background:${seriesColor(i)}"></span>${i + 1} · ${esc(c.name)}</td>
        <td>${fmt(c.V, 2)}</td><td>${fmt(pU(c.p0), 3)}</td><td>${fmt(c.T0 - K0, 1)}</td><td>${fmt(c.m0, 2)}</td><td>${fmt(pU(c.pMin), 3)}</td>
        <td>${fmt(c.TMin - K0, 1)}</td><td>${fmt(c.rhoMin, 4)}</td><td>${fmt(pU(-c.dpdtMin), 1)}</td><td>${fmtT(c.tdpdtMin)}</td>
        <td>${fmt(altU(c.altMax), 0)}</td><td>${fmtT(c.tEq)}</td></tr>`).join('') + '</tbody></table>';
    $('#tVent').innerHTML = `<table class="data"><thead><tr>
      <th>Vent</th><th>A → B</th><th>Type</th><th>A_eff (m²)</th><th>Peak Δp + (${pl})</th><th>at</th><th>Peak Δp − (${pl})</th><th>at</th>
      <th>Peak ṁ (kg/s)</th><th>Max Mach</th><th>Choked for</th><th>Mass A→B (kg)</th><th>Released at</th><th>Opening time</th><th>Peak load (kN)</th></tr></thead><tbody>` +
      sm.vents.map((v, k) => {
        const hot = sm.vents.filter((x) => x.b >= 0).reduce((a, x) => Math.max(a, x.dpMax, -x.dpMin), 0);
        const isHot = v.b >= 0 && Math.max(v.dpMax, -v.dpMin) === hot && hot > 0;
        return `<tr><td class="txt">V${k + 1} · ${esc(v.name)}</td><td class="txt">${esc(compName(v.a))} → ${esc(compName(v.b))}</td><td class="txt">${TYPES[v.type]}</td>
        <td>${fmt(v.Aeff, 4)}</td><td class="${isHot && v.dpMax >= -v.dpMin ? 'hot' : ''}">${fmt(pU(v.dpMax), 3)}</td><td>${fmtT(v.tdpMax)}</td>
        <td class="${isHot && v.dpMax < -v.dpMin ? 'hot' : ''}">${fmt(pU(v.dpMin), 3)}</td><td>${fmtT(v.tdpMin)}</td>
        <td>${fmt(v.mdotMax, 3)}</td><td>${fmt(v.machMax, 3)}</td><td>${v.chokedTime > 0 ? fmtT(v.chokedTime) : '–'}</td><td>${fmt(v.massThrough, 2)}</td>
        <td>${v.type === 'passive' ? '–' : isFinite(v.tRelease) ? fmtT(v.tRelease) : 'stays shut'}</td>
        <td>${v.type === 'passive' ? '–' : isFinite(v.openingTime) ? fmtT(v.openingTime) : isFinite(v.tRelease) ? 'not fully' : '–'}</td>
        <td>${isFinite(v.loadMax) ? fmt(v.loadMax / 1e3, 2) : '–'}</td></tr>`;
      }).join('') + '</tbody></table>';
    const N = sm.compartments.length;
    const peak = (i, j) => { const q = sm.pairs.find((q) => q.i === Math.min(i, j) && q.j === Math.max(i, j)); return q ? Math.max(q.max, -q.min) : 0; };
    let pmax = 0; for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) pmax = Math.max(pmax, peak(i, j));
    const lo = cssVar('--surface'), hi = cssVar('--s8');
    $('#tPair').innerHTML = N < 2 ? '<p class="note" style="padding:14px">Add a second compartment to see differential pressures between compartments.</p>' :
      `<table class="data matrix"><thead><tr><th>Peak |p<sub>i</sub> − p<sub>j</sub>| (${pl})</th>${sm.compartments.map((c, j) => `<th>${j + 1} · ${esc(c.name)}</th>`).join('')}</tr></thead><tbody>` +
      sm.compartments.map((c, i) => `<tr><td class="txt"><span class="sw" style="background:${seriesColor(i)}"></span>${i + 1} · ${esc(c.name)}</td>` +
        sm.compartments.map((_, j) => {
          if (i === j) return '<td class="diag">·</td>';
          const v = peak(i, j), f = pmax ? v / pmax : 0;
          const m = lo.startsWith('#') && hi.startsWith('#') ? mix(lo, hi, f * 0.75) : { css: 'transparent', lum: 1 };
          return `<td style="background:${m.css};color:${m.lum < 0.55 ? '#fff' : '#101a2b'}">${fmt(pU(v), 2)}</td>`;
        }).join('') + '</tr>').join('') + '</tbody></table>';
  }

  function summaryText() {
    const r = S.result, sm = r.summary;
    const L = [];
    L.push(`AirDeco decompression analysis — ${new Date().toISOString().slice(0, 10)}`);
    L.push(`Ambient ${fmt(r.model.pa / 1e3, 3)} kPa, ${fmt(r.model.Ta - K0, 2)} °C; model ${S.cfg.thermo} (n = ${fmt(sm.thermoExponent, 3)}), dt = ${S.cfg.numerics.dt_us} µs`);
    L.push(`Supercritical phase ${fmt(sm.tSupercritical, 4)} s; total decompression ${fmt(sm.tEqualised, 4)} s`);
    L.push('Compartments:');
    sm.compartments.forEach((c, i) => L.push(`  ${i + 1} ${c.name}: V ${fmt(c.V, 2)} m³, p0 ${fmt(c.p0 / 1e3, 3)} kPa, Tmin ${fmt(c.TMin - K0, 1)} °C, peak cabin alt ${fmt(c.altMax, 0)} m`));
    L.push('Vents:');
    sm.vents.forEach((v, k) => L.push(`  V${k + 1} ${v.name} (${TYPES[v.type]}, ${compName(v.a)} -> ${compName(v.b)}): peak dp +${fmt(v.dpMax / 1e3, 3)} / ${fmt(v.dpMin / 1e3, 3)} kPa, peak mdot ${fmt(v.mdotMax, 3)} kg/s` +
      (v.type !== 'passive' ? `, released ${fmtT(v.tRelease)}, opening ${fmtT(v.openingTime)}` : '') + (isFinite(v.loadMax) ? `, load ${fmt(v.loadMax / 1e3, 2)} kN` : '')));
    L.push('Peak differential between compartments:');
    sm.pairs.forEach((q) => L.push(`  p${q.i + 1}-p${q.j + 1}: max ${fmt(q.max / 1e3, 3)} kPa @ ${fmtT(q.tMax)}, min ${fmt(q.min / 1e3, 3)} kPa @ ${fmtT(q.tMin)}`));
    return L.join('\n');
  }

  function csvText() {
    const r = S.result, comps = r.model.comps, vents = r.model.vents;
    const head = ['t_s'];
    comps.forEach((c, i) => head.push(`p${i + 1}_kPa`, `T${i + 1}_C`, `rho${i + 1}_kgm3`, `m${i + 1}_kg`));
    vents.forEach((v, k) => head.push(`V${k + 1}_mdot_kgs`, `V${k + 1}_Aeff_m2`, `V${k + 1}_dp_kPa`, `V${k + 1}_mach`, `V${k + 1}_pos`));
    const rows = [head.join(',')];
    for (let q = 0; q < r.t.length; q++) {
      const row = [r.t[q].toPrecision(7)];
      r.comp.forEach((c) => row.push((c.p[q] / 1e3).toPrecision(7), (c.T[q] - K0).toPrecision(6), c.rho[q].toPrecision(6), c.m[q].toPrecision(6)));
      r.vent.forEach((v) => row.push(v.mdot[q].toPrecision(6), v.A[q].toPrecision(6), (v.dp[q] / 1e3).toPrecision(6), v.mach[q].toPrecision(4), v.pos[q].toPrecision(5)));
      rows.push(row.join(','));
    }
    return rows.join('\n');
  }

  function download(name, text, type) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type }));
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(`Saved ${name}`);
    } catch (e) { toast('Download is blocked here. Use the copy button instead.'); }
  }
  function copy(text, what) {
    const fallback = () => {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(`${what} copied`); } catch (e) { toast('Copy failed'); } ta.remove();
    };
    try { navigator.clipboard.writeText(text).then(() => toast(`${what} copied`), fallback); } catch (e) { fallback(); }
  }

  /* Compartments with no vent path to the ambient never decompress */
  function renderWarnings(sm) {
    const N = S.cfg.compartments.length, reach = new Array(N).fill(false), msgs = [];
    const q = [];
    S.cfg.vents.forEach((v) => { if (v.b < 0 && !reach[v.a]) { reach[v.a] = true; q.push(v.a); } });
    while (q.length) {
      const i = q.pop();
      S.cfg.vents.forEach((v) => {
        const j = v.a === i ? v.b : v.b === i ? v.a : -1;
        if (j >= 0 && !reach[j]) { reach[j] = true; q.push(j); }
      });
    }
    const iso = S.cfg.compartments.filter((c, i) => !reach[i]).map((c) => c.name);
    if (!S.cfg.vents.some((v) => v.b < 0)) msgs.push('No breach is defined, so nothing vents to the ambient. Add a breach to start a decompression.');
    else if (iso.length) msgs.push(`${iso.join(', ')} ${iso.length > 1 ? 'have' : 'has'} no vent path to the ambient and will stay pressurised.`);
    if (!isFinite(sm.tEqualised) && !msgs.length) msgs.push(`Pressures had not equalised by ${fmtT(sm.tFinal)}. Increase the maximum time in Thermodynamics & solver.`);
    $('#warnBox').textContent = msgs.join(' ');
    $('#warnBox').hidden = !msgs.length;
  }

  /* ================================================================== RUN */
  let runTimer = 0;
  function changed(delay) {
    S.stale = true;
    saveLocal();
    setStatus('stale', 'Inputs changed · results out of date');
    renderSchematic();
    renderValidation();
    clearTimeout(runTimer);
    if ($('#f_live').checked) {
      const steps = (S.cfg.numerics.tEnd_s || 0) / ((S.cfg.numerics.dt_us || 50) * 1e-6);
      if (steps <= 400000) runTimer = setTimeout(run, delay == null ? 400 : delay);
      else setStatus('stale', `Inputs changed · ${fmt(steps, 0)} steps, press Run analysis`);
    }
  }

  function setStatus(kind, text) {
    const st = $('#status'); st.className = 'status ' + (kind || ''); $('#statusText').textContent = text;
  }

  function run() {
    clearTimeout(runTimer);
    setStatus('busy', 'Running…');
    $('#errBox').hidden = true;
    setTimeout(() => {
      const t0 = performance.now();
      let res;
      try {
        res = Solver.simulate(Model.toModel(S.cfg));
      } catch (e) {
        setStatus('err', 'Analysis failed');
        $('#errBox').textContent = e.message; $('#errBox').hidden = false;
        S.result = null; S.stale = true; renderSchematic();
        return;
      }
      const ms = performance.now() - t0;
      const prevView = S.view, prevEnd = S.result ? S.result.t[S.result.t.length - 1] : null;
      S.result = res; S.stale = false;
      const tEnd = res.t[res.t.length - 1];
      if (prevView && prevEnd && prevView[1] < prevEnd - 1e-9 && prevView[1] <= tEnd) S.view = [prevView[0], prevView[1]];
      else S.view = [0, tEnd];
      const sm = res.summary;
      setStatus('', `${fmt(sm.steps, 0)} steps in ${fmt(ms, 0)} ms · ${sm.stopReason} at ${fmtT(sm.tFinal)} · ${fmt(sm.nPoints, 0)} stored points`);
      renderWarnings(sm);
      renderKpis(); renderValidation(); renderTables(); fillCharts();
      setView(S.view[0], S.view[1]);
      if (S.autoCursor) {
        S.autoCursor = false;
        let tPk = 0, vPk = -1;
        sm.pairs.forEach((q) => { const v = Math.max(q.max, -q.min); if (v > vPk) { vPk = v; tPk = q.max >= -q.min ? q.tMax : q.tMin; } });
        if (!sm.pairs.length) tPk = sm.tSupercritical / 2 || 0;
        S.cursor = tPk;
      }
      if (!(S.cursor >= S.view[0] && S.cursor <= S.view[1])) S.cursor = S.view[0];
      setCursor(S.cursor, false);
    }, 20);
  }

  /* ============================================================ BOOTSTRAP */
  function loadConfig(cfg, presetId) {
    S.cfg = normalise(Model.clone(cfg));
    S.presetId = presetId || null;
    S.presetSnapshot = presetId ? JSON.stringify(S.cfg) : null;
    S.result = null; S.view = null; S.cursor = 0; S.hidden = {}; S.autoCursor = true;
    $('#preset').value = presetId || '';
    renderStatic(); renderLists();
    changed(10);
  }

  function init() {
    const sel = $('#preset');
    sel.innerHTML = '<option value="">Custom configuration</option>' + Model.presets.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('');
    sel.addEventListener('change', () => {
      const p = Model.presets.find((x) => x.id === sel.value);
      if (p) { loadConfig(p, p.id); toast(`Loaded ${p.title} · ${p.source}`); }
    });
    $('#unitP').addEventListener('change', (e) => { S.units.p = e.target.value; saveLocal(); if (S.result) { renderKpis(); renderTables(); fillCharts(); setView(S.view[0], S.view[1]); } });
    $('#unitAlt').addEventListener('change', (e) => { S.units.alt = e.target.value; saveLocal(); if (S.result) { renderKpis(); renderTables(); fillCharts(); setView(S.view[0], S.view[1]); } });
    $('#btnRun').addEventListener('click', run);
    $('#btnSave').addEventListener('click', () => download('airdeco-config.json', JSON.stringify(S.cfg, null, 2), 'application/json'));
    $('#btnLoad').addEventListener('click', () => $('#fileLoad').click());
    $('#fileLoad').addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try { const cfg = JSON.parse(rd.result); if (!cfg.compartments || !cfg.vents) throw new Error('missing compartments or vents'); loadConfig(cfg, null); toast(`Opened ${f.name}`); }
        catch (err) { toast('This file is not an AirDeco configuration: ' + err.message); }
      };
      rd.readAsText(f); e.target.value = '';
    });
    $('#btnCsv').addEventListener('click', () => { if (S.result) download('airdeco-results.csv', csvText(), 'text/csv'); });
    $('#btnCopyCsv').addEventListener('click', () => { if (S.result) copy(csvText(), 'CSV'); });
    $('#btnCopySum').addEventListener('click', () => { if (S.result) copy(summaryText(), 'Summary'); });
    $$('#tblTabs button').forEach((b) => b.addEventListener('click', () => {
      $$('#tblTabs button').forEach((x) => { x.setAttribute('aria-selected', String(x === b)); $('#' + x.dataset.tab).hidden = x !== b; });
    }));
    bindStatic(); bindLists(); bindSchematic(); buildCharts();
    const repaint = () => { if (S.cfg) { renderCompList(); renderSchematic(); if (S.result) { fillCharts(); renderTables(); } } };
    try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint); } catch (e) { /* old browsers */ }
    new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const saved = loadLocal();
    if (saved) {
      S.units = Object.assign(S.units, saved.units || {});
      $('#unitP').value = S.units.p; $('#unitAlt').value = S.units.alt;
      const pre = Model.presets.find((p) => p.id === saved.presetId);
      loadConfig(saved.cfg, null);
      if (pre && JSON.stringify(normalise(Model.clone(pre))) === JSON.stringify(S.cfg)) { S.presetId = pre.id; S.presetSnapshot = JSON.stringify(S.cfg); $('#preset').value = pre.id; }
    } else loadConfig(Model.presets[0], Model.presets[0].id);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
