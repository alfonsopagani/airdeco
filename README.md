# AirDeco — Aircraft Decompression Loads Calculator

AirDeco is an interactive, browser-based tool that computes pressure, temperature, density and mass-flow histories inside a pressurized fuselage after a sudden breach, together with the **differential pressures (decompression loads) acting on the partitions between compartments**. It handles any number of compartments (up to 8) connected by **passive vents** and **active venting systems** (hinged and translational blowout panels with their opening dynamics).

The model implements the zero-dimensional isentropic formulation of:

> A. Pagani, E. Carrera, *Gasdynamics of rapid and explosive decompressions of pressurized aircraft including active venting*, Advances in Aircraft and Spacecraft Science, 3(1), 77–93, 2016. DOI: [10.12989/aas.2016.3.1.077](http://dx.doi.org/10.12989/aas.2016.3.1.077)

The tool reproduces every benchmark case of the paper (see [Validation](#9-validation-against-the-paper)).

---

## Contents

1. [Getting started](#1-getting-started)
2. [Interface overview](#2-interface-overview)
3. [Step-by-step: setting up an analysis](#3-step-by-step-setting-up-an-analysis)
4. [Vent and panel types](#4-vent-and-panel-types)
5. [Running the analysis](#5-running-the-analysis)
6. [Reading the results](#6-reading-the-results)
7. [Saving, loading and exporting](#7-saving-loading-and-exporting)
8. [Built-in benchmark cases](#8-built-in-benchmark-cases)
9. [Validation against the paper](#9-validation-against-the-paper)
10. [Theory summary](#10-theory-summary)
11. [Assumptions, limits and good practice](#11-assumptions-limits-and-good-practice)
12. [Files and tests](#12-files-and-tests)
13. [References](#13-references)

---

## 1. Getting started

AirDeco is a static web page with no build step and no server.

- **Local use:** download or clone the repository and open `index.html` in a recent browser (Chrome, Edge, Firefox or Safari). Everything runs on your machine. An internet connection is only used to load the web fonts; without it the page falls back to system fonts.
- **Hosted use:** publish the repository with GitHub Pages (Settings → Pages → deploy from branch) and open the page URL.

On first load the tool opens the **four-compartment aircraft** of the paper (§5.4) and runs it immediately, so you see a complete example before changing anything. Your last configuration is remembered by the browser and restored the next time you open the page.

## 2. Interface overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ AirDeco   Case ▾   kPa ▾   m ▾   Save   Open…               ▶ Run analysis   │  top bar
├──────────────────────────┬───────────────────────────────────────────────────┤
│ 1 Flight conditions      │  Aircraft schematic (side view, animated)         │
│ 2 Cabin initial state    │  ▶ Play ───────●────────────────  t = 18.3 ms     │
│ 3 Compartments           │  Status · Download CSV · Copy CSV · Copy summary  │
│ 4 Breaches & vents       │  Key results (peak Δp, times, min T, …)           │
│ 5 Thermodynamics & solver│  Benchmark check (built-in cases only)            │
│                          │  Time histories (8 interactive charts)            │
│      input rail          │  Tables: Compartments · Vents & panels · Δp matrix│
│                          │  Model and equations                              │
└──────────────────────────┴───────────────────────────────────────────────────┘
```

- **Top bar.** *Case* loads one of the benchmark configurations. The two unit menus set the pressure unit (kPa, psi, hPa) and altitude unit (m, ft) used in results; inputs are always in the SI-based units printed next to each field. *Save* and *Open…* store and restore configurations. *Run analysis* starts a calculation.
- **Input rail (left).** Five numbered sections that follow the order in which you set up a case. Each section header shows a one-line summary and can be collapsed. On wide screens the rail scrolls on its own, so the results stay in view.
- **Results (right).** The schematic, key results, charts and tables. On phones the results come first and the inputs follow below.

## 3. Step-by-step: setting up an analysis

### Step 1 — Flight conditions (ambient)

Choose how the outside air is defined:

| Mode | Fields | Notes |
|---|---|---|
| **ISA altitude** | Flight altitude (m), ISA deviation (K) | Pressure and temperature from the International Standard Atmosphere (valid 0–32 km). The deviation shifts the temperature only. |
| **Manual** | Ambient pressure *p*ₐ (kPa), ambient temperature *T*ₐ (°C) | Use this to match published data or a local static pressure from aerodynamic analysis. |

The read-out box shows *p*ₐ, *T*ₐ, ambient density *ρ*ₐ and the **critical pressure** *p*\* = 1.893 *p*ₐ. While a compartment stays above *p*\*, flow out of it through a breach to the ambient is choked (sonic).

Switching mode carries the current state over, so the conditions do not jump.

### Step 2 — Cabin initial state

The initial pressure can be entered in three equivalent ways:

| Mode | Field |
|---|---|
| **Absolute p** | Cabin pressure *p*ᶜ⁰ (kPa) |
| **Cabin altitude** | ISA altitude whose pressure equals the cabin pressure (m) |
| **Differential** | Pressure differential *p*ᶜ⁰ − *p*ₐ (kPa), the usual "max Δp" of the pressurization schedule |

Enter also the cabin temperature *T*ᶜ⁰ (°C). The read-out shows the resulting absolute pressure, cabin altitude (m and ft), differential, pressure ratio *p*ᶜ⁰/*p*ₐ, initial density, whether the initial breach flow is supercritical, and a chip that checks the CS-25 limit of 8000 ft (2438 m) cabin altitude.

All compartments start at this state unless you override it (Step 3).

### Step 3 — Compartments

Each card is one control volume. Up to 8 compartments are allowed.

| Field | Unit | Meaning |
|---|---|---|
| Name | – | Label used in the schematic, charts and tables. |
| **Volume** | m³ | Net air volume of the compartment. This is the only compartment property that enters the physics. |
| Deck | – | *Main deck*, *Lower deck* (cargo/bilge) or *Full height*. Schematic placement only. |
| Station from / to | % | Start and end of the compartment along the fuselage, as a percentage of its length. Schematic placement only. |
| Initial p, Initial T *(optional)* | kPa, °C | Override the cabin initial state for this compartment (for example an unheated hold). Leave blank to use the cabin values. |
| Supply inflow | kg/s | Constant mass flow added to the compartment from *t* = 0, e.g. pressurization or emergency repressurization air (Eq. 1 of the paper). Use 0 for none. |

Buttons: **+ Add compartment**, **✕** on a card to remove it (vents connected to it are removed too), and **Auto-arrange schematic**, which lays the compartments out along the fuselage in list order with lengths scaled by volume.

### Step 4 — Breaches and vents

Every connection is a card with two sides, **Side A** and **Side B**. Side B can be a compartment or **Ambient (outside)**.

- A connection to *Ambient* is a **breach** (window loss, puncture, door failure) or a skin vent. Use **+ Add breach** to create one quickly.
- A connection between two compartments is an **intercompartment vent** (door grille, floor vent, decompression panel, blowout door). Use **+ Add vent**.

The sign convention is *Δp* = *p*_A − *p*_B, and positive mass flow goes from A to B.

The fields depend on the type (see [section 4](#4-vent-and-panel-types)):

**Passive opening**

| Field | Unit | Meaning |
|---|---|---|
| Area *A* | m² | Geometric open area. |
| Discharge *C*_D | – | Discharge coefficient; the effective area is *A*_eff = *C*_D·*A* (shown under the field). Use 1 if the area you entered is already effective. |
| Opens at | ms | Time at which the opening appears. 0 means together with the breach. Use a delay to model a second failure. |
| Partition area *(optional)* | m² | Area of the wall the vent sits in. If given, the tool reports the peak net load on that wall, *F* = max \|Δp\|·*A*_wall. |

**Blowout panels (hinged, translational, ideal)**

| Field | Unit | Meaning |
|---|---|---|
| Panel chord *b* / Side *b* | m | For a hinged panel: the panel dimension perpendicular to the hinge line (Fig. 1 of the paper). For a translational panel: one side. |
| Hinge length / Side *w* | m | The other panel dimension. Panel area *A*_p = *b*·*w*. |
| Panel mass | kg | Mass *m*_p; governs how fast the panel opens. |
| Release Δp | kPa | Differential *p*_rel needed to overcome the latch/detent. The panel stays shut below it. |
| Discharge *C*_D | – | Applied to the open area. |
| Max. angle *(hinged)* | ° | Rotation at which the panel hits its stop (90° = fully open). |
| Opens when | – | *A → B*: opens when *p*_A − *p*_B > *p*_rel. *B → A*: the reverse. *Either direction*: whichever side first exceeds *p*_rel; the panel then opens toward the low-pressure side. |
| Partition area *(optional)* | m² | As above. |

The small drawing on each card shows the selected device with its symbols, as in Figs. 1–2 of the paper.

### Step 5 — Thermodynamics and solver

| Setting | Default | Meaning |
|---|---|---|
| Model | Isentropic | **Isentropic** (*n* = γ, the paper's model, recommended for explosive < 0.5 s and rapid < 10 s events); **Polytropic** with exponent *n* (1.16 from Haber & Clamann for slower events with wall heat transfer and humidity); **Isothermal** (*n* = 1, Mavriplis). |
| γ | 1.4 | Ratio of specific heats. The hint shows the resulting critical ratio. |
| R | 287 J/kg K | Gas constant of air. |
| Time step Δt | 50 µs | Explicit Euler step. 50 µs is the value used in the paper; reduce it for very small volumes or very large breaches (see [§11](#11-assumptions-limits-and-good-practice)). |
| Max. time | case-dependent | Upper limit of the simulated time. |
| Equalisation tolerance | 1·10⁻⁴ | A compartment counts as equalised when *p* − *p*ₐ falls below this fraction of the initial cabin differential. |
| Stop shortly after equalisation | on | Ends the run about 8 % after all compartments reach ambient pressure, so the charts focus on the event. |
| Re-run automatically | on | Recomputes about half a second after any input changes, for runs up to 400 000 steps. Longer runs wait for *Run analysis*. |

## 4. Vent and panel types

| Type | Behaviour | When to use |
|---|---|---|
| **Passive opening** | Always open (from its *Opens at* time). | Breaches, door undercuts, return-air grilles, floor vents, permanently open passages. |
| **Hinged blowout panel** | Closed until \|Δp\| exceeds *p*_rel, then rotates about its hinge: θ'' = 3Δp*A*_p cos²θ / (2*m*_p*b*). Open area *A*_p(1 − cos θ). | Cockpit door decompression panels, swinging dado/sidewall panels. |
| **Translational blowout panel** | Closed until release, then detaches and translates: *x*'' = Δp*A*_p/*m*_p. Open area min[2(*A*_p/*b* + *b*)*x*, *A*_p]. | Pop-out floor/ceiling decompression panels secured by lanyards. |
| **Ideal vent** | Opens fully and instantly at *p*_rel. | Comparison case: shows how much load is underestimated when panel dynamics are ignored. |

Panel inertia matters: in the paper's two-compartment case a hinged panel (40.8 ms to open) produces a 44 kPa peak load, while a translational panel of the same mass and release pressure (23.9 ms) produces 31 kPa. Switch the type of a panel to *Ideal vent* to quantify the same effect on your configuration.

## 5. Running the analysis

- Press **Run analysis**, or just edit an input when *Re-run automatically* is on.
- The status line reports the number of steps, the run time, why the run stopped and how many points were stored. Its dot is green when results are current, amber when inputs changed since the last run, and red on errors.
- Invalid input (for example a vent connecting a compartment to itself, or a zero volume) stops the run and shows a red message that names the item to fix. A field left empty is outlined in red and ignored until it holds a number.
- An amber note warns when a compartment has no vent path to the ambient (it stays pressurized), when no breach exists, or when pressures have not equalised before the maximum time.

## 6. Reading the results

### Aircraft schematic

A side view of the fuselage with each compartment drawn at its deck and stations, numbered in the same colour used in the charts.

- **Before a run** compartments are tinted with their series colour and labelled with their volume.
- **After a run** the fill shows the compartment pressure at the selected time, from light (ambient) to dark (initial cabin pressure), with *p* and *T* printed inside. The colour scale is shown under the drawing.
- Vents are drawn where compartments meet: on a bulkhead, on the floor, or on the skin for breaches (red star). When two connected compartments share no wall (they touch only at a corner, or are apart), the vent is drawn on a duct joining them; adjust the stations to place it on a wall instead. Hinged panels rotate and translational panels lift as they open. Arrows show the direction of the mass flow, with thickness growing with the flow rate (red for flow to the outside, blue between compartments). Tags *V1, V2…* match the vent cards.
- Hover any item for its details; click it to jump to its input card.
- Use the **time slider** or **Play** to scrub through the event. The slider covers the time window currently shown in the charts, so zoom the charts to 50 ms to replay the panel openings in slow motion. After a case is loaded the cursor starts at the instant of the peak differential pressure.

### Key results

| Tile | Definition |
|---|---|
| **Peak differential** | Largest \|*p*_i − *p*_j\| between any two compartments, with the pair and time. This is the governing decompression load for partitions and floors. |
| **Total decompression time** | Time when every compartment is within the tolerance of ambient pressure. |
| **Supercritical phase** | Time until every compartment falls below *p*\* = 1.893 *p*ₐ (definition of Tables 1–2 of the paper). The time during which the breach throat itself is choked is shown below. |
| **Lowest air temperature** | Minimum temperature reached in any compartment (the isentropic model gives the lowest possible value, since condensation and wall heat transfer are neglected). |
| **Peak cabin pressure altitude** | ISA altitude corresponding to the lowest compartment pressure. |
| **Peak partition load** or **Peak breach mass flow** | Load in kN if a partition area was entered on any vent; otherwise the peak breach outflow. |

### Benchmark check

Shown only while a built-in case is loaded and unchanged. It lists AirDeco's value, the published value and the deviation (green within 3 %).

### Time histories

Eight synchronized charts:

1. **Compartment pressure** with the ambient and *p*\* reference lines.
2. **Differential pressure**, either *Across vents* (*p*_A − *p*_B for every vent; breaches are hidden by default because their Δp to ambient dwarfs the internal ones) or *All pairs* (every compartment pair, ordered by peak value, which also covers walls without vents).
3. **Air temperature** with the ambient temperature.
4. **Air density**.
5. **Mass flow through vents**, positive from A to B.
6. **Effective open area** *C*_D·*A*_open, which shows breach onset and panel opening histories (as Figs. 10 and 15 of the paper).
7. **Cabin pressure altitude**, with the 8000 ft line.
8. **Throat Mach number**; 1 means choked flow.

Interaction:

- **Hover** to read all values at one time; the cursor is shared by all charts and the schematic.
- **Drag** horizontally on any chart to zoom all charts to that window; **double-click** to reset. The *Window* buttons jump to 50 ms, 0.25 s, 1 s or the whole run. The time axis switches to milliseconds for short windows.
- **Click a legend entry** to hide or show a series.

### Tables

- **Compartments:** volume, initial pressure, temperature and mass, minimum pressure, temperature and density, maximum depressurization rate and its time, peak cabin altitude, and the time the compartment reaches ambient pressure.
- **Vents & panels:** effective area, peak positive and negative Δp with times (the governing internal value is highlighted), peak mass flow, maximum Mach number, choked duration, net mass transferred, panel release time, opening time (release to full area) and peak partition load.
- **Δp matrix:** peak \|*p*_i − *p*_j\| for every pair of compartments, shaded by magnitude.

## 7. Saving, loading and exporting

| Action | Result |
|---|---|
| **Save** | Downloads the configuration as `airdeco-config.json`. |
| **Open…** | Loads a configuration file saved earlier (or written by hand, see below). |
| **Download CSV** | Time histories of every stored point: for each compartment `p (kPa)`, `T (°C)`, `ρ (kg/m³)`, `m (kg)`; for each vent `ṁ (kg/s)`, `A_eff (m²)`, `Δp (kPa)`, Mach and panel position (rad for hinged panels, m for translational ones). |
| **Copy CSV / Copy summary** | Copies the same CSV, or a plain-text summary of all key results, to the clipboard. Use these where downloads are blocked. |

The browser also autosaves the current configuration locally; choosing a case from the *Case* menu replaces it.

Up to 16 000 time points are stored per run (the stored resolution halves as needed for long runs), while peaks and timings are always evaluated at every solver step.

**Configuration file format** (units as in the interface):

```json
{
  "ambient": { "mode": "isa", "alt_m": 9980, "dISA": 0, "p_kPa": 26.5, "T_C": -49.85 },
  "cabin":   { "mode": "abs", "p_kPa": 89.786, "alt_m": 1000, "dp_kPa": 63.3, "T_C": 23 },
  "thermo": "isentropic", "polyN": 1.16, "gamma": 1.4, "R": 287,
  "numerics": { "dt_us": 50, "tEnd_s": 6, "autoStop": true, "eqTol": 0.0001 },
  "compartments": [
    { "name": "Cockpit", "V": 4, "deck": "main", "x0": 0, "x1": 14, "p0_kPa": null, "T0_C": null, "inflow": 0 }
  ],
  "vents": [
    { "name": "Breach", "type": "passive", "a": 0, "b": -1, "A": 0.6, "Cd": 0.8, "tOpen_ms": 0, "wallArea": 0 },
    { "name": "Door panel", "type": "hinged", "a": 0, "b": 1, "pb": 0.4, "pw": 0.4, "mass": 4.32,
      "prel_kPa": 6, "Cd": 0.7, "dir": "both", "thetaMax": 90, "wallArea": 0 }
  ]
}
```

`a` and `b` are zero-based compartment indices; `b = -1` is the ambient. `type` is one of `passive`, `hinged`, `translational`, `instant`; `dir` is `ab`, `ba` or `both`.

## 8. Built-in benchmark cases

| Case | Source | What it shows |
|---|---|---|
| Four-compartment aircraft | Paper §5.4 | Breach in the entryway at 9980 m; passive door to the cabin; hinged cockpit-door panel; three translational floor panels to the cargo hold. Sequential panel activation and the resulting load peaks. |
| Two compartments, hinged panel | Paper §5.3 | Cockpit breach (0.5 m², *C*_D 0.8). A 6.75 kg hinged panel releasing at 12 kPa. Cockpit recompression when the panel opens. |
| Two compartments, translational panel | Paper §5.3 | Same aircraft with a translational panel; faster opening and lower peak load. |
| Three-compartment cabin | Mavriplis (1963), paper §5.2 | Cockpit window loss at 9144 m with passive vents between cockpit, cargo and cabin. |
| Single chamber | Paper §5.1 | 4 m³ chamber, *V/A* = 10 m. Includes the closed-form isentropic supercritical time for comparison. |

Use them as templates: load the closest case, then edit volumes, areas and panels.

## 9. Validation against the paper

Results of `node tests/benchmarks.js` with the default settings (Δt = 50 µs; 5 µs for the single chamber):

| Case | Quantity | AirDeco | Paper | Deviation |
|---|---|---|---|---|
| Single chamber, V/A = 10 m | Supercritical phase | 32.3 ms | 32.3 ms | +0.1 % |
| | Total decompression | 71.1 ms | 70.5 ms | +0.8 % |
| Three-compartment (Mavriplis) | Supercritical phase | 0.790 s | 0.79 s | 0.0 % |
| | Total decompression | 3.20 s | 3.16 s | +1.4 % |
| | Peak cargo − cockpit Δp | 3.76 kPa @ 75 ms | 3.77 kPa @ 73 ms | −0.2 % |
| Two-compartment, hinged | Supercritical / total | 0.723 / 1.769 s | 0.726 / 1.756 s | −0.3 / +0.8 % |
| | Peak Δp, panel fully open | 44.25 kPa, 40.9 ms | 44.21 kPa, 40.8 ms | +0.1 % |
| Two-compartment, translational | Supercritical / total | 0.710 / 1.756 s | 0.712 / 1.741 s | −0.3 / +0.9 % |
| | Peak Δp, panel fully open | 31.22 kPa, 24.0 ms | 31.14 kPa, 23.9 ms | +0.3 / +0.4 % |
| Four-compartment | Supercritical / total | 1.431 / 3.786 s | 1.43 / 3.74 s | +0.1 / +1.2 % |
| | Peak p1−p2, p3−p2, p4−p2, p4−p3 | 10.81, 10.03, 10.78, 4.24 kPa | 10.89, 10.09, 10.87, 4.23 kPa | −0.8 to +0.1 % |
| | Peak p4−p1 | 7.94 kPa | 8.59 kPa | −7.5 % |
| | Panel release times 1-2, 1-4, 2-4, 3-4 | 3.25, 54.2, 1.75, 181.4 ms | 3.3, 53.9, 1.8, 186.6 ms | −2.8 to +0.6 % |
| | Panel opening times | 52.2, 26.0, 21.7, 31.5 ms | 55.6, 27.2, 23.2, 34.0 ms | −4.4 to −7.4 % |

Notes on the comparison:

- The paper reports the supercritical phase as the time until *all compartments* fall below 1.893 *p*ₐ; AirDeco uses the same definition and also lists the breach choking time separately.
- In the three-compartment case the 3.77 kPa peak quoted in the text corresponds to the cargo–cockpit curve of Fig. 7.
- The four-compartment case gives the hinged panel as a 0.4 m square, while Fig. 15 suggests a slightly larger area; AirDeco follows the text. This, and small differences in how the opening instant is detected, explain the few-percent spread in that case.
- Eq. (5) of the paper prints *ρ_j* (downstream density) inside the square root; the isentropic orifice equation uses the upstream density *ρ_i*, which AirDeco uses and which reproduces the paper's results.

## 10. Theory summary

The fuselage is divided into *N* rigid compartments with uniform properties. For compartment *i* with volume *V_i*:

- **Mass balance** (Eqs. 1, 6, 7): d*ρ_i*/d*t* = (ṁ_in − ṁ_out)/*V_i*.
- **Choked flow** from *i* to *j* when *p_i* ≥ *p_i*\* = ((γ+1)/2)^(γ/(γ−1)) *p_j* = 1.893 *p_j* (Eqs. 2–4):
  ṁ\* = *ρ_i* (2/(γ+1))^(1/(γ−1)) *A*_eff √(2γ*R T_i*/(γ+1)).
- **Subcritical flow** (Eq. 5): ṁ = *A*_eff √(2 *p_i ρ_i* γ/(γ−1) [(*p_j/p_i*)^(2/γ) − (*p_j/p_i*)^((γ+1)/γ)]).
- **State** (Eq. 8): *T_i/T*⁰ = (*p_i/p*⁰)^((n−1)/n) = (*ρ_i/ρ*⁰)^(n−1), with *n* = γ for the isentropic model.
- **Hinged panel** (Eqs. 9–13): *I* = *m*_p*b*²/3, θ'' = 3Δp*A*_p cos²θ/(2*m*_p*b*), *A*_open = *A*_p(1 − cos θ).
- **Translational panel** (Eqs. 14–16): *x*'' = Δp*A*_p/*m*_p, *A*_open = min[2(*A*_p/*b* + *b*)*x*, *A*_p].
- **Integration** (Eqs. 17–18): explicit Euler for densities and panel states; pressure and temperature then follow from Eq. (8).

A panel stays shut while the differential across it is below *p*_rel. After release it moves under the instantaneous differential (which may reverse) and stops at its maximum angle; a translational panel keeps moving after its open area reaches *A*_p. To prevent numerical overshoot near equalisation, the mass moved through a vent in one step is limited to half of what would equalise the two sides; this only acts in the last pascals of a transient.

The same equations are listed with their numbers in the *Model and equations* section at the bottom of the page.

## 11. Assumptions, limits and good practice

- **Zero-dimensional model.** Pressure is uniform inside each compartment. Pressure waves and local jets are not resolved, so the results are most reliable for compartments whose size divided by the speed of sound (a few ms) is short compared with the event.
- **Rigid structure.** Compartment volumes do not change; floors and partitions do not deflect or fail. To study a failing partition, model it as a blowout panel whose release pressure is the failure differential.
- **Isentropic expansion** gives the fastest decompression and the lowest temperatures. Real temperatures recover through wall heat transfer and moisture condensation (Haber 1950; Daidzic & Simones 2010). Use the polytropic option to bracket slower events.
- **Uniform ambient.** External pressure variations along the fuselage are not modelled. For a breach in a region of high suction or overpressure, enter an equivalent local static pressure in *Manual* mode.
- **Discharge coefficients** carry the irreversible losses. Typical values are 0.6–0.8 for sharp-edged openings and 0.8–1.0 for rounded passages. Run a sensitivity check on *C*_D when it is uncertain.
- **Panel forces.** Only the pressure force acts on panels (no friction, weight, lanyards or aerodynamic hinge moments), as in the paper. Panel *C*_D is constant with opening angle.
- **Time step.** 50 µs is adequate for typical aircraft compartments. Halve Δt and confirm that peak Δp changes by less than about 1 % when compartments are small (a few m³) relative to their vent areas, or when panels open in a few milliseconds.
- **Certification.** AirDeco is intended for preliminary design, trade studies and teaching. Decompression load cases for certification (CS/FAR 25.365) require a validated and documented method.

## 12. Files and tests

| File | Content |
|---|---|
| `index.html` | Page layout and styles. Open this file to use the tool. |
| `airdeco-app.js` | Interface: input forms, aircraft schematic, charts, tables, exports. |
| `airdeco-solver.js` | Gas-dynamics solver and ISA atmosphere. Runs in the browser and in Node.js (`require('./airdeco-solver.js').simulate(model)`). |
| `airdeco-model.js` | Conversion from interface units to the solver model, and the benchmark cases with their published reference values. |
| `tests/benchmarks.js` | Runs all benchmark cases and compares them with the paper. |

Run the regression check with Node.js 16 or newer:

```bash
node tests/benchmarks.js
```

It prints every compared quantity and exits with an error if any deviates from the published value by more than 10 %.

## 13. References

1. Pagani, A., Carrera, E. (2016). Gasdynamics of rapid and explosive decompressions of pressurized aircraft including active venting. *Advances in Aircraft and Spacecraft Science*, 3(1), 77–93.
2. Daidzic, N.E., Simones, M.P. (2010). Aircraft decompression with installed cockpit security door. *Journal of Aircraft*, 47(2), 490–504.
3. Haber, F., Clamann, H.G. (1953). Physics and engineering of rapid decompression: a general theory of rapid decompression. USAF School of Aviation Medicine, Report 3.
4. Haber, F. (1950). Physical process of explosive decompression. *J. Aviation Medicine*, 21(6), 495–499.
5. Mavriplis, F. (1963). Decompression of a pressurized cabin. *Canadian Aeronautics and Space Journal*, 9(10), 313–318.
6. Pratt, J.D. (2006). Rapid decompression of pressurized aircraft fuselages. *Journal of Failure Analysis and Prevention*, 6(6), 70–74.
7. Demetriades, S.T. (1954). On the decompression of a punctured cabin in vacuum flight. *Jet Propulsion*.
8. Streeter, V.L., Wylie, E.B. (1975). *Fluid Mechanics*. McGraw-Hill.
9. EASA (2014). Certification Specifications and Acceptable Means of Compliance for Large Aeroplanes, CS-25, Amendment 15.

## License

See [LICENSE](LICENSE).
