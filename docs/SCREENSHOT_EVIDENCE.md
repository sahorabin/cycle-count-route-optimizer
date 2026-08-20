# Screenshot Evidence Map

Internal portfolio-support notes. Not final README copy.

**Capture conditions.** Production build at https://cycle-count-route-optimizer.vercel.app,
real Google Chrome via Playwright, 1440×900, `deviceScaleFactor: 1`, English UI, dark theme.
All four frames come from one continuous session on one scenario.

**Scenario.** Seven bins across both rack blocks, selected in the order a task list sorted by
**bin ID** rather than by location would arrive: G-02, H-03, A-04, I-05, E-06, C-07, B-09. The
rule was fixed in advance, not tuned for a good number: 1,161.5 m worker vs 656 m recommended,
a 43.5% improvement. For reference the same bins in zone order give 0.0% (already optimal) and
a block-alternating order gives 53.1%; the bin-ID rule held at 43–45% across 6, 7, and 8
locations, so it is representative rather than cherry-picked.

## planning-workspace.png

**Claim proved:** A worker can define a cycle-count route operationally — selection order
becomes the visit order, and that order is editable before anything is optimized.

**What to notice:** Seven numbered stops with drag handles and per-row remove; the same
sequence mirrored in the LIVE WORKER ROUTE strip; numbered markers and the provisional path on
the aisle-constrained map; the primary "Generate recommended route" CTA. No path drawn by hand.

**Case-study section:** How the Workflow Works · UX Design Decisions

## route-comparison.png

**Claim proved:** The operator's route and a heuristic recommendation are computed over
identical inputs and compared on real values.

**What to notice:** Two labelled viewports — WORKER ROUTE and SYSTEM RECOMMENDED ROUTE — with
visibly different path shapes; worker 22:37 vs recommended 14:11; 43.5% distance improvement
(505.5 m); 8:26 walking-time saving; and the disclosure line "Same warehouse · Same locations ·
Same start · Same walking speed · Same clock — Only the route sequence differs." Travel (19:22)
and counting (3:15) are reported separately. Nothing here claims optimality.

**Case-study section:** Route Optimization Architecture · Simulation Model

## digital-twin-overview.png

**Claim proved:** The plan is executed in an operational Digital Twin, not just drawn as a 2D
route.

**What to notice:** Rigged operator in blue hard hat and hi-vis vest walking inside the
racking; imported rack, pallet and carton assets; aisle markings and light masts; the route
overlay; live KPIs (3/7 locations, 625 m of 1,161.5 m) and the minimap. Frame taken mid-travel
in an open aisle — during a count the operator stands inside a bay, partly occluded.

**Case-study section:** Digital Twin Architecture · Warehouse Operator & Service Visualization

## completion-workflow.png

**Claim proved:** Completion is modeled as operational state — completed locations leave the
active target pool.

**What to notice:** Today's progress at 35%, Completed 7 / Remaining 13 against a target of 20,
with Undo completion available; seven green completed markers on the map alongside two newly
selected locations in a fresh visit order; and in the list, "Zone A – Bin 04" struck through
and badged ✓ Completed with its checkbox **disabled**. That lockout was also confirmed
programmatically during capture (`disabled: true` for a completed bin, `false` for an
uncompleted one).

**Case-study section:** How the Workflow Works · What This Project Demonstrates

**Note:** The before→after transition of marking work complete is temporal and cannot be
proven by one still frame. Demonstrate it in the demo video rather than adding a fifth
screenshot.
