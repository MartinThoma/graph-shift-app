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
* **Auto-Update Mechanism:**
  * On startup, focus/visibility change, and periodic background checks (when online), check for a newer application version.
  * When a new Service Worker or build version is detected:
    * Pre-cache the updated assets in the background so offline functionality remains intact.
    * Either activate seamlessly when safe or prompt the user with a non-intrusive **"Update available — Reload"** control so in-progress unsaved edits or active interactions are not unexpectedly disrupted (while preserving `localStorage` state across reload).
    * Ensure updates never reset manually positioned nodes unless the user explicitly triggers a layout reset.
* **Client-Side Layout & DOT Handling:**
  * Use a pure client-side DOT parser/serializer (e.g., `dotparser` / `ts-graphviz` AST utilities or a dedicated client-side parser/serializer) and client-side layout computation (such as client-side WASM/JS graph layout engines or deterministic client-side layout algorithms) bundled into the static build—no network calls at runtime.
  * Support standard DOT constructs (`graph`, `digraph`, `->` / `--`, node IDs/labels, node/edge attributes, subgraphs/clusters where feasible).

---

## 3. User Interface & Layout

### 3.1 Split Workspace
* **Left Pane:** DOT code editor (monospace textarea or code editor component) with syntax/parse error feedback if the DOT input is malformed.
* **Right Pane:** Interactive SVG graph viewport with floating or docked canvas controls.
* **Top / Action Bar:**
  * **Initial Layout Selector:** Dropdown or segmented control to choose an initial layout algorithm (using friendly labels without requiring Graphviz terminology, e.g., *Hierarchical*, *Force-Directed*, *Radial*, *Compact Grid / Flow* mapped to underlying client-side layout modes).
  * **Graph Editing Controls:** Actions to **Add Node**, **Remove Node**, **Add Edge**, and **Remove Edge** (via toolbar buttons, context menu, or selection controls).
  * **History Controls:** **Undo** and **Redo** buttons (plus keyboard shortcuts `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y`).
  * **Export Action:** **Download SVG** button.
  * **Reset / Re-layout Action (Gated):** An action to recompute/reset layout, guarded by a confirmation prompt whenever manual position changes exist.
  * **Update Notification (Conditional):** Shown only when a newer app version is ready, allowing the user to reload to apply the update.

---

## 4. Core Functional Requirements

### 4.1 DOT Input & Parsing
* Typing or pasting DOT code in the left pane updates the internal graph model and re-renders the canvas when valid.
* If the DOT text has a syntax error:
  * Display a non-intrusive error message/indicator near the editor.
  * Keep the last valid rendered graph visible rather than blanking the canvas.

### 4.2 Initial Layout & Manual Position Lock
* When a fresh graph is loaded or before manual adjustments are made, compute initial node coordinates using the selected initial layout algorithm.
* **Manual Change Tracking (`hasManualChanges` flag):**
  * Moving/dragging any node sets `hasManualChanges = true` and records that node's current coordinates as manually positioned.
  * When `hasManualChanges` is `true`, **never** automatically recalculate or overwrite node positions on layout-option changes, window resizes, app updates, or graph edits unless the user explicitly confirms a layout reset/recomputation dialog.
  * When adding a new node via the UI while `hasManualChanges` is `true`, place the new node at a non-overlapping position (e.g., near viewport center or offset from existing nodes) without moving existing nodes.
  * When removing a node or edge via the UI, keep all remaining nodes at their current positions.

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

### 4.5 Pan, Zoom & Viewport Controls
* Support panning (e.g., drag on empty canvas background or middle-mouse drag) and zooming (e.g., mouse wheel / pinch zoom, plus `+`, `-`, and `Fit to View` buttons).
* Ensure pan/zoom transforms work accurately with pointer coordinate conversion during node dragging.

### 4.6 Undo & Redo
* Maintain an undo/redo stack covering manual node position changes as well as UI-driven node/edge additions and removals.
* Ensure undoing a node drag restores the node (and its connected edges) to its prior coordinates without altering DOT text unless the undone action was a structural node/edge change.

### 4.7 SVG Export (`Download SVG`)
* Clicking **Download SVG** serializes the current graph SVG (reflecting manual node positions, updated edge paths, labels, and styling) into a standalone `.svg` file (`xmlns="http://www.w3.org/2000/svg"`) and triggers a browser download (e.g., `graph-shift.svg`).
* Exclude interactive UI overlays/selection handles from the exported SVG so the downloaded file is clean.

### 4.8 Local Persistence (`localStorage`)
* Automatically save the current DOT code (and relevant session state such as layout choice and node positions/history if appropriate) to `localStorage`.
* Restore saved state automatically on page load so refreshes, updates, or browser restarts do not lose work.

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

## 6. Suggested Project Structure & Verification
A coding agent can structure the repository cleanly as follows:

    graph-shift-app/
    ├── index.html
    ├── manifest.webmanifest
    ├── sw.js
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── pwa/
        │   └── autoUpdate.ts
        ├── dot/
        │   ├── parser.ts
        │   └── serializer.ts
        ├── layout/
        │   └── initialLayout.ts
        ├── canvas/
        │   ├── GraphCanvas.tsx
        │   └── edgeGeometry.ts
        ├── state/
        │   ├── history.ts
        │   └── storage.ts
        └── export/
            └── exportSvg.ts

* **Automated Checks:** Include unit tests for DOT parsing/serialization (especially node/edge add/remove write-back), edge geometry updates on node move, undo/redo transitions, Service Worker caching/update behavior under stale/cached responses, and SVG export serialization, plus a production build check (`npm run build`) verifying content-hashed assets and zero server dependencies.