import { describe, expect, it } from "vitest";
import { buildGraphModel, createEdgeKey } from "./model";
import { DotSyntaxError, parseDot } from "./parser";
import {
  addEdgeToDot,
  addNodeToDot,
  createUniqueNodeId,
  quoteId,
  removeEdgeFromDot,
  removeNodeFromDot,
} from "./serializer";

describe("DOT parser", () => {
  it("parses digraphs with chains, attributes, subgraphs, ports and comments", () => {
    const src = `/* header */
strict digraph "G 1" {
  # preprocessor line
  rankdir=LR; // comment
  node [shape=box, color="red"];
  a:p1:n -> b -> {c d} [label=<<b>x</b>>];
  subgraph cluster_x { label="X"; e; }
}`;
    const ast = parseDot(src);
    expect(ast.strict).toBe(true);
    expect(ast.directed).toBe(true);
    expect(ast.id?.value).toBe("G 1");
    expect(ast.stmts.map((s) => s.type)).toEqual(["assign", "attr", "edge", "subgraph"]);
    const edge = ast.stmts[2];
    if (edge.type !== "edge") throw new Error("expected edge");
    expect(edge.operands).toHaveLength(3);
    expect(edge.attrs[0].items[0].value?.kind).toBe("html");
    expect(edge.attrs[0].items[0].value?.value).toBe("<b>x</b>");
  });

  it("reports a syntax error with line and column", () => {
    try {
      parseDot("digraph {\n  a -> ;\n}");
      throw new Error("should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DotSyntaxError);
      const e = error as DotSyntaxError;
      expect(e.line).toBe(2);
      expect(e.column).toBe(8);
      expect(e.message).toMatch(/node ID/);
    }
  });

  it("rejects the wrong edge operator for the graph type", () => {
    expect(() => parseDot("graph { a -> b }")).toThrow(/only allowed in a digraph/);
    expect(() => parseDot("digraph { a -- b }")).toThrow(/only allowed in a graph/);
  });

  it("concatenates quoted strings joined with '+' and resolves escaped quotes", () => {
    const ast = parseDot('digraph { a [label="x" + "\\"y\\""] }');
    const stmt = ast.stmts[0];
    if (stmt.type !== "node") throw new Error("expected node");
    expect(stmt.attrs[0].items[0].value?.value).toBe('x"y"');
  });
});

describe("Graph model", () => {
  it("expands edge chains and subgraph operands into individual edges", () => {
    const model = buildGraphModel("digraph { a -> {b c} -> d }");
    expect(model.edges.map((e) => `${e.tail}>${e.head}`)).toEqual(["a>b", "a>c", "b>d", "c>d"]);
  });

  it("applies node defaults at creation time within their scope", () => {
    const model = buildGraphModel(`digraph {
      node [shape=box];
      a;
      subgraph s { node [color=red]; b; }
      c;
      a [color=blue];
    }`);
    expect(model.nodes.get("a")!.attrs).toEqual({ shape: "box", color: "blue" });
    expect(model.nodes.get("b")!.attrs).toEqual({ shape: "box", color: "red" });
    expect(model.nodes.get("c")!.attrs).toEqual({ shape: "box" });
  });

  it("assigns stable keys to multi-edges and self-loops", () => {
    const model = buildGraphModel("digraph { a -> b; a -> b; a -> a }");
    expect(model.edges.map((e) => e.key)).toEqual([
      createEdgeKey("a", "b", 0),
      createEdgeKey("a", "b", 1),
      createEdgeKey("a", "a", 0),
    ]);
  });

  it("merges duplicate edges in strict graphs", () => {
    const model = buildGraphModel("strict graph { a -- b; b -- a [color=red] }");
    expect(model.edges).toHaveLength(1);
    expect(model.edges[0].attrs.color).toBe("red");
  });

  it("records nested cluster membership and cluster attributes", () => {
    const model = buildGraphModel(`digraph {
      subgraph cluster_outer { label="Outer"; a; subgraph cluster_inner { color=blue; b } }
      c;
    }`);
    expect(model.clusters.get("cluster_outer")!.nodeIds.sort()).toEqual(["a", "b"]);
    expect(model.clusters.get("cluster_inner")!.parent).toBe("cluster_outer");
    expect(model.clusters.get("cluster_inner")!.attrs.color).toBe("blue");
    expect(model.nodes.get("b")!.cluster).toBe("cluster_inner");
    expect(model.nodes.get("c")!.cluster).toBeNull();
  });
});

describe("DOT write-back: adding", () => {
  it("adding a node inserts an indented statement before the closing brace", () => {
    const src = "digraph G {\n    a -> b;\n}\n";
    expect(addNodeToDot(src, "c")).toBe("digraph G {\n    a -> b;\n    c;\n}\n");
  });

  it("adding a node with a label quotes the label", () => {
    const src = "digraph {\n  a;\n}";
    expect(addNodeToDot(src, "n1", 'Say "hi"')).toBe('digraph {\n  a;\n  n1 [label="Say \\"hi\\""];\n}');
  });

  it("adding an edge uses '->' in a digraph and '--' in a graph", () => {
    expect(addEdgeToDot("digraph {\n  a;\n}", "a", "b")).toBe("digraph {\n  a;\n  a -> b;\n}");
    expect(addEdgeToDot("graph {\n  a;\n}", "a", "my node")).toBe('graph {\n  a;\n  a -- "my node";\n}');
  });

  it("adding to a single-line graph keeps it on one line and separates statements", () => {
    expect(addNodeToDot("digraph { a -> b }", "c")).toBe("digraph { a -> b; c; }");
    expect(addNodeToDot("digraph {}", "c")).toBe("digraph { c; }");
  });

  it("adding preserves comments and formatting elsewhere", () => {
    const src = "digraph {\n  // keep me\n  a [shape=box]; /* and me */\n}\n";
    const out = addEdgeToDot(src, "a", "a");
    expect(out).toBe("digraph {\n  // keep me\n  a [shape=box]; /* and me */\n  a -> a;\n}\n");
  });

  it("quotes IDs that are keywords or contain special characters", () => {
    expect(quoteId("node")).toBe('"node"');
    expect(quoteId("a b")).toBe('"a b"');
    expect(quoteId("abc_1")).toBe("abc_1");
    expect(quoteId("-1.5")).toBe("-1.5");
  });

  it("creates unique node IDs that do not collide with existing ones", () => {
    const model = buildGraphModel("digraph { n1; n2 }");
    expect(createUniqueNodeId(model)).toBe("n3");
  });
});

describe("DOT write-back: removing", () => {
  it("removing an edge deletes its statement line and keeps both endpoints", () => {
    const src = "digraph {\n  a -> b;\n  c;\n}\n";
    const out = removeEdgeFromDot(src, createEdgeKey("a", "b", 0));
    const model = buildGraphModel(out);
    expect(model.edges).toHaveLength(0);
    expect([...model.nodes.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(out).toBe("digraph {\n  c;\n  a;\n  b;\n}\n");
  });

  it("removing the first edge of a chain keeps the rest of the chain and its attributes", () => {
    const src = "digraph {\n  a -> b -> c [color=red];\n}";
    const out = removeEdgeFromDot(src, createEdgeKey("a", "b", 0));
    expect(out).toBe("digraph {\n  b -> c [color=red];\n  a;\n}");
  });

  it("removing a middle edge splits a chain into two statements", () => {
    const src = "digraph {\n  a -> b -> c -> d;\n}";
    const out = removeEdgeFromDot(src, createEdgeKey("b", "c", 0));
    expect(out).toBe("digraph {\n  a -> b; c -> d;\n}");
  });

  it("removing one of two parallel edges keeps the other", () => {
    const src = "digraph {\n  a -> b [label=one];\n  a -> b [label=two];\n}";
    const out = removeEdgeFromDot(src, createEdgeKey("a", "b", 1));
    expect(out).toBe("digraph {\n  a -> b [label=one];\n}");
  });

  it("removing one expansion of a subgraph operand re-adds the other expansions", () => {
    const src = "digraph {\n  a -> {b c} [color=red];\n}";
    const out = removeEdgeFromDot(src, createEdgeKey("a", "c", 0));
    const model = buildGraphModel(out);
    expect(model.edges.map((e) => `${e.tail}>${e.head}:${e.attrs.color}`)).toEqual(["a>b:red"]);
    expect(model.nodes.has("c")).toBe(true);
  });

  it("removing a node deletes its declarations and incident edges, keeping other nodes", () => {
    const src = `digraph {
  b [label="B"];
  a -> b -> c;
  b -> b;
  d -> {b e};
}`;
    const out = removeNodeFromDot(src, "b");
    const model = buildGraphModel(out);
    expect(model.nodes.has("b")).toBe(false);
    expect([...model.nodes.keys()].sort()).toEqual(["a", "c", "d", "e"]);
    expect(model.edges.map((e) => `${e.tail}>${e.head}`)).toEqual(["d>e"]);
    expect(out).not.toContain("B");
  });

  it("removing a node inside a cluster keeps the cluster and its other members", () => {
    const src = `digraph {
  subgraph cluster_db {
    label="DB";
    primary;
    replica;
    primary -> replica;
  }
}`;
    const out = removeNodeFromDot(src, "replica");
    expect(out).toBe(`digraph {
  subgraph cluster_db {
    label="DB";
    primary;
  }
}`);
  });

  it("removing a self-loop leaves the node in place", () => {
    const src = "digraph {\n  a -> a;\n  a [shape=box];\n}";
    const out = removeEdgeFromDot(src, createEdgeKey("a", "a", 0));
    expect(out).toBe("digraph {\n  a [shape=box];\n}");
  });

  it("removing edges in an undirected graph uses the declared direction as key", () => {
    const src = "graph {\n  a -- b;\n  b -- a;\n}";
    const out = removeEdgeFromDot(src, createEdgeKey("b", "a", 0));
    expect(out).toBe("graph {\n  a -- b;\n}");
  });

  it("removing a quoted node ID works with its unescaped name", () => {
    const src = 'digraph {\n  "web server" -> db;\n}';
    const out = removeNodeFromDot(src, "web server");
    expect(out).toBe("digraph {\n  db;\n}");
  });
});
