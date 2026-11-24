# Specification: `graph-shift-app`

## 1. Overview & Goals
`graph-shift-app` is a purely client-side, offline-capable single-page web application designed for static hosting on **GitHub Pages** and installation as a Progressive Web App (PWA) so it works offline without any backend server.

The application provides:
1. A **left-hand editor** for entering and editing DOT-language graph definitions.
2. A **right-hand interactive canvas** displaying the rendered graph with pan, zoom, and manual node dragging.
3. **Dynamic edge attachment** so edges remain connected to their respective source and target nodes as nodes are moved, without changing graph topology or requiring server execution.
4. **Strict manual-position preservation**: once manual changes occur, node positions are never automatically reset or overwritten without explicit user confirmation.
5. **Selective DOT write-back**: dragging a node does not write coordinates back to the DOT text, whereas adding/removing nodes or edges through the UI does update the DOT source.
6. **SVG export**, **undo/redo**, **`localStorage` persistence**, **automatic updates**, and **resilience against Cloudflare caching**.

---

## 2. Deployment, Offline Support, Caching & Auto-Update
* **Hosting:** Static build output deployable directly to GitHub Pages (supports subpath hosting such as `/graph-shift-app/` via relative asset paths or configured base path).
* **Zero Server Dependency:** All parsing, initial layout calculation, rendering, interaction, persistence, and SVG export run locally in the browser.
* **Offline Installation (PWA):**
  * Include a Web App Manifest (`manifest.webmanifest`) and a Service Worker to cache application shell assets and client-side layout/parser bundles for offline use after initial load.
  * Provide clear UI affordance or standard browser installability support so users can install the app locally.
* **Resilience to Cloudflare Caching:**
  * Assume assets and HTML/manifest/worker responses may be served through a CDN/reverse proxy such as **Cloudflare** with aggressive edge caching, stale-while-revalidate behavior, or delayed cache invalidation.
  * Use **content-hashed filenames** (e.g., `index.<hash>.js`, `style.<hash>.css`) for all versioned build artifacts so old and new bundles never collide in Cloudflare's cache or the browser cache.
  * Fetch critical update metadata or `index.html` / service worker script with cache-busting / network-first / `cache: 'no-store'` fetch options (where supported) and design the Service Worker so that even if Cloudflare temporarily serves a cached entry, asset hashes remain self-consistent and never mix mismatched HTML and chunk hashes.
  * Avoid relying on non-standard or uncoordinated edge cache headers; ensure version checks compare actual build/version identifiers (e.g., a build version constant or manifest/version payload) rather than assuming immediate upstream cache purge.
* **Implemented caching scheme:**
  * Every build has a sortable version id (`<UTC timestamp>-<git sha + random>`), embedded in `index.html` (`<meta name="app-version">`), in `sw.js` and in `version.json` (which also lists all precached files).
  * The service worker precaches every file of its own build into a cache named `graph-shift-<version>`. It fetches `index.html` with a cache-buster and `cache: 'no-store'` and only accepts it when its `app-version` equals the worker's own version; a stale edge copy is retried with backoff, and if it never matches the install fails, so the previous worker keeps serving a consistent set. Hashed assets are immutable by name; unhashed files (manifest, icons) get a cache-buster. The complete set is written into a fresh cache only after everything was fetched.
  * Navigations are answered from the worker's cached shell, so HTML and hashed chunks always come from the same build. `version.json` and `sw.js` bypass the worker.
  * The page registers `sw.js?v=<version>` with `updateViaCache: 'none'`. It never re-registers an existing registration with its own (possibly older) version, so a stale page cannot downgrade the worker.
  * If a cached HTML copy references bundles that no longer exist (first visit through a stale CDN), an inline script reloads the page once with a cache-buster.
* **Auto-Update Mechanism:**
  * The page polls `version.json?t=<now>` with `cache: 'no-store'` on startup, when the window gains focus or becomes visible, when the browser comes back online, and every 15 minutes (at most once per minute). A strictly newer version registers `sw.js?v=<new version>`; the new URL bypasses stale edge caches. Older or equal versions (a stale `version.json`) never trigger anything.
  * On startup, focus/visibility change, and periodic background checks (when online), check for a newer application version.
  * When a new Service Worker or build version is detected:
    * Pre-cache the updated assets in the background so offline functionality remains intact.
    * Either activate seamlessly when safe or prompt the user with a non-intrusive **"Update available — Reload"** control so in-progress unsaved edits or active interactions are not unexpectedly disrupted (while preserving `localStorage` state across reload).
    * Ensure updates never reset manually positioned nodes unless the user explicitly triggers a layout reset.
* **Client-Side Layout & DOT Handling:**
  * A dedicated client-side DOT parser (`src/dot/parser.ts`) records source offsets for every statement, so write-back edits the original text surgically instead of re-serializing it. Comments, blank lines and formatting outside the touched statement are preserved.
  * **No Graphviz.** Graphviz (WASM) is intentionally not bundled; the product owner prefers a good-looking, hand-adjustable drawing over Graphviz fidelity. Layout runs on small, deterministic JS engines bundled into the static build: `@dagrejs/dagre` for the hierarchical layout and own implementations (with `d3-force` for the force-directed one) for the rest. No network calls at runtime.
  * Supported DOT: `strict`, `graph` / `digraph`, `->` / `--` (the wrong operator for the graph type is a syntax error), edge chains (`a -> b -> c`), subgraph operands (`a -> {b c}`), ports and compass points (`a:p:n`), quoted strings with `+` concatenation, HTML strings, `//`, `/* */` and `#` comments, `node` / `edge` / `graph` default attributes with subgraph scoping, `key=value` graph attributes, subgraphs and `cluster*` subgraphs (nested). Strict graphs merge duplicate edges.
  * Edge identity: an edge is identified by (tail, head, occurrence index among edges with the same tail and head), so parallel edges and self-loops keep stable identities across re-parses.

---

## 3. User Interface & Layout

### 3.1 Split Workspace
* **Left Pane:** DOT code editor (monospace textarea or code editor component) with syntax/parse error feedback if the DOT input is malformed.
* **Right Pane:** Interactive SVG graph viewport with floating or docked canvas controls.
* **Top / Action Bar:**
  * **Initial Layout Selector:** A dropdown with five layouts:
    * *Hierarchical*: layered in edge direction (dagre); honors `rankdir`, `nodesep`, `ranksep`, `minlen`, `weight`, `constraint=false`; edges get routed waypoints.
    * *Force-directed*: d3-force with a fixed seed, so the result is deterministic.
    * *Radial*: rings around the graph's `root` attribute or the most connected node.
    * *Circular*: each connected component on its own circle, in DFS order.
    * *Compact grid*: rows and columns in topological (flow) order; `rankdir=LR` transposes it.
    * In all non-hierarchical layouts, each cluster is laid out as one unit first, so cluster boxes never enclose unrelated nodes. Disconnected components are packed in rows.
    * While nodes are placed by hand, the selector shows a vermilion **Placed by hand** lock state.
  * **Graph Editing Controls:** **Add node** (popover with ID, prefilled with an unused `nN`, and optional label), **Add edge** (click source, then target; clicking the same node makes a self-loop; Esc cancels), **Remove node** and **Remove edge** (act on the current selection; also `Delete` / `Backspace`). The destructive group stands apart from the other controls. Double-clicking empty canvas adds a node at that spot.
  * **History Controls:** **Undo** and **Redo** buttons (plus keyboard shortcuts `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y`).
  * **Export Action:** **Download SVG** button.
  * **Reset / Re-layout Action (Gated):** **Reset layout…** recomputes positions with the current layout. It is enabled only while positions are placed by hand and always asks first.
  * **Update Notification (Conditional):** **Update available — Reload**, shown only when a newer version is installed and waiting.
  * **Install:** When the browser offers installation (`beforeinstallprompt`), an install button appears.
* **Status line:** A status chip at the bottom left of the canvas reports the current mode, the selection, how many nodes are placed by hand, and short-lived notices (e.g. "Fix the DOT error first").
* **Small screens:** Below 760px the panes become two tabs (*DOT source* / *Graph*), the toolbar becomes a horizontally scrolling row of icon buttons, and touch supports drag, pan and pinch zoom.
* **Splitter:** The border between editor and canvas can be dragged (or moved with the arrow keys) to resize the editor; the width is remembered per browser.

---

## 4. Core Functional Requirements

### 4.1 DOT Input & Parsing
* Typing or pasting DOT code in the left pane updates the internal graph model and re-renders the canvas when valid.
* The editor is CodeMirror 6 with DOT syntax highlighting, line numbers and its own undo history for typing. Re-parsing is debounced (≈180 ms) after typing.
* If the DOT text has a syntax error:
  * Display a non-intrusive error message/indicator near the editor: the offending token is underlined, and an error slip under the editor names line, column and the problem; clicking it moves the cursor there.
  * Keep the last valid rendered graph visible rather than blanking the canvas.
  * Canvas editing (add/remove) is refused with a notice until the DOT is valid again, because write-back needs a valid parse.

### 4.2 Initial Layout & Manual Position Lock
* When a fresh graph is loaded or before manual adjustments are made, compute initial node coordinates using the selected initial layout algorithm.
* **Manual Change Tracking (`hasManualChanges` flag):**
  * Moving/dragging any node sets `hasManualChanges = true` and records that node's current coordinates as manually positioned.
  * When `hasManualChanges` is `true`, **never** automatically recalculate or overwrite node positions on layout-option changes, window resizes, app updates, or graph edits unless the user explicitly confirms a layout reset/recomputation dialog.
  * When adding a new node via the UI while `hasManualChanges` is `true`, place the new node at a non-overlapping position (e.g., near viewport center or offset from existing nodes) without moving existing nodes.
  * When removing a node or edge via the UI, keep all remaining nodes at their current positions.
  * Nodes placed by hand carry a small vermilion corner tick on the canvas (not exported).
  * Without manual changes, every valid text change re-runs the selected layout.
  * New nodes are placed near the centroid of their already-placed neighbors (below a single neighbor), otherwise near the viewport center, searching outward for the first spot that keeps a 24px margin to every existing node.

### 4.3 Manual Node Dragging & Edge Tracking
* Users can click/pointer-down on any node in the SVG canvas and drag it smoothly to a new position.
* **Topology Integrity:** Dragging a node never alters which nodes are connected or edge directionality.
* **Connected Edges:** As a dragged node moves, all incident edges (both outgoing and incoming) dynamically update their geometry so endpoints/paths stay anchored to the moved node and its neighbor.
* **No Coordinate Write-Back on Drag:** Dragging a node updates canvas positions and undo/redo history, **not** the DOT text in the left-hand editor.

### 4.4 Adding & Removing Nodes and Edges (with DOT Write-Back)
* Provide clear UI workflows to:
  * **Add Node:** Create a new node (with an auto-generated unique ID or user-provided ID/label).
  * **Remove Node:** Delete a selected node and any edges incident to it.
  * **Add Edge:** Connect a source node to a target node using the graph's edge operator (`->` for `digraph`, `--` for `graph`).
  * **Remove Edge:** Delete a selected edge.
* **Write-Back to DOT Editor:** Every node addition, node removal, edge addition, and edge removal performed via the UI must immediately update the DOT source text in the left-hand pane while preserving existing formatting/definitions as cleanly as possible.
  * New statements are appended before the root graph's closing brace, using the indentation of existing statements (single-line graphs stay on one line). IDs are quoted only when needed.
  * Removing an edge from a chain splits the chain (`a -> b -> c -> d` minus `b -> c` becomes `a -> b; c -> d;`) and keeps the statement's attributes. Removing one expansion of a subgraph operand re-adds the other expansions explicitly.
  * Removing a node deletes its node statements (including inside subgraphs/clusters) and every incident edge; clusters stay.
  * A removal never makes another node disappear: if a node was only mentioned in a removed edge, a bare `node;` declaration is added.

### 4.5 Pan, Zoom & Viewport Controls
* Support panning (e.g., drag on empty canvas background or middle-mouse drag) and zooming (e.g., mouse wheel / pinch zoom, plus `+`, `-`, and `Fit to View` buttons).
* Ensure pan/zoom transforms work accurately with pointer coordinate conversion during node dragging.
* The zoom percentage button resets to 100%. Fit to view never zooms in beyond 100%. Zoom is limited to 5%–800%.
* The sheet grid (20px minor, 100px major) lives in graph coordinates, so it pans and zooms with the drawing; the minor grid hides when it would get too dense.
* With nodes selected and the canvas focused, the arrow keys nudge them by 1px (10px with Shift); each nudge is a manual move.

### 4.6 Undo & Redo
* Maintain an undo/redo stack covering manual node position changes as well as UI-driven node/edge additions and removals.
* Ensure undoing a node drag restores the node (and its connected edges) to its prior coordinates without altering DOT text unless the undone action was a structural node/edge change.
* The app history stores snapshots of `{dot, layout, positions, edge routes, hand-placed nodes, hasManualChanges}`. Steps are: a drag (one step per drag), a structural edit, a layout change/reset, and typing (consecutive keystrokes within 1.2s coalesce into one step). Up to 200 steps are kept.
* Inside the editor, `Ctrl/Cmd+Z` is the editor's own typing undo; everywhere else it is the app undo.

### 4.7 SVG Export (`Download SVG`)
* Clicking **Download SVG** serializes the current graph SVG (reflecting manual node positions, updated edge paths, labels, and styling) into a standalone `.svg` file (`xmlns="http://www.w3.org/2000/svg"`) and triggers a browser download (e.g., `graph-shift.svg`).
* Exclude interactive UI overlays/selection handles from the exported SVG so the downloaded file is clean.

### 4.8 Local Persistence (`localStorage`)
* Automatically save the current DOT code (and relevant session state such as layout choice and node positions/history if appropriate) to `localStorage`.
* Restore saved state automatically on page load so refreshes, updates, or browser restarts do not lose work.
* Saved under `graph-shift:session:v1`: the current snapshot, the last 50 undo and redo steps, and the viewport (pan/zoom). Saving is debounced (400ms) and also happens when the page is hidden or before an update reload. If storage is full, the session is saved without history. Malformed stored data is ignored.
* A fresh start shows a small sample graph (a checkout service architecture with a cluster, labels and a self-loop).

### 4.9 Selection, Group Moves & Inspector
* **Click** a node to select it; **Shift+click** adds it to or removes it from the selection. **Ctrl/Cmd+A** selects all nodes; **Esc** or clicking empty sheet clears the selection.
* **Group move:** dragging any selected node moves every selected node by the same offset, so their relative positions stay intact. Arrow keys nudge the whole selection. A group move is one undo step and, like any drag, does not change the DOT text.
* **Rectangle select:** **Shift+drag** on empty sheet draws a selection rectangle; every node whose box intersects it is selected (with Shift held, added to the current selection).
* **Pan vs. select:** a toggle next to the zoom buttons decides what a plain drag on empty sheet does: *Pan* (default, `H`) moves the view; *Select* (`V`) draws a selection rectangle. In either mode the middle mouse button and Space+drag pan, the wheel and pinch zoom, and two-finger touch pans/zooms, so navigation never turns into a selection by accident. Dragging a node always moves it.
* **Remove node** removes all selected nodes (and their edges) as one undo step.
* **Inspector:** while nodes are selected, a panel at the top-right of the canvas edits them, writing the attributes into the DOT text:
  * Label (single node only; DOT escapes such as `\n` are kept as typed; empty removes the label so the ID shows). Committed on Enter or when the field loses focus.
  * Shape (common shapes; "Mixed" when the selected nodes differ).
  * Fill colour (sets `fillcolor` and adds `filled` to the node's style, keeping other style flags such as `rounded`; "None" removes both), text colour (`fontcolor`) and border colour (`color`), each with a reset.
  * With several nodes selected, shape and colours apply to all of them.
  * Attribute edits change the node's last explicit setting in place, otherwise they are appended to its last statement (or a new `id [...]` statement for nodes that only appear in edges). Changing the same attributes repeatedly within 1.5s (e.g. dragging the colour picker) is one undo step.

### 4.10 Rendering
* Graphs are drawn by the app's own SVG renderer, in an ink-on-white "Drafting Grid" style (see DESIGN.md), and DOT attributes override that style:
  * Nodes: `label` (escapes `\n`, `\l`, `\r`, `\N`, `\G`; HTML labels shown as plain text), `shape` (box, rect, square, ellipse, oval, circle, doublecircle, point, plaintext, plain, none, underline, diamond, triangle, invtriangle, hexagon, octagon, pentagon, septagon, parallelogram, trapezium, invtrapezium, house, invhouse, star, cylinder, note, tab, folder, component, box3d, cds, rarrow, larrow, record and Mrecord with fields), `style` (filled, rounded, dashed, dotted, bold, invis, setlinewidth), `color`, `fillcolor`, `fontcolor`, `fontsize`, `fontname`, `penwidth`, `width`, `height`, `fixedsize`, `peripheries`.
  * Edges: `label`, `xlabel`, `headlabel`, `taillabel`, `color`, `style`, `penwidth`, `dir`, `arrowhead`, `arrowtail` (normal, inv, vee, open, dot, diamond, box, tee, crow, curve and their `o` variants), `arrowsize`, compass ports.
  * Clusters: `label`, `labeljust`, `labelloc`, `color`, `pencolor`, `fillcolor`, `bgcolor`, `style`, `penwidth`. Cluster boxes are recomputed from their members, so they follow dragged nodes.
  * Graph: `bgcolor`, `label`, `labelloc`, `labeljust`, `rankdir`, `root`.
  * Colors: X11/CSS names including numbered variants (`red3`, `gray40`), hex with alpha, HSV triples; color lists use their first color.
* Edge geometry: edges are clipped to the node outline. Parallel edges between the same pair fan out as curves. Self-loops sit on the right side of the node and stack. Routed (hierarchical) edges keep their waypoints, which bend with the endpoints while nodes are dragged.
* Node sizes are measured from the label text with the bundled fonts (Inter, JetBrains Mono), which are self-hosted.

### 4.11 Keyboard
* `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` redo (outside the editor), `Ctrl/Cmd+A` select all nodes, `Delete`/`Backspace` remove the selection, `Esc` cancels add-edge mode or clears the selection, arrow keys nudge the selected nodes, `V` / `H` switch between the Select and Pan tools, Space+drag pans.

---

## 5. Edge Cases & Acceptance Criteria
* **Offline Mode:** After loading once, disabling network access still allows opening the app, editing DOT, dragging nodes, editing topology, undoing/redoing, and downloading SVG.
* **Cloudflare Cache Tolerance:** Even when responses are served from a Cloudflare cache, content-hashed bundles remain internally consistent, stale/cached shell responses do not break asset loading or offline fallback, and new versions are detected and cached cleanly once available.
* **Auto-Update Safety:** Deploying a new build triggers update detection and background caching; applying the update preserves `localStorage` graph state and does not clobber manual node positions.
* **No Automatic Layout Clobbering:** After dragging a node, switching the initial layout dropdown must **not** move nodes automatically without user confirmation.
* **Write-Back Symmetry:** Dragging a node leaves the DOT text untouched; adding/removing a node or edge updates the DOT text immediately.
* **Disconnected / Self-Loop / Multi-Edge Graphs:** Handle isolated nodes, self-loops (`A -> A`), and multiple edges between the same pair of nodes gracefully during dragging and edge updates.
* **Export Fidelity:** The downloaded `.svg` matches the visual positions and connections seen on the right-hand canvas.

---

## 6. Project Structure & Verification

    graph-shift-app/
    ├── index.html                  # shell + stale-asset recovery script
    ├── public/                     # manifest.webmanifest, icons
    ├── vite.config.ts              # base './', builds sw.js + version.json
    ├── scripts/check-build.mjs     # production build check
    ├── e2e/app.spec.ts             # Playwright acceptance tests
    └── src/
        ├── main.tsx, App.tsx, styles.css
        ├── dot/        ast.ts, parser.ts, model.ts, serializer.ts (write-back)
        ├── layout/     initialLayout.ts, placement.ts
        ├── render/     colors.ts, text.ts, shapes.ts, visuals.ts, svgMarkup.ts
        ├── canvas/     GraphCanvas.tsx, scene.ts, edgeGeometry.ts
        ├── editor/     DotEditor.tsx, dotLanguage.ts
        ├── state/      store.ts, history.ts, storage.ts
        ├── export/     exportSvg.ts
        ├── pwa/        sw.ts, swLogic.ts, autoUpdate.ts
        └── ui/         icons.tsx, ConfirmDialog.tsx, AddNodePopover.tsx, NodeInspector.tsx

* The canvas and the SVG export render the same scene through the same markup functions (`render/svgMarkup.ts`); overlays (grid, selection, hand-placed ticks, edge preview) are drawn separately and never exported.
* **Automated Checks:**
  * `npm test` (Vitest): DOT parsing and model building, write-back for add/remove of nodes and edges (chains, subgraph operands, clusters, self-loops, quoted IDs), edge geometry on node move, layouts (determinism, no overlaps, clusters kept together), the store (drag, undo/redo, manual lock, placement, persistence), service-worker precache/update decisions under stale responses, and SVG export.
  * `npm run build`: typecheck, Vite build, then `scripts/check-build.mjs` verifies content-hashed assets, one version across `index.html`/`sw.js`/`version.json`, a precache list equal to the build output, and no external hosts.
  * `npm run test:e2e` (Playwright, installed Chrome): drag without write-back, gated layout switch, add/remove write-back, undo/redo, syntax errors, reload persistence, SVG download, offline use, and the update prompt.
* **Deployment:** `.github/workflows/deploy.yml` builds, tests and publishes `dist/` to GitHub Pages.