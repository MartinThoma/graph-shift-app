import { describe, expect, it } from "vitest";
import { buildGraphModel } from "../dot/model";
import { computeLayout, type LayoutEngine } from "../layout/initialLayout";
import { createOutline } from "../render/shapes";
import { estimateTextWidth } from "../render/text";
import { computeEdgeGeometry, deformRoute, type NodeGeometry } from "./edgeGeometry";
import { computeGraphVisuals, SceneBuilder } from "./scene";
import { renderSceneSvg } from "../render/svgMarkup";
import { findNodesInRect, toggleNodeSelection } from "./GraphCanvas";

function createBox(x: number, y: number): NodeGeometry {
  return { center: { x, y }, outline: createOutline("box", 60, 40, false), width: 60, height: 40 };
}

const BASE = {
  route: null,
  bend: 0,
  loopIndex: 0,
  arrowHead: null,
  arrowTail: null,
  arrowSize: 1,
  strokeWidth: 1,
  tailPort: null,
  headPort: null,
  selfLoop: false,
};

describe("Edge geometry", () => {
  it("clips straight edges to the node boundaries", () => {
    const g = computeEdgeGeometry({ ...BASE, tail: createBox(0, 0), head: createBox(200, 0) });
    expect(g.start).toEqual({ x: 30, y: 0 });
    expect(g.end).toEqual({ x: 170, y: 0 });
  });

  it("edge endpoints follow a moved node", () => {
    const g = computeEdgeGeometry({ ...BASE, tail: createBox(0, 0), head: createBox(0, 300) });
    expect(g.start).toEqual({ x: 0, y: 20 });
    expect(g.end).toEqual({ x: 0, y: 280 });
  });

  it("clips edges to ellipse outlines", () => {
    const ellipse: NodeGeometry = { center: { x: 0, y: 0 }, outline: createOutline("ellipse", 80, 40, false), width: 80, height: 40 };
    const g = computeEdgeGeometry({ ...BASE, tail: ellipse, head: createBox(0, 200) });
    expect(g.start.y).toBeCloseTo(20);
  });

  it("stops the line short of the arrow tip and places the arrow at the boundary", () => {
    const g = computeEdgeGeometry({ ...BASE, tail: createBox(0, 0), head: createBox(200, 0), arrowHead: "normal" });
    expect(g.end).toEqual({ x: 170, y: 0 });
    expect(g.headArrow).not.toBeNull();
    expect(g.path).toMatch(/L162\.5 0$/);
  });

  it("parallel edges bend in opposite directions", () => {
    const a = computeEdgeGeometry({ ...BASE, tail: createBox(0, 0), head: createBox(200, 0), bend: 11 });
    const b = computeEdgeGeometry({ ...BASE, tail: createBox(0, 0), head: createBox(200, 0), bend: -11 });
    expect(a.labelAnchor.y).toBeGreaterThan(0);
    expect(b.labelAnchor.y).toBeLessThan(0);
    expect(a.path).toContain("Q");
  });

  it("self-loops start and end on the same node and grow with their index", () => {
    const node = createBox(0, 0);
    const first = computeEdgeGeometry({ ...BASE, tail: node, head: node, selfLoop: true });
    const second = computeEdgeGeometry({ ...BASE, tail: node, head: node, selfLoop: true, loopIndex: 1 });
    expect(first.start.x).toBeCloseTo(30);
    expect(first.end.x).toBeCloseTo(30);
    expect(second.labelAnchor.x).toBeGreaterThan(first.labelAnchor.x);
  });

  it("routes deform with endpoint displacement", () => {
    const route = { points: [{ x: 50, y: 50 }], tail: { x: 0, y: 0 }, head: { x: 100, y: 100 } };
    expect(deformRoute(route, { x: 0, y: 0 }, { x: 100, y: 100 })).toBe(route.points);
    const moved = deformRoute(route, { x: 0, y: 0 }, { x: 300, y: 100 });
    expect(moved[0].x).toBeCloseTo(150);
    expect(moved[0].y).toBeCloseTo(50);
  });
});

describe("Layouts", () => {
  const model = buildGraphModel("digraph { a -> b; b -> c; a -> c; d; e -> e }");
  const visuals = computeGraphVisuals(model, estimateTextWidth);
  const sizes = new Map([...visuals.nodes].map(([id, v]) => [id, { width: v.width, height: v.height }]));

  for (const engine of ["hierarchical", "force", "radial", "circular", "grid"] as LayoutEngine[]) {
    it(`the ${engine} layout positions every node without overlaps, deterministically`, () => {
      const input = { model, sizes, edgeLabelSizes: new Map(), rankdir: "TB" as const };
      const first = computeLayout(engine, input);
      const second = computeLayout(engine, input);
      expect(first).toEqual(second);
      const ids = Object.keys(first.positions).sort();
      expect(ids).toEqual(["a", "b", "c", "d", "e"]);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const p = first.positions[ids[i]];
          const q = first.positions[ids[j]];
          const overlapX = Math.abs(p.x - q.x) < (sizes.get(ids[i])!.width + sizes.get(ids[j])!.width) / 2;
          const overlapY = Math.abs(p.y - q.y) < (sizes.get(ids[i])!.height + sizes.get(ids[j])!.height) / 2;
          expect(overlapX && overlapY).toBe(false);
        }
      }
    });
  }

  for (const engine of ["force", "radial", "circular", "grid"] as LayoutEngine[]) {
    it(`the ${engine} layout keeps cluster members together and other nodes outside the cluster box`, () => {
      const m = buildGraphModel("digraph { a -> b; subgraph cluster_x { c; d; e } b -> c; a -> e; f; g -> a }");
      const v = computeGraphVisuals(m, estimateTextWidth);
      const s = new Map([...v.nodes].map(([id, n]) => [id, { width: n.width, height: n.height }]));
      const { positions } = computeLayout(engine, { model: m, sizes: s, edgeLabelSizes: new Map(), rankdir: "TB" });
      const scene = new SceneBuilder().build(m, v, positions, {});
      const box = scene.clusters[0].rect;
      for (const id of ["a", "b", "f", "g"]) {
        const p = positions[id];
        const inside = p.x > box.x && p.x < box.x + box.w && p.y > box.y && p.y < box.y + box.h;
        expect(inside).toBe(false);
      }
    });
  }

  it("the hierarchical layout honors rankdir=LR", () => {
    const lr = buildGraphModel("digraph { rankdir=LR; a -> b }");
    const v = computeGraphVisuals(lr, estimateTextWidth);
    const s = new Map([...v.nodes].map(([id, n]) => [id, { width: n.width, height: n.height }]));
    const result = computeLayout("hierarchical", { model: lr, sizes: s, edgeLabelSizes: new Map(), rankdir: "LR" });
    expect(result.positions.b.x).toBeGreaterThan(result.positions.a.x);
  });
});

describe("Scene and SVG export", () => {
  const model = buildGraphModel(`digraph G {
    label="My graph";
    subgraph cluster_x { label="Cluster"; a; b }
    a -> b [label="go"];
    a -> b;
    b -> b;
    c [shape=record, label="{x|<p>y}|z"];
  }`);
  const visuals = computeGraphVisuals(model, estimateTextWidth);
  const positions = { a: { x: 0, y: 0 }, b: { x: 0, y: 120 }, c: { x: 200, y: 60 } };

  it("cluster boxes enclose their member nodes and move with them", () => {
    const builder = new SceneBuilder();
    const scene = builder.build(model, visuals, positions, {});
    const box = scene.clusters[0].rect;
    expect(box.x).toBeLessThan(-27);
    expect(box.y + box.h).toBeGreaterThan(138);
    const moved = builder.build(model, visuals, { ...positions, b: { x: 0, y: 400 } }, {});
    expect(moved.clusters[0].rect.y + moved.clusters[0].rect.h).toBeGreaterThan(418);
  });

  it("unchanged primitives are reused between frames", () => {
    const builder = new SceneBuilder();
    const first = builder.build(model, visuals, positions, {});
    const second = builder.build(model, visuals, { ...positions, c: { x: 300, y: 60 } }, {});
    expect(second.nodes[0]).toBe(first.nodes[0]);
    expect(second.edges[0]).toBe(first.edges[0]);
    expect(second.nodes[2]).not.toBe(first.nodes[2]);
  });

  it("exports a standalone SVG with the namespace, all nodes, edges and labels at current positions", () => {
    const scene = new SceneBuilder().build(model, visuals, positions, {});
    const svg = renderSceneSvg(scene, "G");
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg.match(/class="node"/g)).toHaveLength(3);
    expect(svg.match(/class="edge"/g)).toHaveLength(3);
    expect(svg).toContain('transform="translate(200 60)"');
    expect(svg).toContain(">go</text>");
    expect(svg).toContain(">My graph</text>");
    expect(svg).toContain(">Cluster</text>");
    expect(svg).not.toMatch(/selected|hand-placed|data-/);
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  });

  it("escapes special characters in labels", () => {
    const m = buildGraphModel('digraph { a [label="<&>\\"x"] }');
    const scene = new SceneBuilder().build(m, computeGraphVisuals(m, estimateTextWidth), { a: { x: 0, y: 0 } }, {});
    expect(renderSceneSvg(scene)).toContain("&lt;&amp;&gt;&quot;x");
  });
});

describe("Selection helpers", () => {
  const model = buildGraphModel("digraph { a; b; c }");
  const visuals = computeGraphVisuals(model, estimateTextWidth);
  const scene = new SceneBuilder().build(model, visuals, { a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, c: { x: 0, y: 300 } }, {});

  it("rectangle selection picks every node whose box intersects the rectangle", () => {
    expect(findNodesInRect(scene.nodes, { x: -10, y: -10, w: 190, h: 20 }).sort()).toEqual(["a", "b"]);
    expect(findNodesInRect(scene.nodes, { x: 500, y: 500, w: 10, h: 10 })).toEqual([]);
  });

  it("Shift+click toggles nodes in and out of the selection", () => {
    let selection = toggleNodeSelection(null, "a");
    expect(selection).toEqual({ kind: "nodes", ids: ["a"] });
    selection = toggleNodeSelection(selection, "b");
    expect(selection).toEqual({ kind: "nodes", ids: ["a", "b"] });
    selection = toggleNodeSelection(selection, "a");
    expect(selection).toEqual({ kind: "nodes", ids: ["b"] });
    expect(toggleNodeSelection(selection, "b")).toBeNull();
  });
});
