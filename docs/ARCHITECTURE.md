# Architecture

The system turns a warehouse floor into a graph, plans a cycle-count route over it, and then
replays that plan on a physical timeline that separates walking from counting. Everything above the
presentation band is **operational truth** — distances, durations, and completion state — computed
once and never revised by anything downstream. The 3D Digital Twin and the 2D map are read-only
projections of that truth: they consume it, and they can never write back into it.

Full narrative and evidence: [PORTFOLIO_CASE_STUDY.md](./PORTFOLIO_CASE_STUDY.md)

![Cycle Count Route Optimizer architecture](assets/architecture-overview.svg)

---

## System Architecture

The diagram above is the portfolio view. The Mermaid source below is the maintained technical version — edit it first, then regenerate the graphic to match.

```mermaid
flowchart TB

    subgraph OPS["① OPERATIONS INPUT"]
        direction LR
        WD["Warehouse Data<br/>10 zones · 100 count locations"]
        SEL["Location Selection<br/>selection order = worker visit order"]
        SPD["Walking Speed<br/>60 m/min"]
        SVC["Count Service Profiles<br/>simple / standard / complex"]
    end

    subgraph TRUTH["② OPERATIONAL TRUTH — domain + simulation"]
        direction TB
        GRAPH["Warehouse Graph<br/>aisle nodes + edges · bins on access spurs"]
        DIJK["Shortest Paths — Dijkstra<br/>aisle-constrained distance matrix"]
        WROUTE["Worker Route<br/>the operator's own visit order"]
        RROUTE["Recommended Route<br/>Nearest Neighbor heuristic → 2-opt refinement"]
        TRAV["RouteTraversal<br/>spatial truth · node-by-node walk"]
        TL["RouteTimeline<br/>TRAVEL phases + SERVICE phases"]
        SNAP["SimulationSnapshot<br/>state at one instant"]
    end

    CLK["PlaybackClock<br/>frame delta × playbackRate"]

    subgraph VIEW["③ PRESENTATION — Digital Twin · read-only"]
        direction LR
        MAP["Planning Map / Minimap<br/>2D SVG"]
        TWIN["3D Digital Twin<br/>operator · travel · COUNTING"]
        CMP["Compare<br/>Worker vs Recommended"]
    end

    WD --> GRAPH
    GRAPH --> DIJK
    DIJK --> WROUTE
    DIJK --> RROUTE
    SEL --> WROUTE
    SEL --> RROUTE
    WROUTE --> TRAV
    RROUTE --> TRAV
    TRAV --> TL
    SPD --> TL
    SVC --> TL
    TL --> SNAP
    CLK -- "simulation time only" --> SNAP

    SNAP ==> MAP
    SNAP ==> TWIN
    SNAP ==> CMP

    WD -. "display coordinates only — never routing" .-> VIEW

    classDef ops fill:#e2e8f0,stroke:#64748b,color:#0f172a
    classDef domain fill:#dbeafe,stroke:#2563eb,color:#0f172a
    classDef clock fill:#eff6ff,stroke:#2563eb,stroke-dasharray:4 3,color:#0f172a
    classDef view fill:#ccfbf1,stroke:#0d9488,color:#0f172a

    class WD,SEL,SPD,SVC ops
    class GRAPH,DIJK,WROUTE,RROUTE,TRAV,TL,SNAP domain
    class CLK clock
    class MAP,TWIN,CMP view

    style OPS fill:#f8fafc,stroke:#94a3b8
    style TRUTH fill:#f8fafc,stroke:#2563eb,stroke-width:3px
    style VIEW fill:#f8fafc,stroke:#0d9488,stroke-width:2px
```

Every arrow crossing into band ③ points one way. The bold arrows are the only channel between
operational truth and what you see; the dashed arrow shows that display coordinates bypass the
truth layer entirely, reaching renderers without ever touching route computation.

Both routes are computed over the **same target set** from the **same distance matrix** — only the
visit order differs. Compare fans out into two independent viewports that share one clock.

---

## Playback Semantics

Replay speed and physical time are different quantities. This is the isolation that keeps the
reported numbers stable when someone hits fast-forward.

```mermaid
flowchart LR

    RAF["Real frame delta<br/>requestAnimationFrame"] --> MUL["× playbackRate<br/>0.5× … 10×"]
    MUL --> CLK2["PlaybackClock<br/>simulationTime"]
    CLK2 --> SNAP2["SimulationSnapshot<br/>what you are looking at"]

    DIST["Route Distance<br/>from Dijkstra"] --> TL2
    SPD2["Walking Speed<br/>60 m/min"] --> TL2
    SVC2["Count Service Profiles<br/>20 / 35 / 60 s"] --> TL2["RouteTimeline<br/>travel + service durations · KPIs"]
    TL2 --> SNAP2

    classDef replay fill:#eff6ff,stroke:#2563eb,stroke-dasharray:4 3,color:#0f172a
    classDef physical fill:#dbeafe,stroke:#2563eb,color:#0f172a
    classDef out fill:#ccfbf1,stroke:#0d9488,color:#0f172a

    class RAF,MUL,CLK2 replay
    class DIST,SPD2,SVC2,TL2 physical
    class SNAP2 out
```

The absence of an arrow is the point: **nothing on the dashed replay path reaches `RouteTimeline`.**
Distance, walking duration, service duration, and every KPI are computed before the clock exists, so
`playbackRate` can only change how fast the snapshot is sampled — never what the snapshot reports.

---

## What this architecture protects

- **Rendering cannot redefine route truth.** Display and 3D-world coordinates reach renderers only; a test applies an anisotropic transform to every coordinate and asserts both routes stay byte-identical.
- **Playback speed cannot change physical KPIs.** `playbackRate` enters only the clock; distance, walking duration, and service duration are computed upstream of it.
- **Service time is excluded from route optimization.** Count service profiles enter `RouteTimeline` and never reach Dijkstra, Nearest Neighbor, or 2-opt — route sequence compresses travel, not counting.
- **Worker and Recommended differ only in sequence.** Same targets, same graph, same service assumptions, one shared clock — so the comparison isolates the single variable it claims to measure.

> The recommendation is a **heuristic** — Nearest Neighbor construction refined by 2-opt local search,
> reaching a local optimum. It is not an exact TSP solution, and no machine learning is involved.
