---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

# Surface brief: workspace (index.html)

Scope: the single-screen workspace (DOT editor + graph sheet + action bar). Mode: Operate.
Audience: engineers tidying diagrams for docs and reviews; desk, long sessions, keyboard-heavy.
Job: paste/write DOT, nudge nodes by hand until the picture reads well, export SVG.
Constraints: offline, no runtime network (self-hosted fonts), export must exclude UI overlays.
User steer (pinned): light design; the computation-pad grid without green; thin ink edges with small arrow tips; no thick blue arrows.

## Direction contract

THESIS: A white drafting sheet with a two-weight grid, fine technical-pen ink edges, and one vermilion reserved for what your hand did. Refuses the category default of a dark editor beside a dotted grey canvas.

OWN-WORLD: Near-white sheet (#fbfbf9) with a minor/major grid (every 20px, heavier every 100px) in cool greys; ink near-black (#1c1f23) for type, node outlines and 1px edges with small arrow tips; white chrome separated by single ink rules; vermilion (#e0452b) only for hand-placed marks, selection, pending edge and the error slip. Workhorse sans for UI, mono for DOT.

STORY: The engineer sees their DOT on the left and the drawing on the right, drags nodes until the picture reads, and always knows which positions are theirs (vermilion ticks, "positions set by hand" in the bar) and that the layout won't clobber them.

FIRST VIEWPORT: 56px white action bar under one ink rule: wordmark, Layout select + hand-placed lock state, Undo/Redo, Add node/Add edge, isolated destructive group (Remove node, Remove edge, Reset layout…), Download SVG as the single filled ink primary at the right. Left 440px DOT editor with line numbers and an inline error slip. Right: gridded sheet filling the rest, status chip bottom-left, zoom controls bottom-right.

FORM: Drafting Grid, my top-ranked grounded candidate (pick card, re-roll round 1). seed:44fc588d34d3706a

SIGNATURE: hand-placed nodes carry a small vermilion corner tick; the layout select shows the lock state once anything is placed by hand. Motion: none decorative; edges follow nodes live under the pointer.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
