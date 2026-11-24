---
name: Graph Shift
description: A white drafting sheet for DOT graphs. Fine ink, a two-weight grid, and one vermilion for what your hand did.
colors:
  paper: "#fbfbf9"
  white: "#ffffff"
  ink: "#1c1f23"
  ink-2: "#3a3f45"
  muted: "#5b6168"
  muted-2: "#6b7177"
  disabled: "#9aa0a6"
  cluster-stroke: "#8a9097"
  hair: "#e3e6e9"
  control: "#c4c9cf"
  control-hover: "#f2f4f6"
  grid-minor: "#eef0f2"
  grid-major: "#dde1e5"
  active-line: "#f5f6f8"
  accent: "#e0452b"
  accent-text: "#c2381f"
  accent-deep: "#7d2412"
  accent-wash: "#fdeee9"
  selection: "#fbd9cf"
  danger-text: "#a3321f"
typography:
  title:
    fontFamily: '"Inter Variable", Inter, "Helvetica Neue", Helvetica, Arial, sans-serif'
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: '"Inter Variable", Inter, "Helvetica Neue", Helvetica, Arial, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: '"cv11", "ss01"'
  body-strong:
    fontFamily: '"Inter Variable", Inter, "Helvetica Neue", Helvetica, Arial, sans-serif'
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  label:
    fontFamily: '"Inter Variable", Inter, "Helvetica Neue", Helvetica, Arial, sans-serif'
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.06em"
  code:
    fontFamily: '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "22px"
  graph-node:
    fontFamily: '"Inter Variable", Inter, "Helvetica Neue", Helvetica, Arial, sans-serif'
    fontSize: "14px"
    fontWeight: 400
  graph-cluster:
    fontFamily: '"Inter Variable", Inter, "Helvetica Neue", Helvetica, Arial, sans-serif'
    fontSize: "13px"
    fontWeight: 400
  graph-edge:
    fontFamily: '"Inter Variable", Inter, "Helvetica Neue", Helvetica, Arial, sans-serif'
    fontSize: "12px"
    fontWeight: 400
rounded:
  sm: "4px"
  md: "6px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  pane: "14px"
  xl: "16px"
  xxl: "20px"
components:
  button:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "30px"
  button-hover:
    backgroundColor: "{colors.control-hover}"
    textColor: "{colors.ink}"
  button-active:
    backgroundColor: "{colors.hair}"
  button-disabled:
    backgroundColor: "{colors.white}"
    textColor: "{colors.disabled}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "30px"
  button-primary-hover:
    backgroundColor: "{colors.ink-2}"
    textColor: "{colors.white}"
  button-primary-disabled:
    backgroundColor: "{colors.hair}"
    textColor: "{colors.muted}"
  button-icon:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    size: "30px"
  button-danger:
    backgroundColor: "{colors.white}"
    textColor: "{colors.danger-text}"
    rounded: "{rounded.sm}"
    height: "30px"
  button-attention:
    backgroundColor: "{colors.white}"
    textColor: "{colors.accent-text}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.sm}"
    height: "30px"
  button-attention-hover:
    backgroundColor: "{colors.accent-wash}"
  select:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 28px 0 10px"
    height: "30px"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "32px"
  popover:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "14px"
    width: "280px"
  dialog:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "20px"
    width: "440px"
  status-chip:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  status-chip-notice:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.accent-deep}"
  error-slip:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.accent-deep}"
    padding: "10px 14px 12px"
  toolbar:
    backgroundColor: "{colors.white}"
    height: "56px"
    padding: "0 16px"
  pane-head:
    backgroundColor: "{colors.white}"
    height: "36px"
    padding: "0 14px"
  pane-tab:
    textColor: "{colors.muted}"
    typography: "{typography.body-strong}"
    height: "40px"
  pane-tab-active:
    textColor: "{colors.ink}"
---

# Design System: Graph Shift

## Overview

**Creative North Star: "The Drafting Grid"**

Graph Shift is a white drafting sheet on an engineer's desk. The sheet carries a quiet two-weight grid in cool greys. Graphs are drawn on it in fine technical-pen ink: hairline outlines, edges just over 1px, and small, sharp arrow tips. The chrome around the sheet is white paper too. It is cut apart by single ink rules, not by panels, cards or shading. The system is dense and calm, built for long keyboard-heavy sessions. Type is a workhorse sans at 13px. The DOT source is set in mono.

One colour speaks. Vermilion marks what the user's hand did: hand-placed corner ticks, the selection, the pending edge, the "Placed by hand" lock state. It also marks the few things that need the user's attention: parse errors, invalid input, a ready update. Everything else is ink on white, so a glance at the sheet shows which positions are the user's.

The user chose this world deliberately. It is light only. Edges are thin ink with small tips, never thick coloured arrows with big heads. The grid is neutral grey, never tinted green. The category default it rejects is a dark editor beside a dotted grey canvas.

**Key Characteristics:**
- Light only: a near-white sheet (`paper`) with white chrome (`white`).
- Two-weight grid: minor lines every 20px, major lines every 100px, both hairline cool grey.
- Fine ink: drawn edges at 1.1 pen width, arrow tips 7.5 long by 5.8 wide at `arrowsize=1`.
- Single 1px ink rules separate the regions: under the toolbar, at the splitter, and under the mobile pane tabs.
- One vermilion family, reserved for the hand and for attention.
- Flat chrome. Only the popover and the confirm dialog lift off the sheet.

## Colors

Ink-on-paper neutrals carry almost everything. A single vermilion family is held back for the user's hand and for attention.

### Primary
- **Drafting Vermilion** (`accent`): the stroke colour for the user's hand on the sheet. It draws the hand-placed corner tick, the selected-node frame, the edge-source frame in add-edge mode, the pending edge preview, the selected-edge halo (at 0.55 opacity), the error-slip rule, the invalid-input border, the splitter on hover and focus, and the mobile tab error dot. It is a stroke and fill colour. Vermilion text uses Vermilion Text instead.
- **Vermilion Text** (`accent-text`): vermilion at text contrast. Used for the "Placed by hand" lock state, form errors and the update-ready button label.
- **Burnt Vermilion** (`accent-deep`): body text on Vermilion Wash, in the error slip and the status notice.
- **Vermilion Wash** (`accent-wash`): the ground of the error slip, the status notice and the update button's hover.
- **Vermilion Tracing** (`selection`): text selection, in the editor and across the app.

### Secondary
- **Deep Brick** (`danger-text`): the label colour of the destructive buttons (Remove node, Remove edge, Reset layout…) when they are enabled. It is a separate role from the accent even though its hue sits close to vermilion. It is darker and is only ever text on a white button.

### Neutral
- **Drafting Paper** (`paper`): the on-screen sheet behind the graph, the page background, and the dialog backdrop (at 0.72 alpha).
- **Clean White** (`white`): the toolbar, editor pane, buttons, inputs, popover, dialog and status chip. It is also the default fill of exported drawings, whose paper is pure white rather than the on-screen sheet colour.
- **Pen Ink** (`ink`): all primary text, node outlines and drawn edges, structural rules, the filled primary button and the focus ring.
- **Soft Ink** (`ink-2`): secondary prose, the status chip text, control hover borders and the primary button's hover.
- **Graphite** (`muted`): pane metadata, control labels, hints and empty-state text on the canvas. Also muted text in drawn graphs.
- **Light Graphite** (`muted-2`): editor line numbers, placeholders, comments and punctuation.
- **Cluster Grey** (`cluster-stroke`): the default outline of DOT clusters in drawn graphs.
- **Disabled Grey** (`disabled`): disabled button labels only.
- **Control Rule** (`control`): 1px borders of buttons, selects, inputs and the status chip, status separators and the scrollbar thumb.
- **Hairline** (`hair`): soft internal dividers (under the pane head), disabled borders and the pressed-button ground.
- **Hover Wash** (`control-hover`): button hover ground.
- **Grid Minor / Grid Major** (`grid-minor`, `grid-major`): the two weights of the sheet grid. Grid Major also outlines matching brackets in the editor.
- **Active Line** (`active-line`): the editor's current-line band.

### Editor syntax palette (editor only)
The DOT editor has its own palette: keywords in Pen Ink at weight 600, identifiers in Pen Ink, attribute names in a slate grey (#4b5560), strings in a pen-brown (#8a4f0e), numbers in a drafting blue (#1d5f8a), and comments (italic) and punctuation in Light Graphite. These hues live in the editor only. They never appear in chrome or on the sheet.

### Named Rules
**The Hand-and-Attention Rule.** Vermilion marks what the user's hand did (placed, selected, picking) and what needs the user's attention (an error, an invalid field, a ready update). It is never decoration, never a brand fill, and never plain chrome. If an element is neither the user's mark nor a call for attention, it is ink or grey.

**The Ink Primary Rule.** The single filled button is ink (Download SVG). The primary action is ink, never vermilion, so that vermilion keeps meaning "your hand".

**The Neutral Grid Rule.** The grid is cool neutral grey. It carries no green, blue or warm tint. The user asked for the computation-pad grid without the green.

## Typography

**UI Font:** Inter Variable (with Inter, Helvetica Neue, Helvetica, Arial, sans-serif), self-hosted, with the `cv11` and `ss01` features on.
**Code Font:** JetBrains Mono (400 and 600, with ui-monospace, SFMono-Regular, Menlo, Consolas), self-hosted.

**Character:** A neutral workhorse sans for every label, and a plain engineer's mono for the source. Neither font is there to perform. The drawing is the subject.

### Hierarchy
- **Title** (700, 15px): confirm-dialog headings only. There is no display or headline size. The largest type in the app is the dialog title.
- **Body** (400, 13px, 1.4): all UI text. Dialog prose loosens to 1.5. The status chip and error slip use 1.45.
- **Body Strong** (600 to 700, 13px): the wordmark, pane headings, pressed toggles, the primary button, the lock state, form errors and the bold counts in the status chip.
- **Label** (700, 11px, 0.06em, uppercase, Graphite): names a form control. Used for "Layout" beside the select and for popover field names.
- **Code** (400, 13px, 22px line height, ligatures off): the DOT editor.
- **Graph Node / Cluster / Edge** (14px / 13px / 12px): label sizes in drawn graphs, overridable by DOT `fontsize`.

Numeric readouts (zoom level, pane metadata) use `tabular-nums`.

### Named Rules
**The Control Label Rule.** The uppercase tracked label names an adjacent control and nothing else. It is never a heading, a section opener or a kicker above a title.

**The Thirteen Rule.** Chrome text sits at 13px. Hierarchy comes from weight (400/600/700) and from ink versus Graphite, not from size steps.

## Layout

The app is one screen with no page scroll. A 56px toolbar sits under a single ink rule. Below it the workspace is a three-column grid: the editor pane (default 440px, resizable), a 1px ink splitter, and the sheet filling the rest. The splitter has an invisible 4px grab margin on each side, and turns vermilion on hover and focus.

Toolbar groups are 20px apart. Controls inside a group are 6px apart. The destructive group sits 20px further out, set apart from the editing controls. Download SVG is pinned right by a flexible spacer. The pane head is 36px tall with 14px side padding and a Hairline underneath.

On the sheet, the status chip floats 16px from the left and 14px from the bottom. Zoom controls float bottom right, 4px apart. The grid is a 20px minor and 100px major pattern in sheet coordinates. The minor grid is hidden once it would be drawn below 7 screen px.

Responsive steps:
- **≤1360px:** destructive buttons collapse to 30px icon squares.
- **≤1100px:** the add buttons and the lock-state text collapse to icons. The toolbar gap tightens to 12px.
- **≤760px:** the toolbar wraps to two rows. Controls grow to 34px for touch, and zoom buttons to 36×40. A two-tab switcher (DOT source / Graph) replaces the split view. The active tab is ink with a 2px inset ink underline. Popovers pin full-width 12px from the edges.

## Elevation & Depth

The chrome is flat. Regions are separated by 1px rules (ink for structure, Hairline inside a pane) and by the paper/white step between sheet and chrome. Two surfaces lift: the add-node popover and the confirm dialog. Each has a soft, diffuse ink-tinted shadow and a 1px ink border. The dialog backdrop is paper at 0.72 alpha, which washes the sheet out instead of darkening it.

### Shadow Vocabulary
- **Popover lift** (`box-shadow: 0 8px 24px rgb(28 31 35 / 0.12)`): anchored popovers.
- **Dialog lift** (`box-shadow: 0 16px 48px rgb(28 31 35 / 0.18)`): modal confirmations.
- **Pressed double-line** (`box-shadow: inset 0 0 0 1px var(--ink)`): a border device, not elevation. It doubles the ink border on pressed toggles, expanded triggers and focused inputs.

### Named Rules
**The Ruled-Not-Raised Rule.** Regions are separated by single ink rules, never by shadows or tinted panels. Only floating, transient surfaces (popover, dialog) cast a shadow.

## Shapes

Corners are barely softened: 4px (`rounded.sm`) for every control and the status chip, 6px (`rounded.md`) for the popover, the dialog and the scrollbar thumb. Borders are always 1px. Lines on the sheet are technical-pen fine. Drawn edges are 1.1 pen width, and arrowheads are slender (length 7.5, half-width 2.9 at `arrowsize=1`, growing only gently with pen width). Overlay strokes stay constant on screen at any zoom: 2px for selection frames, 1.5px dashed for the pending edge. The hand mark is a square-capped 2px corner tick, the same mark the app icon carries.

**The Fine Pen Rule.** Default edges stay at pen width 1.1 in ink, with small arrow tips. Edges are never thick, never coloured by default, and never fitted with oversized heads. Users can still set their own `color` and `penwidth` in DOT.

## Components

### Buttons
Quiet, ruled and compact. They read like labelled boxes on a form.
- **Shape:** gently squared (4px), 30px tall (34px on touch layouts), 0 10px padding, icon and label 7px apart. Icon-only buttons are 30px squares.
- **Default:** white with a Control Rule border and ink text. Hover is Hover Wash with a Soft Ink border. Active is Hairline. Transitions take 120ms on `--ease-out`.
- **Primary:** filled ink with white 600-weight text. Hover is Soft Ink. Disabled is Hairline ground with Graphite text. There is one per screen.
- **Pressed / expanded toggle:** ink border doubled by the inset ink line, 600 weight.
- **Danger:** a default button with Deep Brick text when enabled, grouped away from the other edits.
- **Attention (update ready):** vermilion border and Vermilion Text label at 600. Hover is Vermilion Wash.
- **Disabled:** Disabled Grey text and a Hairline border.
- **Focus:** a 2px ink outline, 2px offset, everywhere.

### Inputs / Fields
- **Style:** white, 1px Control Rule border, 4px corners, 32px tall in popovers. Placeholders are Light Graphite.
- **Focus:** the border turns ink and is doubled by the inset ink line. There is no glow.
- **Error:** vermilion border, plus a 600-weight Vermilion Text message below.
- **Select:** 30px, a white field with a drawn 10×6 ink chevron. Hover gives a Soft Ink border.

### Popover and Dialog
- **Popover:** 280px of white with a 1px ink border, 6px corners, 14px padding, 10px gaps and the popover lift. It rises 4px into place over 160ms. Fields are stacked under Control Labels, and actions are right-aligned.
- **Inspector:** a 248px floating panel at the canvas's top-right (full width, 12px from the edges, below 760px) with the popover's border, corners and lift. Its title is the node ID in mono 600, or "N nodes". Fields stack under Control Labels; colour rows are label, 44×30px swatch button, and a reset button ("None" / "Default"). The swatch opens an inline palette on a Paper ground with a Hairline border: Control-Label section titles (Typical, In this graph, Custom), 20px swatches with 4px corners in a 5px grid, the current colour marked by a 2px ink outline, and a native picker with the hex value in mono. A Graphite note says where changes go. It appears only while nodes are selected.
- **Dialog:** at most 440px, with the same border and corners, 20px padding, a 15px/700 title, and Soft Ink prose at 1.5. It rises over 180ms with the dialog lift.

### Navigation (toolbar and pane tabs)
- **Toolbar:** a white 56px bar with a 1px ink rule beneath it. Left to right: wordmark, Layout control with lock state, Undo/Redo, Add node/Add edge, the destructive group, the spacer, Download SVG.
- **Pane tabs (≤760px):** two equal 40px tabs at 600 weight. Inactive tabs are Graphite. The active tab is ink with a 2px inset ink underline. A 7px vermilion dot flags an error in the source tab.

### Status chip
A floating white label with a Control Rule border, 4px corners, 6px 12px padding and Soft Ink text. Key counts are set in 600-weight ink, and clauses are separated by 1px × 11px Control Rule bars. In its notice state it switches to a Vermilion Wash ground, a vermilion border and Burnt Vermilion text. It never takes pointer events.

### Error slip
An inline strip at the foot of the editor: Vermilion Wash ground, a 1px vermilion top rule, a vermilion icon and Burnt Vermilion text. Hover underlines the message in vermilion. Clicking it jumps to the error line. Editor diagnostics use a wavy vermilion underline and a 1px vermilion left rule.

### Sheet overlays (signature)
These are drawn over the graph on screen and are never exported:
- **Hand tick:** a 2px square-capped vermilion corner at a hand-placed node's top-left. It is the system's signature mark, shown only while the "Highlight nodes placed by hand" toggle is on (off by default, since the user found it distracting).
- **Selection frame:** a 2px vermilion outline around each selected node (multi-selection shows one frame per node).
- **Selection rectangle:** while Shift+dragging (or dragging with the Select tool), a 1px dashed vermilion rectangle with a 6% vermilion fill. The Select tool's cursor is a crosshair; Space+drag shows the grab cursor. The selected edge gets a vermilion halo at 0.55 opacity, 2.5px wider than the edge.
- **Add-edge picking:** the source node gets a dashed vermilion frame, and a 1.5px dashed vermilion preview line follows the pointer. The cursor is a crosshair.

### View controls
Bottom-right of the canvas: a two-button tool toggle (Pan hand / Select rectangle, pressed state is the inset ink line), then the hand-placed highlight toggle (its corner tick turns vermilion when on), then the zoom group (−, percentage, +, fit), groups 8px apart.

### Icons
Inline 16px SVG line icons with a 1.4 stroke in `currentColor`. They are drawn, never glyphs.

## Do's and Don'ts

### Do:
- **Do** keep the whole system light: `paper` sheet, `white` chrome, `color-scheme: light`.
- **Do** draw default edges in ink at pen width 1.1 with small tips (7.5 × 5.8 at `arrowsize=1`).
- **Do** separate regions with a single 1px ink rule. Use Hairline inside a pane.
- **Do** reserve vermilion for the user's hand (ticks, selection, picking) and for attention (errors, invalid fields, a ready update).
- **Do** keep exactly one filled ink primary button per screen.
- **Do** keep overlay strokes constant on screen at every zoom level, and keep every overlay out of the SVG export.
- **Do** honour `prefers-reduced-motion` by removing all animation and transitions.

### Don't:
- **Don't** add a dark theme or dark panels. The user explicitly chose light.
- **Don't** draw thick or coloured default arrows, or large arrowheads. The user rejected thick blue arrows with big tips.
- **Don't** tint the grid green (or any hue). It stays neutral cool grey in two weights.
- **Don't** use vermilion as a brand fill, a primary button, a decorative accent or a plain chrome colour.
- **Don't** raise chrome with shadows. Only the popover and the dialog cast one.
- **Don't** use the uppercase Control Label as an eyebrow or kicker above a heading.
- **Don't** let editor syntax hues (brown, blue, slate) leak into the chrome or the sheet.
