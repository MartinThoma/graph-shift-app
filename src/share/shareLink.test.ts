import { describe, expect, it } from "vitest";
import { createShareLink, decodeShareData, encodeShareData, parseShareHash, type SharedDocument } from "./shareLink";

const DOC: SharedDocument = {
  dot: 'digraph G {\n  a [label="Ä \\"quoted\\""];\n  a -> b;\n}\n',
  engine: "radial",
  groupIsolated: false,
  positions: { a: { x: 10.4, y: 20.6 }, b: { x: 100, y: 200 } },
  routes: { "a\u001fb\u001f0": { tail: { x: 10, y: 20 }, head: { x: 100, y: 200 }, points: [{ x: 50, y: 60 }] } },
  manualNodes: ["a"],
};

describe("Share links", () => {
  it("round-trips the DOT text, layout settings and hand-placed positions", async () => {
    const data = await encodeShareData(DOC);
    const doc = await decodeShareData(data);
    expect(doc.dot).toBe(DOC.dot);
    expect(doc.engine).toBe("radial");
    expect(doc.groupIsolated).toBe(false);
    expect(doc.positions).toEqual({ a: { x: 10, y: 21 }, b: { x: 100, y: 200 } });
    expect(doc.manualNodes).toEqual(["a"]);
    expect(doc.routes!["a\u001fb\u001f0"].points).toEqual([{ x: 50, y: 60 }]);
  });

  it("leaves positions out when nothing was placed by hand", async () => {
    const doc = await decodeShareData(await encodeShareData({ ...DOC, manualNodes: [] }));
    expect(doc.positions).toBeUndefined();
  });

  it("compresses: a repetitive graph becomes much shorter than its text", async () => {
    const dot = `digraph { ${Array.from({ length: 300 }, (_, i) => `node_${i} -> node_${i + 1};`).join(" ")} }`;
    const data = await encodeShareData({ dot, engine: "hierarchical" });
    expect(data.length).toBeLessThan(dot.length / 2);
  });

  it("builds a link from the page URL and reads it back from the hash", async () => {
    const result = await createShareLink(DOC, "https://example.github.io/graph-shift-app/?x=1#old");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url.startsWith("https://example.github.io/graph-shift-app/?x=1#share=v1.")).toBe(true);
    const data = parseShareHash(new URL(result.url).hash)!;
    expect((await decodeShareData(data)).dot).toBe(DOC.dot);
    expect(parseShareHash("#other")).toBeNull();
  });

  it("falls back to a link without positions, then refuses when even that is too long", async () => {
    const full = await createShareLink(DOC, "https://x.test/", 100000);
    const lean = await createShareLink({ ...DOC, manualNodes: [] }, "https://x.test/", 100000);
    expect(full.ok && lean.ok).toBe(true);
    if (!full.ok || !lean.ok) return;
    const between = await createShareLink(DOC, "https://x.test/", lean.length);
    expect(between).toMatchObject({ ok: true, withPositions: false });
    const tooBig = await createShareLink(DOC, "https://x.test/", 20);
    expect(tooBig).toMatchObject({ ok: false, limit: 20 });
  });

  it("rejects malformed or foreign data", async () => {
    await expect(decodeShareData("v9.abc")).rejects.toThrow(/format/);
    await expect(decodeShareData("v1.not-deflate")).rejects.toThrow();
  });
});
