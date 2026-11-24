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
  * **Graph menu:** next to the wordmark, a button with the open graph's name opens the graph library (see 4.11): rename, switch, create and delete graphs.
  * **Initial Layout Selector:** A dropdown with five layouts:
    * *Hierarchical*: layered in edge direction (dagre); honors `rankdir`, `nodesep`, `ranksep`, `minlen`, `weight`, `constraint=false`; edges get routed waypoints.
    * *Force-directed*: d3-force, deterministic, and tuned to avoid edge crossings. Graphs up to 60 nodes are simulated from four starting arrangements (default, DFS circle, two seeded random ones) and the result with the fewest crossings wins. A refinement pass then swaps the positions of nodes on crossing edges, or mirrors a node across the other edge, whenever that lowers the crossing count without causing overlaps. Refinement has a fixed work budget, so large graphs stay fast and results stay identical across machines.
    * *Radial*: rings around the graph's `root` attribute or the most connected node.
    * *Circular*: each connected component on its own circle, in DFS order.
    * *Compact grid*: rows and columns in topological (flow) order; `rankdir=LR` transposes it.
    * In all non-hierarchical layouts, each cluster is laid out as one unit first, so cluster boxes never enclose unrelated nodes. Disconnected components are packed in rows.
    * **Unconnected nodes** (no edges to other nodes; self-loops don't count; not inside a cluster) are, by default, left out of the layout and placed in a separate grid that completes the drawing's rectangle: below a wide drawing, stretched to its width, or beside a tall drawing, stretched to its height. If every node is unconnected, they form a roughly square grid. A **Layout options** popover next to the selector switches this off ("Collect unconnected nodes in a grid"); the setting is part of the undo history and the saved session, and changing it lays out again (asking first if nodes are placed by hand).
    * While nodes are placed by hand, the selector shows a vermilion **Placed by hand** lock state.
  * **Graph Editing Controls:** **Add node** (popover with ID, prefilled with an unused `nN`, and optional label), **Add edge** (click source, then target; clicking the same node makes a self-loop; Esc cancels), **Remove node** and **Remove edge** (act on the current selection; also `Delete` / `Backspace`). The destructive group stands apart from the other controls. Double-clicking empty canvas adds a node at that spot.
  * **History Controls:** **Undo** and **Redo** buttons (plus keyboard shortcuts `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y`).
  * **Export Action:** **Download SVG** button.
  * **Reset / Re-layout Action (Gated):** **Reset layout…** recomputes positions with the current layout. It is enabled only while positions are placed by hand and always asks first.
  * **Update Notification (Conditional):** **Update available — Reload**, shown only when a newer version is installed and waiting.
  * **Install:** When the browser offers installation (`beforeinstallprompt`), an install button appears.
  * **Share:** opens the share-link panel (see 4.12).
  * **About (ⓘ, far right):** shows the build version and build date, says that everything stays in the browser, links to the source at https://github.com/MartinThoma/graph-shift-app, invites feature requests and bug reports via "Open an issue on GitHub" (`…/issues/new`), and has a "Check for updates" button that reports the result (latest / update downloading / offline / unavailable / unreachable).
* **Status line:** A status chip at the bottom left of the canvas reports the current mode, the selection, how many nodes are placed by hand, and short-lived notices (e.g. "Fix the DOT error first").
* **Small screens:** Below 760px the panes become two tabs (*DOT source* / *Graph*) and the toolbar wraps into two rows of icon buttons: the graph name, layout and undo/redo on top; add, remove, share, download and about below. The wordmark is hidden there; the graph name takes its place, and the "Placed by hand" state shrinks to a vermilion corner tick on the layout select. Touch supports drag, pan and pinch zoom.
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
  * A **Highlight nodes placed by hand** toggle next to the zoom buttons draws a small vermilion corner tick on such nodes (never exported). It is off by default and remembered per browser; the toolbar's "Placed by hand" state and the status-chip count are always shown.
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
* Clicking **Download SVG** serializes the current graph SVG (reflecting manual node positions, updated edge paths, labels, and styling) into a standalone `.svg` file (`xmlns="http://www.w3.org/2000/svg"`) and triggers a browser download named after the graph (e.g. `checkout.svg`; `graph-shift.svg` if the name has no usable characters).
* Exclude interactive UI overlays/selection handles from the exported SVG so the downloaded file is clean.

### 4.8 Local Persistence (`localStorage`)
* Automatically save the current DOT code (and relevant session state such as layout choice and node positions/history if appropriate) to `localStorage`.
* Restore saved state automatically on page load so refreshes, updates, or browser restarts do not lose work.
* Every graph is saved separately (see 4.11): the index of graphs under `graph-shift:library:v1` (`{activeId, graphs: [{id, name, createdAt, updatedAt}]}`), and each graph's session under `graph-shift:graph:v1:<id>`: the current snapshot, the last 50 undo and redo steps, and the viewport (pan/zoom). Saving is debounced (400ms) and also happens when the page is hidden, before an update reload, and before another graph opens. Only changes since the last save are written. If storage is full, the session is saved without history. Malformed stored data is ignored.
* Every change to the index re-reads the stored index first, so a graph another tab added (e.g. from a share link) is never dropped; other tabs refresh their graph list when the index changes (each tab keeps its own open graph).
* **Migration:** a session saved by earlier versions under `graph-shift:session:v1` becomes the first graph (named after its DOT graph name); the old key is removed only after the new keys were written. A tab still running an earlier version may keep saving to the old key after that; on the next start those edits are added as a graph of their own (unless a graph already has exactly that text), so an update never loses work.
* If storage is full, creating or opening a graph adds nothing and a notice asks to delete a graph first.
* A fresh start shows a small sample graph (a checkout service architecture with a cluster, labels and a self-loop), named "checkout".

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
  * Clicking a colour swatch opens a palette: *Typical* colours (soft fills for Fill; strong inks for Text and Border), *In this graph* (every other colour already used by nodes, edges, clusters or the graph, up to 20), and a *Custom* picker for any colour.
  * With several nodes selected, shape and colours apply to all of them.
  * **Arrange selection** (two or more nodes selected): choose a layout and press *Arrange* to lay out only the selected nodes (and the edges between them) with it, centered where they were. All other nodes keep their positions; the arranged nodes count as placed by hand; it is one undo step and does not change the DOT text.
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

### 4.11 Multiple Graphs
* The browser keeps a library of graphs. Each graph has:
  * an **ID** that never changes: 12 random characters (`0-9a-z`) from `crypto.getRandomValues` (which, unlike `crypto.randomUUID`, also works on plain-HTTP LAN addresses). Share links carry it.
  * a **name** the user can change (up to 120 characters). Until the user renames it, the name follows the DOT graph name (`digraph checkout` → "checkout"; an anonymous graph is "Untitled graph"), live while typing; a text with a syntax error keeps the last name. Once renamed in the graph menu, the name stays put whatever the DOT text says. Renaming never touches the DOT text. Names are kept unique by appending " 2", " 3", ….
  * its own DOT text, layout, positions, undo history and viewport.
* The **graph menu** (the name button next to the wordmark) shows the open graph's name field (Enter or leaving the field renames; Esc or a blank name keeps the old one), its ID, and every graph in this browser, most recently edited first, with when it was last edited. Clicking a graph opens it; **New graph** creates an empty `digraph {}` named "Untitled graph"; the trash button deletes a graph after a confirmation ("Delete graph" / "Keep it"). The only graph cannot be deleted. Deleting the open graph opens the most recently edited remaining one.
* Opening another graph saves the open one first. Selection, mode, popovers and the editor reset; the viewport is the graph's own.
* "Last edited" changes with edits (history changes), not with opening, panning or zooming.

### 4.12 Share Links
* **Share** creates a link that contains the whole graph: its ID and name, the DOT text, the layout and its options, and, if nodes were placed by hand, all positions, edge routes and which nodes were placed by hand.
* The data is JSON, compressed with the browser's built-in `deflate-raw` (`CompressionStream`) and base64url-encoded into the URL fragment: `<app URL>#share=v1.<data>`. Fragments are never sent to a server, so sharing uploads nothing.
* Links are limited to 8,000 characters (longer URLs break in chat apps, mail clients and some browsers). If the link with positions is too long, a link without positions is offered instead (the recipient gets a fresh layout) and the panel says so. If even that is too long, the link field and "Copy link" are disabled, an explanation shows the size and the limit, and "Copy DOT text" is offered instead.
* Opening a share link (on load or when the fragment changes) removes the fragment from the address bar, shows a notice, and never changes the graph that was open:
  * **New graph:** if this browser has no graph with the link's ID (or the link has none), the shared graph is added to the library with the link's ID and name (made unique if another graph has that name) and opened. If the sender never renamed it, it keeps following its DOT graph name.
  * **Same graph, same content:** if a graph with that ID exists and has the same DOT text, layout settings and (rounded) hand-placed positions, it is simply opened.
  * **Same graph, different content:** a confirmation asks "Replace “name”?" with three choices: **Replace mine** (the graph's content becomes the shared one as a new undo step in that graph, so undo brings the local version back; its local name is kept), **Keep both** (the shared version is added as a separate graph with a new ID), and **Cancel** (nothing changes).
* Malformed links show a notice and change nothing. Shared data is validated (types, sizes, ID characters, name length) before use.

### 4.13 Keyboard
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
        ├── layout/     initialLayout.ts, forceLayout.ts, placement.ts
        ├── render/     colors.ts, text.ts, shapes.ts, visuals.ts, svgMarkup.ts
        ├── canvas/     GraphCanvas.tsx, scene.ts, edgeGeometry.ts
        ├── editor/     DotEditor.tsx, dotLanguage.ts
        ├── state/      store.ts, history.ts, storage.ts, library.ts (graph library, IDs, migration)
        ├── export/     exportSvg.ts
        ├── pwa/        sw.ts, swLogic.ts, autoUpdate.ts
        ├── share/      shareLink.ts
        └── ui/         icons.tsx, ConfirmDialog.tsx, AddNodePopover.tsx, LayoutOptionsPopover.tsx, NodeInspector.tsx,
                        SharePopover.tsx, AboutPopover.tsx, GraphMenu.tsx, useDismiss.ts

* The canvas and the SVG export render the same scene through the same markup functions (`render/svgMarkup.ts`); overlays (grid, selection, hand-placed ticks, edge preview) are drawn separately and never exported.
* **Automated Checks:**
  * `npm test` (Vitest): DOT parsing and model building, write-back for add/remove of nodes and edges (chains, subgraph operands, clusters, self-loops, quoted IDs), edge geometry on node move, layouts (determinism, no overlaps, clusters kept together), the store (drag, undo/redo, manual lock, placement, persistence), the graph library (migration, IDs, names, cross-tab safe index updates, share-link decisions), service-worker precache/update decisions under stale responses, and SVG export.
  * `npm run build`: typecheck, Vite build, then `scripts/check-build.mjs` verifies content-hashed assets, one version across `index.html`/`sw.js`/`version.json`, a precache list equal to the build output, and no external hosts.
  * `npm run test:e2e` (Playwright, installed Chrome): drag without write-back, gated layout switch, add/remove write-back, undo/redo, syntax errors, reload persistence, SVG download, offline use, the update prompt, share links (new graph, same graph, replace/keep both/cancel), renaming, deleting, and migration of old saves.
* **Deployment:** `.github/workflows/deploy.yml` builds, tests and publishes `dist/` to GitHub Pages.