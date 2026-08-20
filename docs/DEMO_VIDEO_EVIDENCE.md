# Demo Video Evidence

Internal portfolio-support notes. Not final README copy.

## File

`docs/assets/demo/cycle-count-route-optimizer-demo.mp4` — 30.9 s, 1440×900, H.264 (High,
yuv420p), 30 fps, 3.48 MB, faststart, silent. No narration or music: it is meant to read with
sound off.

## Scenario

Seven bins spread across both rack blocks, selected in the order a count task list sorted by
**bin ID** rather than by location would arrive. The list is entered as G-02, H-03, A-04, I-05,
C-07, E-06, B-09, then one drag moves E-06 above C-07 to reach the final order — which is both
the reorder demonstration and the same order used in the approved screenshots. The application
computed 1,161.5 m for the worker route against 14:11 for the recommendation: 43.5% distance
improvement, 505.5 m and 8:26 saved.

This is **a reproducible illustrative scenario using a fixed bin-ID ordering rule**, not a
claimed population-average improvement. The same bins in zone order yield 0.0%, because that
order is already optimal. No population-level claim is made from this single scenario.

## Timeline

- **0:00–0:07 — Plan.** Locations are checked; each appears on the aisle map and in the visit-order
  list and route strip. One drag reorders E-06 above C-07 and the route redraws.
- **0:07–0:13 — Optimize.** The "Generate recommended route" CTA is clicked; the Digital Twin
  opens and Compare shows Worker route beside System recommended route with live KPIs.
- **0:13–0:25 — Simulate → Count.** Playback starts at 1× and the operator walks the route; the
  rate is switched to 5× (visible in the transport bar) and the task state turns over from
  TRAVELLING to COUNTING at Zone I – Bin 05, with the HUD showing SIMPLE COUNT and service progress.
- **0:25–0:31 — Complete.** Progress flips from 0 to Completed 7 / Remaining 13 (35%), seven green
  completed markers appear on the map, and "Zone A – Bin 04" is shown struck through, badged
  ✓ Completed, with its checkbox disabled.

## Claims Proven

1. **Worker visit order is directly manipulable** — 0:00–0:07: selection order becomes the visit
   order, and a drag changes it, with map and route strip following.
2. **The recommendation is generated from the same task set** — 0:07–0:13: one CTA click produces
   both routes over identical targets, with the app's own "Only the route sequence differs."
3. **The operator transitions from TRAVEL to COUNTING in the Digital Twin** — 0:13–0:25: the state
   change happens live on camera, not as a cut between two states.
4. **Completion changes available work state** — 0:25–0:31: counts update and a completed location
   becomes disabled, i.e. it leaves the active target pool.

## Capture Conditions

Production URL https://cycle-count-route-optimizer.vercel.app, real Google Chrome via Playwright,
1440×900, `deviceScaleFactor: 1`, English UI, dark theme. One continuous recording; editing was
limited to trimming dead time, concatenating five real segments, and encoding — no retiming, no
compositing, no overlays, no DOM or source modification. The 5× speed-up is the application's own
playback-rate control, visible in the transport bar; footage speed is unaltered. Playwright renders
no mouse cursor, so button hover and pressed states show where interaction occurs.
