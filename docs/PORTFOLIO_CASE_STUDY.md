# Cycle Count Route Optimizer

A warehouse cycle-count planning and execution tool: select the bins to count, plan a
visit order, compare it against a computed recommendation, then watch both routes execute
in a 3D Digital Twin driven by one shared simulation clock.

**Live:** https://cycle-count-route-optimizer.vercel.app
**Stack:** React · TypeScript · Vite · Three.js / React Three Fiber
**Scope:** individual project — I designed, built, tested, and deployed all of it.

---

## Executive Summary

Cycle counting requires a worker to walk to many storage locations in one shift. The
sequence they walk in decides how much of that shift is spent walking rather than counting,
and warehouse walking is constrained by aisles, not by straight lines.

I built a tool that models this as an operational routing problem. A warehouse is a graph of aisle
nodes and edges, each bin hanging off one node by a short access spur. Distances come from Dijkstra over that aisle network. The worker's
own visit order is compared against a recommendation produced by a Nearest Neighbor
heuristic refined with 2-opt local search — a heuristic, not a proven-optimal TSP solution.

The separation underneath is what I care about most. Travel and counting service time
are modeled as distinct phases on one physical timeline, and replay
speed is decoupled from physical walking speed, so speeding up the animation never changes
a distance, a duration, or a KPI. A 3D Digital Twin then replays that timeline without
being allowed to redefine any of it.

---

## The Operational Problem

Cycle counting is continuous inventory verification: instead of shutting the building down
for a full physical count, a worker counts a subset of locations every day. The work has two
distinct components, and conflating them is the mistake that makes naive tooling useless:

1. **Travel** — walking between storage locations. Necessary non-value-added time: it enables
   the count but does not itself improve inventory accuracy.
2. **Service (counting)** — the actual work at a bin: locating the item, counting it,
   recording it. This is the value-adding part, and its duration depends on the location,
   not on the route.

Route sequence only affects the first. No matter how well you sequence the day, the counting
work is what it is. That has two consequences that shape the whole design:

- **Optimizing the route can only ever compress the travel component.** A tool that reports
  a single blended "time saved" number overstates its own value, because part of that time
  was never addressable.
- **The two components must still be modeled together**, because the operator experiences one
  continuous shift. A plan that shows only walking time doesn't describe a real workday.

There is a third constraint that separates warehouse routing from generic point-to-point
optimization: **workers cannot walk through racking.** Two bins can be metres apart in a
straight line and far apart on foot, because reaching one from the other means walking to the
end of an aisle and back down the next. Any distance measure taken from screen coordinates or
3D world positions is simply wrong for this domain.

## Product Thesis

> Can warehouse cycle-count execution be modeled as an aisle-constrained routing problem,
> improved by heuristic optimization, and then made legible to an operations audience through
> a Digital Twin replay that visualizes the plan without being allowed to alter it?

The second half is the part I treated as a real engineering requirement rather than a demo
feature. A visualization that quietly recomputes its own geometry is a rendering, not a twin.

## How the Workflow Works

The final flow, as implemented:

1. **Select locations.** The worker picks incomplete bins from the 100-location warehouse,
   filterable by zone and searchable by label.
2. **Selection order becomes the proposed route.** Checking a location appends it to the
   worker's stop list (`toggleSelected` → `manualRoute.addStop`). There is no separate
   "now build a route" step — the plan is a by-product of choosing the work.
3. **Refine the order.** Stops can be reordered by drag-and-drop, or with move-up/move-down
   buttons as a keyboard-accessible equivalent, and removed individually.
4. **Generate the recommendation.** One explicit action computes the system route over the
   *exact same target set*, so the two routes can never differ in membership — only in
   sequence.
5. **Compare.** Distance and time for both routes, plus the distance improvement and walking-time
   saving.
6. **Enter the Digital Twin** and play the execution.
7. **Watch travel and counting states** — the operator walks, arrives, counts at the bin, and
   only then moves on.
8. **Track progress** as locations complete.
9. **Mark work complete.** Completed locations are removed from the selection and the route.
10. **Completed locations are locked out of reselection** (`if (completedIds.has(id)) return;`),
    with an explicit undo for mistakes.

Selection, completion state, language, walking speed, and the manual stop order persist to
`localStorage`, validated field-by-field on load so one corrupt value falls back to its own
default instead of discarding the whole saved session. Persisted ids are also cross-checked
against the current warehouse fixture, so a stale id can never resurrect as "completed".

## Route Optimization Architecture

**The warehouse graph** distinguishes two kinds of point, and keeping them distinct is the
core modeling decision:

- **Aisle nodes** are walkable positions in the aisle network, joined to each other by edges
  with real lengths.
- **Attachment points** — every cycle-count location, plus the start/office point — are *not*
  walkable. Each hangs off exactly one aisle node by an access-spur distance.

This is what prevents the single worst bug class in warehouse routing: a bin being silently
used as a pass-through waypoint in someone else's path. A worker walks *past* a rack face,
never *through* a bin.

**The optimization stack:**

| Stage | Role |
|---|---|
| `dijkstra.ts` | Single-source shortest paths over the aisle network **only**. Attachment points never enter this graph. |
| `distanceMatrix.ts` | All-pairs aisle-constrained distances over the visit set — the start point plus the locations being routed (101 across the full fixture) — plus a path matrix used for traversal and rendering, never for distance. |
| `nearestNeighbor.ts` | Greedy construction: from the start, repeatedly go to the closest unvisited target. Ties broken by input order, so results are deterministic. |
| `twoOpt.ts` | Local search: reverse contiguous segments while that strictly improves the total, stopping at the first local optimum. |

**What I am careful not to claim.** This is **heuristic optimization**. Nearest Neighbor plus
2-opt reaches a *local* optimum, not a proven global one — it is not an exact TSP solver, and
there is no machine learning anywhere in this project. In the comparison UI the improvement
figure is clamped at zero rather than ever shown negative, and for well-chosen selections the
worker's own route legitimately ties the recommendation at 0.0%. I would rather ship a tool
that sometimes says "your route was already good" than one that manufactures a win.

Two implementation details I consider load-bearing:

- **2-opt scores every candidate with the real open-route total**, never an incremental delta
  formula. Delta formulas for 2-opt assume a closed tour with an edge back to the start; this
  route is a fixed-start *open path* with no return trip, so a suffix reversal changes the final
  destination. A borrowed closed-tour formula would silently mis-score exactly those moves.
- **Termination is argued, not capped.** Every applied move strictly decreases total distance
  and the permutation set is finite, so no order can recur — no artificial iteration limit is
  needed.

## Simulation Model

Route truth flows through three layers, each with one job:

- **`RouteTraversal`** — spatial truth. Expands the chosen order into the actual node-by-node
  walk through the path matrix, without recomputing or reordering anything.
- **`RouteTimeline`** — temporal truth. Projects that traversal onto one physical time axis as
  an ordered phase list: `TRAVEL … TRAVEL → SERVICE → TRAVEL … TRAVEL → SERVICE → …`, one travel
  phase per segment and exactly one service phase per leg. It reports
  `walkingDurationSeconds`, `serviceDurationSeconds`, and their sum, and it cross-checks its own
  accumulated walking time against the distance-based expectation, throwing if they disagree.
- **`SimulationSnapshot`** — renderer-independent state at one instant. A pure
  time-to-state projection with no memory of how it got there.

**Counting service time** is assigned per location from a stable ordinal of the location id
alone, mapping to 20 / 35 / 60 seconds for simple / standard / complex. Because it derives
from the id, a location always carries the same service workload regardless of route order or
which of the two routes is being simulated — which is exactly what makes the comparison fair.
These durations are **explicitly labeled synthetic demo assumptions in the source and disclosed
in the UI**; they are not measured industry productivity standards, and I do not present them as
such.

**Service time never enters optimization.** It is absent from Dijkstra, Nearest Neighbor, 2-opt,
route ordering, route scoring, and the walking-optimization KPI. It exists only as simulation
workload. This is the operational insight from the problem statement, enforced structurally
rather than by convention.

Several rules the snapshot enforces that matter operationally:

- During service the worker **stays put** and distance travelled does not increase.
- A location is marked complete on **service completion, not arrival.** Arriving at a bin is not
  counting it.
- The route completes only after the final service phase ends.

**Playback rate is not speed.** `walkingSpeedMetersPerMinute` (default 60) is physical and feeds
the timeline. `playbackRate` (0.5×–10×) multiplies only the real frame delta as it advances the
clock. Changing playback rate cannot rebuild or alter the timeline, route distance, service
durations, or any KPI — it changes how fast you watch, never what happened. Getting this wrong
is the standard way a simulation demo ends up reporting numbers that shift when someone hits
fast-forward.

## Digital Twin Architecture

The 3D layer exists because the audience for this tool is operational, not algorithmic. A route
order printed as a list of bin ids does not let anyone judge whether a plan is sensible. Seeing
an operator cross a building because two consecutive stops sit in different zones does.

The pipeline is strictly one-directional:

```
RouteComputation → RouteTraversal → RouteTimeline → Shared Playback Clock
                 → SimulationSnapshot → Renderer projection → SVG or 3D
```

**The renderer/domain firewall** is the architectural rule I enforced hardest: the renderer
*consumes* operational truth and may never redefine routing, distance, simulation state, or KPIs.
Display `(x, y)` coordinates and Three.js world coordinates are presentation-only. Routing
distance comes exclusively from aisle edge lengths and access-spur distances.

I did not leave this to discipline. **Two automated tests enforce it:**

- A coordinate-independence test applies an *anisotropic* affine transform to every display
  coordinate — unequal x/y scaling plus an axis swap and a large offset — and asserts both routes'
  order and total distance are byte-identical afterwards. The transform is deliberately not a
  translation, rotation, or uniform scale, because those preserve pairwise Euclidean distances and
  would let a coordinate-based implementation pass vacuously.
- An import-boundary test globs every `domain/` and `simulation/` source file and asserts none of
  them reference the renderer or asset layer, with a non-vacuity check on the file count.

**Comparison is one clock feeding two timelines.** Both sides share simulation time, walking
speed, warehouse, selected locations, start point, and per-location service profile. The only
intended variable is route sequence — and the UI states that explicitly.

**No renderer animation owns time.** Every motion — counting gesture, progress ring, completion
pulse, camera blend, and the walk cycle — is a pure function of existing snapshot values. There is
no second `requestAnimationFrame` loop, no `Date.now()`, no `setInterval` animation. One playback
loop drives everything.

## Warehouse Operator & Service Visualization

The visual layer was built up over several passes, from procedural primitives to imported assets.
Rather than recount that history, the principle is the point: **visual realism increased while
simulation truth stayed isolated.** Not one warehouse coordinate, distance, or duration moved to
accommodate an asset.

The final scene uses CC0-licensed models — steel shelving, a wooden pallet, a cardboard box, and a
rigged human operator — each shipped with its own `LICENSE.txt` and declared in an asset registry
that records source, licence, attribution, and the world envelope the model must normalize into.
Every imported model is fitted into the envelope the existing procedural descriptor already
occupied, so an asset can never widen a rack or eat the operator's aisle clearance. The forklift,
bollards, barriers, floor markings, and staging loads are procedural context geometry, not imported
assets.

**Fallbacks are per category and tested.** A failed pallet load leaves cartons real; a failed
operator load falls back through a static bake to a fully procedural 14-primitive figure. The app
renders correctly with zero assets available.

The detail I am most pleased with is **the walk cycle being a function of distance, not time**:

```
gaitCycles = distanceTraveled / WORKER_GAIT_CYCLE_METERS   // 1.15 m stride
walkTime   = fract(gaitCycles) × clipDuration
```

The `AnimationMixer` is used as a *sampler* — the code sets `action.time` from the gait and calls
`mixer.update(0)`, never letting the mixer advance itself. Because the gait derives from route
distance, pausing freezes the legs mid-stride, seeking lands on the pose that genuinely belongs to
that point of the route in either direction, and 10× playback cycles the legs ten times faster
because the distance does. A clock-driven animation would decouple from the route the moment
anyone touched the transport controls.

PPE is applied renderer-side by material name — hi-vis vest, dark workwear, boots, blue hard hat,
and a scanner snapped to the hand bone so it rides the swinging arm. **Route identity never touches
the body**: both operators are the same person in the same PPE, with identity carried only on a
floor ring and locator pip, so the two Compare viewports differ by route sequence and nothing else.
A test asserts no identity colour appears in the PPE map.

## UX Design Decisions

**Selection order *is* the route.** The alternative — asking users to draw a path on a map — is
worse operationally: it is fiddly, error-prone, hard to do accessibly, and it asks the user to
express a sequence in a medium built for position. Warehouse workers already think in terms of "these
are the bins I'm doing today." Deriving the initial sequence from the order they name the work
respects that, and drag-reordering is then a *refinement* on a sensible default rather than a blank
canvas.

**One unified Digital Twin workspace**, not a page of cards. Planning, KPIs, the 3D stage, the SVG
minimap, camera controls, and the transport timeline share one shell. Explore (one route, in detail)
is the default; Compare (two synchronized viewports) is the analytical mode.

**Progressive disclosure** through a three-step workflow indicator — select, generate and compare,
play simulation — so the interface reveals capability as the user earns context.

**Compare never auto-frames.** Automatic story-camera framing exists only in Explore. If the two
Compare viewports could move independently, the side-by-side would stop being a fair comparison, so
they stay under one synchronized manual camera channel.

**Completion is a workflow state, not a checkbox.** Completed locations leave the selection, leave
the route, and are locked from reselection — with undo. That reflects how the work actually behaves:
you don't recount a bin you just counted, but you do need to recover from a mis-click.

**Renderer mode and view mode never reset playback.** Switching 2D/3D or Explore/Compare preserves
simulation time, timelines, snapshots, and completion state. Changing how you're looking at something
should not restart it.

The interface is fully bilingual (Korean / English), responsive, and stacks on mobile. The 2D SVG
renderer remains truthful for position, service state, progress, and completion, and is the automatic
fallback when WebGL cannot initialize.

## Engineering Architecture

Dependency direction is enforced in one direction only: **domain → simulation → UI adapters → React
components.** Domain code imports nothing from `simulation/`, `ui/`, or `components/`.

Each domain module with an app-facing boundary follows one pattern: a pure `validateX` returning a
result object, plus an `assertX`/`buildValidatedX` wrapper that throws a descriptive typed error.
Route computation always calls the throwing wrapper, so an invalid state surfaces at the boundary
rather than propagating as a plausible-looking wrong number.

Rendering performance decisions:

- **Demand-driven rendering** (`frameloop="demand"`) with DPR capped at 1–1.5 and no post-processing.
- **Instanced geometry** for all repeated warehouse structure — 218 pallets and 218 cartons render in
  two draw calls.
- **Lazy-loaded 3D.** The entire Three.js/R3F viewport is a dynamic import; `GLTFLoader` is
  dynamically imported inside that. The initial page load fetches only the main bundle, CSS, and a
  favicon.
- **Module-level promise cache** per asset id: one fetch, one parse, one geometry, one material shared
  across every instance and both Compare viewports.
- **Level of detail** driven by a quantized zoom bucket, so orbiting produces a handful of React
  updates rather than one per frame.

## Verification & Performance

Final verified state at the frozen checkpoint (commit `50d52d8`):

```
657 tests passed / 0 failed
47 test files
TypeScript   PASS
lint         PASS
production build PASS
```

Test coverage spans the domain pipeline (Dijkstra, distance matrix, Nearest Neighbor, 2-opt, route
order, traversal, timeline, walking duration), the simulation layer (playback clock, snapshot), the
persistence layer, the React components, and the 3D descriptor layer — including the two architectural
firewall tests described above and tests that read the *shipped glTF's own accessors*, so asset claims
track the real files rather than copied constants.

**Production runtime measurement.** I measured the deployed build in real Chrome via Playwright,
sampling `requestAnimationFrame` intervals for 9 seconds per scenario with a `longtask` observer
running:

| Scenario | Samples | Median | p95 | Worst | Frames > 33 ms | Long tasks |
|---|---|---|---|---|---|---|
| Explore, Overview, playing | 540 | 16.7 ms | 16.8 ms | 17.8 ms | 0 | 0 |
| Worker Focus, playing | 540 | 16.7 ms | 16.7 ms | 17.7 ms | 0 | 0 |
| Compare, dual canvas, playing | 540 | 16.7 ms | 16.8 ms | 17.6 ms | 0 | 0 |

Asset reuse was verified across 14 consecutive Explore↔Compare cycles: the resource count held at
exactly 20 total / 20 unique, confirming zero refetch. Entering the Digital Twin paints a canvas in
under a second, with remaining asset streaming happening behind an already-rendered scene.

**Scope of these numbers.** These are measurements from **one tested desktop Chrome environment against
the deployed production build**, not a claim about all devices. A 375×812 run was also clean, but that is
Chrome *viewport emulation on a desktop GPU* — it validates layout, WebGL initialization, and main-thread
pacing, not real mobile GPU fill rate, which remains untested.

I ran this measurement pass specifically to decide whether optimization was warranted, and concluded it
was not. The build emits a bundle-size warning for the lazy 3D chunk; since that chunk is measurably off
the initial load path and first paint is sub-second, I chose not to refactor for a prettier build log.
Declining to optimize on measured evidence was the deliverable of that pass.

## Key Trade-offs

**Heuristic optimization over exact TSP.** Nearest Neighbor plus 2-opt is fast, deterministic, and good
enough to demonstrate the operational point. Claiming optimality would be false, and an exact solver
would add cost and complexity without changing what the tool teaches its user.

**Two independent Compare canvases over a shared scene with two cameras.** The shared-scene approach
uses less GPU memory. I kept two independent roots because they give route isolation, camera isolation,
and skeleton isolation for free, and because measurement showed Compare frame pacing is identical to
single-canvas Explore. The correctness properties were worth more than the memory, and I verified that
rather than assuming it.

**Synthetic service durations, explicitly disclosed.** I had no measured productivity data. I could have
quietly picked plausible numbers; instead the source marks them `source: "synthetic-demo"` and the UI
discloses it. A model honest about its inputs is more useful than one that looks authoritative.

**Imported racking fitted per axis to the existing footprint.** This compresses the model relative to its
natural proportions. I accepted the visual compromise because the alternative — letting the asset dictate
layout — would have changed aisle clearances, which are operational truth. Layout is truth; the asset
conforms to it.

**A distance-driven gait over a time-driven one.** More complex to implement, but it is what makes pause,
seek, and playback-rate behave correctly. A time-driven walk would look identical until someone touched the
transport controls, then be obviously wrong.

## What This Project Demonstrates

**Logistics domain modeling** — aisle-constrained warehouse topology; the walkable-network vs.
attachment-point distinction; separating travel overhead from value-adding service work; understanding that
route sequence compresses only the former; completion-state workflow reflecting how counting work actually
closes out.

**Algorithms** — graph modeling; Dijkstra shortest paths; all-pairs distance matrices; greedy construction
and 2-opt local search over a fixed-start *open path* rather than a closed tour; deterministic tie-breaking;
reasoning about termination rather than capping iterations.

**Software architecture** — enforced one-directional dependency flow; validate/assert boundary pattern with
typed errors; pure projection layers; architectural invariants encoded as executable tests rather than
documentation; defensive persistence with per-field validation.

**3D and real-time rendering** — Three.js / React Three Fiber; a licence-audited asset pipeline with
normalization and per-category fallbacks; instancing; demand-driven rendering; LOD; rigged skeletal animation
driven from domain state instead of a clock.

**Product and engineering judgment** — designing a workflow around how the work is actually done; progressive
disclosure; measuring production performance before optimizing, then declining to optimize on the evidence;
choosing correctness isolation over a cleverer architecture; scoping claims to what the evidence supports.

## Production

Deployed on Vercel at https://cycle-count-route-optimizer.vercel.app, serving the frozen checkpoint
`50d52d8`. Bilingual (Korean / English), responsive, with a 2D SVG fallback when WebGL is unavailable.

```bash
npm run dev     # Vite dev server
npm run build   # tsc -b && vite build
npm test        # vitest run
npm run lint    # oxlint
```

---
---

# Internal Working Sections

*The material below supports later README condensation and asset production. It is not part of the
public case study.*

## Media Evidence Plan

Minimum set to prove the project's claims.

| # | Asset | Format | What must be visible | Claim it proves |
|---|---|---|---|---|
| 1 | Planning workspace with ordered route | Screenshot | Left panel location list with several checked; numbered stop list; SVG planning map showing the ordered path; step indicator on step 1–2 | Selection order becomes the worker's route; planning is aisle-aware, not free-drawn |
| 2 | Worker vs Recommended KPI comparison | Screenshot | Both route totals, distance improvement %, walking-time saving, and the "Only the route sequence differs" disclosure line | The comparison is controlled — same targets, same speed, same clock — and improvement is reported honestly |
| 3 | 3D warehouse Overview | Screenshot | Full warehouse from the Overview preset: rack runs, aisles, floor markings, forklift/staging context | Digital Twin renders a plausible industrial facility, not an abstract diagram |
| 4 | Worker Focus during travel | **Video** (6–10 s) | Operator walking down an aisle, legs cycling, route overlay showing traversed vs planned legs, KPI panel ticking | The gait is real and distance-driven; travel state is distinct from counting |
| 5 | COUNTING / scanner state | **Video** (6–10 s) | Operator arrived at a bay, scanner raised, scan cue, progress ring filling, HUD showing service class and countdown, distance frozen | Service is a modeled phase, not a pause; worker stays put; completion fires on service end, not arrival |
| 6 | Compare view, both routes playing | **Video** (10–15 s) | Two viewports, synchronized cameras, both operators moving on one clock, diverging sequences, completion counts advancing at different rates | One clock feeds two timelines; the only variable is route sequence |
| 7 | Completion workflow | Screenshot pair or short video | Before: locations selected. After: marked complete, removed from route, greyed and unselectable in the list | Completion is a workflow state with lockout, not a cosmetic checkbox |
| 8 | Playback-rate invariance | **Video** (8 s) — *optional but high value* | Rate toggled 1× → 10× while KPI totals and route distance stay numerically unchanged; legs cycle faster | Replay speed is decoupled from physical truth — the hardest claim to prove in a still image |

Videos are essential for 4, 5, 6, and 8: each proves a *temporal* property that a screenshot cannot.
Screenshots suffice for 1, 2, 3, and 7. Capture at 1440×900, English UI, using a selection spread across
several zones so the two routes visibly differ (a single-zone selection can tie at 0.0%).

## Architecture Diagram Spec

Text specification for the diagram to be produced in a later task. Three flows, accurate to implementation.

**Flow A — Planning to presentation (the main spine)**

```
User Planning                  (TargetSelector, ManualRouteEditor, useManualRoute)
  → Route State                (selected ids + ordered stop ids; persisted)
  → Graph / Optimization       (validateGraph, targetSelection, dijkstra,
                                distanceMatrix, nearestNeighbor, twoOpt, routeOrder)
  → RouteTraversal             (spatial truth: node-by-node walk)
  → RouteTimeline              (temporal truth: travel + service phases)
  → SimulationSnapshot         (state at one instant)
  → 2D / 3D Presentation       (WarehouseMap · Warehouse3DViewport)
```

**Flow B — Warehouse data (feeds the graph, left side)**

```
Warehouse Fixture (largeWarehouse.ts)
  → Warehouse Graph            (aisle nodes + edges | attachment points + access spurs)
  → Distance / Route Computation
```
Annotate: *aisle edge lengths and access-spur distances are the only distance sources.*
Side branch, drawn to the renderer only: `WarehouseSpatialLayout → renderers` — display-only, never routing.

**Flow C — Playback (drives the snapshot, feeds visualization)**

```
PlaybackClock (one shared clock)
  → simulationTime
      ├→ Worker Timeline      → Worker Snapshot      → Renderer projection
      └→ Recommended Timeline → Recommended Snapshot → Renderer projection
  → Worker / Service Visualization  (gait from distanceTraveled; counting gesture
                                     from service elapsedSeconds)
```

**Elements the diagram must convey:**

- A **firewall line** between simulation truth and presentation, with arrows crossing it in one direction
  only. Label it: *renderers consume truth; they never redefine routing, distance, state, or KPIs.*
- A **side input** for `playbackRate`, entering **only** the PlaybackClock — visually distinct from
  `walkingSpeedMetersPerMinute`, which enters **only** RouteTimeline. These two must never touch.
- **Count service profiles** entering **only** RouteTimeline — explicitly *not* connected to the
  optimization box.
- The **two-timeline fan-out** from one clock, since that is the core of the Compare architecture.
- Colour or weight distinguishing three bands: domain (routing truth), simulation (temporal truth),
  presentation (renderers).

Keep it one page. No implementation detail below module granularity.

## Evidence Notes

Claim-to-source map for later README editing. Conceptual references, not API docs.

| Claim | Evidence |
|---|---|
| Aisle-constrained shortest paths; attachment points excluded from the walkable graph | `src/domain/dijkstra.ts` |
| All-pairs distances + path matrix over the visit set (start plus routed locations) | `src/domain/distanceMatrix.ts` |
| Greedy construction, deterministic tie-breaking by input order | `src/domain/nearestNeighbor.ts` |
| 2-opt on real open-route totals, not delta formulas; termination argued | `src/domain/twoOpt.ts` |
| Fixed-start open-path contract enforced | `src/domain/routeOrder.ts` |
| Spatial truth expanded without recomputation | `src/domain/routeTraversal.ts` |
| Travel + service phases, duration cross-check | `src/domain/routeTimeline.ts` |
| Canonical distance ÷ speed rule | `src/domain/walkingDuration.ts` |
| Time-to-state projection; completion on service end; distance frozen during service | `src/simulation/simulationSnapshot.ts` |
| Playback rate multiplies real frame delta only | `src/simulation/playbackClock.ts`, `src/hooks/useSimulationPlayback.ts` |
| Synthetic service classes 20/35/60 s, stable per location id, `source: "synthetic-demo"` | `src/data/demoCountService.ts` |
| 100 locations / 10 zones / all mutually reachable | `src/data/largeWarehouse.ts` + `largeWarehouse.test.ts` |
| Selection order → route; completion lockout; both routes over identical target set | `src/App.tsx` (`toggleSelected`, `markSelectedComplete`, `computeRecommendedRoute`) |
| Drag reordering + keyboard move-up/down | `src/components/ManualRouteEditor.tsx`, `src/hooks/useManualRoute.ts` |
| Per-field validated persistence with fixture cross-check | `src/persistence/persistedState.ts` |
| Improvement clamped at zero, never negative | `src/ui/routeComparison.ts` |
| **Renderer independence proven by anisotropic coordinate displacement** | `src/ui/coordinateIndependence.test.ts` |
| **Domain/simulation never import the renderer or asset layer** | `src/ui/warehouse3dAssetRegistry.test.ts` (import-boundary test) |
| Asset provenance: source, licence, attribution, envelope | `src/ui/warehouse3dAssetRegistry.ts` + per-asset `LICENSE.txt` |
| Cached asset loading with per-category procedural fallback | `src/ui/warehouse3dAssetLoader.ts`, `src/ui/warehouse3dStorage.ts` |
| Distance-driven gait; mixer used as sampler | `src/ui/warehouse3dWorker.ts` (`WORKER_GAIT_CYCLE_METERS`), `src/ui/warehouse3dAnatomicalGait.ts`, `src/components/Warehouse3DViewport.tsx` |
| PPE by material name; identity never on the body | `src/ui/warehouse3dWorker.ts` (`WAREHOUSE_OPERATOR_PPE`) |
| Lazy 3D boundary | `src/components/RouteSimulationReplay.tsx` (`lazy` + `Suspense`) |
| Demand rendering, DPR cap, instancing | `src/components/Warehouse3DViewport.tsx` (`frameloop="demand"`, `dpr={[1,1.5]}`, `InstancedMesh`) |
| Synchronized Compare cameras outside React | `src/ui/warehouse3dCamera.ts` (`createWarehouseCameraChannel`) |
| Forklift/bollards/barriers are procedural, not imported | `src/ui/warehouse3dEnvironment.ts`; registry entry `forklift` has `license: "none"` |

**Claims deliberately not made:** no customer usage, deployments, adoption, revenue, ROI, testimonials, or
measured warehouse savings — none exist. No claim of global optimality, exact TSP solving, AI/ML, or that
service durations reflect real productivity standards. Performance numbers are scoped to one tested desktop
Chrome environment.
