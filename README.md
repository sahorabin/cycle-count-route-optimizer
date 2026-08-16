# Cycle Count Route Optimizer

A browser-based tool that helps a warehouse worker plan a physical walking
route for a cycle count (a partial, recurring inventory audit) and compares
it against a system-generated route over the same stops.

## Problem statement

Warehouse workers doing cycle counts typically pick which bins to check and
then walk them in whatever order occurs to them. That order is rarely the
shortest path through the aisles, and there's usually no easy way to see how
much walking a better-ordered route would save before committing to one.

## What the application does

The app models a warehouse as a graph of aisles and cycle-count locations,
lets a worker pick today's count locations and build a visit order by
clicking them on a floor-plan map, then computes a system-recommended route
over the same stops and shows a side-by-side comparison — total distance,
estimated time, and percentage improvement — using only aisle-constrained
walking distance, never straight-line distance. After generating the
comparison, the worker can replay either route in the existing SVG warehouse
view using the same deterministic simulation state.

**This is a portfolio/demonstration project.** It runs entirely in the
browser against one deterministic, synthetic 100-location warehouse layout
included in the repository. It has not been deployed against a real
warehouse, and the distance/time figures it displays are computed results
from that included model — not measured or reported results from any real
facility or customer.

## Screenshots

<p>
  <img src="public/screenshots/desktop-route-comparison-ko.png" alt="Desktop view (Korean) showing the worker route vs. system-recommended route comparison, with distance units and both the location-state and route-line legends" width="700" />
</p>
<p>
  <img src="public/screenshots/mobile-map-swipe-ko.png" alt="375px mobile view (Korean) showing the zoomed, horizontally pannable warehouse map with the swipe guidance hint" width="260" />
</p>

Both screenshots show the included demonstration warehouse fixture, not a
real facility.

## Intended use case

Cycle counting is a common inventory-control practice: instead of shutting
down operations for a full physical inventory, a subset of locations gets
counted on a rotating basis. This app targets the "which locations today,
and in what order" planning step of that workflow — the kind of tool a
warehouse supervisor might hand to a picker at the start of a shift.

## Main workflow

The UI is organized as one page with three sequential steps:

1. **Select locations** — check which of the 100 locations need counting
   today, with search, zone filtering, and a compact "selected" tray.
2. **Build the worker's route** — click the selected locations on the map,
   in the order the worker intends to walk them. Office is always the fixed
   starting point; there is no return trip.
3. **Compare routes** — generate a system-recommended route over the exact
   same stops and see it plotted alongside the worker's route, with total
   distance, estimated time (from a configurable walking speed), and percent
   improvement.

Once a comparison exists, the **Route replay** section displays one route at
a time. The user can switch between the worker and recommended routes, play
or pause, reset, seek in either direction, and choose a playback rate without
changing the route's physical walking speed or duration.

A location can also be marked complete once counted, and a compact progress
panel tracks completed vs. remaining against a daily target count.

## Routing algorithms (verified against source)

All routing distance is computed over the aisle graph, never over the (x, y)
coordinates used for on-screen drawing — the included sample warehouse is
deliberately laid out so straight-line and aisle-constrained distance
diverge, so this distinction is actually exercised.

- **Dijkstra** (`src/domain/dijkstra.ts`) — single-source shortest paths over
  the walkable aisle-node graph, used to build an all-pairs distance matrix
  (`src/domain/distanceMatrix.ts`) over the start point plus every
  cycle-count location.
- **Nearest neighbor** (`src/domain/nearestNeighbor.ts`) — a greedy
  fixed-start heuristic: from the current point, repeatedly move to the
  closest unvisited target by aisle-constrained distance until all targets
  are visited. Never returns to the start.
- **2-opt local search** (`src/domain/twoOpt.ts`) — deterministic local
  search that repeatedly reverses route segments when doing so strictly
  reduces total distance, stopping at the first local optimum. It operates
  on an *open* path (no closed-tour edge back to the start), so segment
  reversals are handled accordingly rather than reusing a standard
  closed-tour formula.

The "system recommended route" shown in the UI is nearest-neighbor refined
by 2-opt. This is a reasonable heuristic combination, not a guarantee of the
mathematically optimal route — the UI deliberately never claims otherwise.

## Simulation architecture and completed phases

The deterministic simulation and rendering pipeline is:

```text
RouteComputation
→ RouteTraversal
→ RouteTimeline
→ SimulationSnapshot
→ SVG renderer
```

`RouteTraversal` expands a computed stop order through the existing
`pathMatrix`. `RouteTimeline` projects that traversal onto physical walking
time. The pure simulation engine derives a complete `SimulationSnapshot` for
any timeline time, and the SVG layer consumes that snapshot only to decide
where to draw the worker marker. SVG coordinates never determine routing
distance, elapsed time, progress, or KPI values.

Completed simulation phases:

- **S1 — RouteTraversal Foundation** — expands the fixed-start open route
  into its validated aisle-by-aisle traversal.
- **S2 — Deterministic RouteTimeline** — converts traversal distance into a
  deterministic physical timeline using the current walking speed.
- **S3 — Deterministic Simulation Engine** — projects any timeline time into
  an immutable simulation snapshot and supplies pure playback-clock controls.
- **S4 — SVG Simulation Replay** — connects the pure clock and snapshots to
  the existing warehouse SVG through a reusable single-route replay UI.

The next planned phase is **S5 — Side-by-Side Actual vs Recommended
Shared-Clock Comparison**.

3D rendering, Three.js, and React Three Fiber are **not implemented**. They
belong to a later phase after S5.

## Key features

- Click-to-build manual route on an SVG floor-plan map (rack blocks, aisle
  corridors, and bin markers — not a raw graph-node visualization)
- Four distinct, non-color-only location states: available, selected,
  in-route, completed
- Worker route vs. system-recommended route comparison with a single-sentence
  savings summary, and a route-visibility toggle (worker / recommended / both)
- A deterministic single-viewport SVG replay for either the worker/actual or
  recommended route, with Play/Pause, Reset, bidirectional seek, and 0.5x,
  1x, 2x, 5x, and 10x playback-rate presets
- Replay status sourced from simulation truth: elapsed simulation time,
  distance traveled, and completed locations
- Responsive replay controls and warehouse viewport support on mobile
- A collapsed "technical details" panel showing the raw Nearest Neighbor vs.
  2-opt output, kept separate from the primary worker/recommended comparison
- A deterministic, generated 100-location fixture (10 zones × 10 bins) with
  no `Math.random` anywhere in its construction

## Localization

A small custom `t()`-based translation layer (`src/i18n/`) drives the entire
UI in Korean (default) and English, with live switching and no page reload.
There is no external i18n library dependency.

## Persistence

Target count, completed-location ids, language, walking speed, selected
locations, manual-route stop order, and whether a comparison was generated
persist to `localStorage` (`src/persistence/persistedState.ts`). Each field is
validated independently on load and falls back to a default if malformed, so
one corrupted field can't take down the rest of the saved state. Stored ids
are reconciled with the live 100-location fixture and current selection.

Runtime simulation state is deliberately ephemeral. Current replay time,
playing/paused state, playback rate, replay-route mode, snapshot completion,
and marker position are not persisted.

## Responsive behavior

The layout is a single page (not separate routes) that adapts across three
breakpoints, down to a 375px-wide mobile viewport. On mobile, the map
defaults to a zoomed-in, horizontally pannable view — with a short on-screen
hint — instead of shrinking the whole floor plan to an unreadable size; a
"view full warehouse" toggle switches to a fit-to-width view. Horizontal
scrolling stays confined to the map viewport; it does not cause page-level
overflow.

## Tech stack

- React 19 + TypeScript
- Vite 8 (build/dev server)
- Vitest 4 + @testing-library/react (354 tests across 36 files)
- oxlint (linting)
- No backend, no external API calls, no runtime dependencies beyond React
  itself

Current verified baseline:

```text
354 tests passed
0 failed
TypeScript PASS
lint PASS
production build PASS
```

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL. No environment variables or backend setup
are required.

## Scripts

```bash
npm run dev         # start the Vite dev server
npm test             # run the test suite once (vitest run)
npm run test:watch   # run tests in watch mode
npm run lint         # oxlint
npm run build        # tsc -b && vite build (this also performs type-checking;
                      # there is no separate typecheck script)
npm run preview      # locally preview the production build
```

Run a single test file: `npx vitest run src/domain/twoOpt.test.ts`
Run tests matching a name: `npx vitest run -t "nearest neighbor"`

## Project structure

The app keeps routing and simulation truth below its presentation adapters:
**domain → simulation/UI adapters → React components**. Domain code never
imports from `simulation/`, `ui/`, or `components/`; renderer code only
consumes completed domain/simulation values.

```
src/
  domain/        Graph validation, routing algorithms, fixed-start-open-path
                  contract, RouteTraversal, and RouteTimeline
  simulation/    Pure snapshot projection and playback-clock state operations
  ui/             Presentation-only helpers with no domain logic
                  (SVG coordinates, route-path expansion, comparison math,
                  simulation-marker projection, duration formatting, rack layout)
  components/     React components (map, selectors, route editor, comparison
                  panel, single-route replay, progress, workflow, language)
  i18n/           Translation context, dictionary, and hook
  persistence/     localStorage read/write with per-field validation
  hooks/          Manual-route state and the React playback-frame adapter
  data/           The sample and 100-location warehouse fixtures
```

## Known scope and limitations

- Single, synthetic, hard-coded warehouse layout — there is no way to import
  a real facility's floor plan or import/export location data.
- No backend: all state is local to one browser (`localStorage`), so there
  is no multi-user or multi-device sync.
- No authentication, and no real-world GPS or indoor-positioning
  integration — location coordinates are display-only SVG positions, not
  real-world measurements.
- Replay currently shows one route viewport at a time. Side-by-side
  Actual-vs-Recommended playback with a shared clock is planned for S5.
- No 3D/WebGL renderer is present; Three.js and React Three Fiber are reserved
  for a later phase after S5.
- The "technical details" panel (raw Nearest Neighbor vs. 2-opt) is
  intentionally left untranslated/unstyled as a transparency artifact, not a
  primary UI surface.
- This project has not been deployed or used against a real warehouse; all
  distance/time figures shown are computed from the included model, not
  reported operational results.

## Portfolio-oriented design and engineering decisions

This project was built to demonstrate a few specific things end to end:

- A clean separation between routing math (never touches pixels) and display
  geometry (never touches distance) — enforced by the one-way
  domain/simulation-to-renderer flow and exercised by a warehouse layout
  where the two distance notions actually diverge.
- Test-driven development throughout: each domain module pairs a pure
  validator/compute function with a throwing "assert" wrapper, and both are
  covered by tests written alongside the implementation.
- Accessibility as a first-class constraint: location states are
  distinguished by shape/icon/border, not color alone; the progress bar
  carries full ARIA `role="progressbar"` semantics.
- Bilingual UI built without an external i18n framework, to keep the
  dependency surface minimal for a small app.
