/**
 * DOT write-back: surgical text edits for adding and removing nodes and edges.
 *
 * Instead of re-serializing the AST (which would drop comments and formatting),
 * every operation computes minimal replacements of the statements it touches.
 */
import type { AttrItem, AttrList, EdgeStmt, GraphAst, NodeRef, NodeStmt, Stmt, SubgraphStmt } from "./ast";
import { buildGraphModel, type EdgeInfo, type GraphModel } from "./model";
import { parseDot } from "./parser";

const KEYWORDS = new Set(["node", "edge", "graph", "digraph", "subgraph", "strict"]);

/** Quote a DOT ID only when needed. */
export function quoteId(id: string): string {
  if (/^[A-Za-z_\u0080-￿][A-Za-z_0-9\u0080-￿]*$/.test(id) && !KEYWORDS.has(id.toLowerCase())) {
    return id;
  }
  if (/^-?(\.[0-9]+|[0-9]+(\.[0-9]*)?)$/.test(id)) return id;
  return `"${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** Apply non-overlapping edits to a text. */
export function applyTextEdits(source: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let result = source;
  let lastStart = Infinity;
  for (const edit of sorted) {
    if (edit.end > lastStart) throw new Error("Overlapping text edits");
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    lastStart = edit.start;
  }
  return result;
}

/** Detect the indentation used for statements in the graph body. */
function detectIndent(source: string, ast: GraphAst): string {
  for (const stmt of ast.stmts) {
    const lineStart = source.lastIndexOf("\n", stmt.start - 1) + 1;
    const prefix = source.slice(lineStart, stmt.start);
    if (/^[ \t]*$/.test(prefix) && lineStart > ast.bodyStart - 1) return prefix;
  }
  return "  ";
}

/** Insert a statement at the end of the root graph body. */
export function insertStatement(source: string, statement: string): string {
  const ast = parseDot(source);
  const closePos = ast.bodyEnd;
  const lineStart = source.lastIndexOf("\n", closePos - 1) + 1;
  const beforeClose = source.slice(Math.max(lineStart, ast.bodyStart), closePos);
  const lastStmt = ast.stmts[ast.stmts.length - 1];
  const separator = lastStmt && !lastStmt.hasSemicolon ? ";" : "";
  const multiLine = source.slice(ast.bodyStart, closePos).includes("\n");

  if (multiLine && /^[ \t]*$/.test(beforeClose) && lineStart > ast.bodyStart) {
    const indent = detectIndent(source, ast);
    const insertion = `${indent}${statement};\n`;
    const edits: TextEdit[] = [{ start: lineStart, end: lineStart, text: insertion }];
    if (separator) edits.push({ start: lastStmt.end, end: lastStmt.end, text: separator });
    return applyTextEdits(source, edits);
  }
  // Single-line body (or '}' shares a line with content).
  const trimmedEnd = (() => {
    let i = closePos;
    while (i > ast.bodyStart && /[ \t]/.test(source[i - 1])) i--;
    return i;
  })();
  const needsSpace = trimmedEnd === ast.bodyStart || !/\s/.test(source[trimmedEnd - 1]);
  const insertion = `${needsSpace ? " " : ""}${statement}; `;
  if (separator && lastStmt.end === trimmedEnd) {
    return applyTextEdits(source, [{ start: trimmedEnd, end: closePos, text: separator + insertion }]);
  }
  return applyTextEdits(source, [
    ...(separator ? [{ start: lastStmt.end, end: lastStmt.end, text: separator }] : []),
    { start: trimmedEnd, end: closePos, text: insertion },
  ]);
}

/** Create an unused node ID like `n1`, `n2`, ... */
export function createUniqueNodeId(model: GraphModel, prefix = "n"): string {
  for (let i = 1; ; i++) {
    const id = `${prefix}${i}`;
    if (!model.nodes.has(id)) return id;
  }
}

/** Escape a label value for a quoted DOT string. */
export function quoteString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/** Add a node statement (with optional label) to the DOT source. */
export function addNodeToDot(source: string, id: string, label?: string): string {
  const attrs = label && label !== id ? ` [label=${quoteString(label)}]` : "";
  return insertStatement(source, `${quoteId(id)}${attrs}`);
}

/** Add an edge statement using the graph's edge operator. */
export function addEdgeToDot(source: string, tail: string, head: string): string {
  const ast = parseDot(source);
  const op = ast.directed ? "->" : "--";
  return insertStatement(source, `${quoteId(tail)} ${op} ${quoteId(head)}`);
}

/* ------------------------------------------------------------------------ */
/* Removal                                                                   */
/* ------------------------------------------------------------------------ */

interface RemovalPlan {
  /** Node to remove entirely (its statements, references and incident edges). */
  nodeId: string | null;
  /** Specific edges to remove: statement -> list of (segment, tail, head). */
  edges: Map<EdgeStmt, { segment: number; tail: string; head: string }[]>;
}

/** Compute the range to delete for a whole statement, swallowing its line when it stands alone. */
function getStatementDeletionRange(source: string, stmt: Stmt): { start: number; end: number } {
  const lineStart = source.lastIndexOf("\n", stmt.start - 1) + 1;
  const before = source.slice(lineStart, stmt.start);
  let lineEnd = source.indexOf("\n", stmt.end);
  if (lineEnd < 0) lineEnd = source.length;
  const after = source.slice(stmt.end, lineEnd);
  if (/^[ \t]*$/.test(before) && /^[ \t]*\r?$/.test(after)) {
    return { start: lineStart, end: Math.min(lineEnd + 1, source.length) };
  }
  // Inline: also remove following spaces.
  let end = stmt.end;
  while (end < source.length && /[ \t]/.test(source[end])) end++;
  return { start: stmt.start, end };
}

/** Collect all node IDs mentioned in a subgraph (recursively). */
function collectSubgraphMembers(sub: SubgraphStmt, out: Set<string> = new Set()): Set<string> {
  for (const stmt of sub.stmts) {
    if (stmt.type === "node") out.add(stmt.node.id.value);
    else if (stmt.type === "edge") {
      for (const operand of stmt.operands) {
        if (operand.type === "noderef") out.add(operand.id.value);
        else collectSubgraphMembers(operand, out);
      }
    } else if (stmt.type === "subgraph") collectSubgraphMembers(stmt, out);
  }
  return out;
}

function getOperandMembers(operand: NodeRef | SubgraphStmt): string[] {
  return operand.type === "noderef" ? [operand.id.value] : [...collectSubgraphMembers(operand)];
}

/** Produce text for a subgraph range, applying the removal plan to its inner statements. */
function renderSubgraphWithPlan(source: string, sub: SubgraphStmt, plan: RemovalPlan): string {
  const edits = planStatementEdits(source, sub.stmts, plan);
  const text = source.slice(sub.start, sub.contentEnd);
  const shifted = edits.map((e) => ({ start: e.start - sub.start, end: e.end - sub.start, text: e.text }));
  return applyTextEdits(text, shifted);
}

/** Compute the edits for one edge statement under a removal plan, or null if it is unaffected. */
function planEdgeStatement(source: string, stmt: EdgeStmt, plan: RemovalPlan): TextEdit[] | null {
  const removedSegments = plan.edges.get(stmt) ?? [];
  const nodeId = plan.nodeId;
  const touchesNode =
    nodeId !== null &&
    stmt.operands.some((op) => (op.type === "noderef" ? op.id.value === nodeId : collectSubgraphMembers(op).has(nodeId)));

  if (!removedSegments.length && !touchesNode) {
    // Still recurse into subgraph operands for nested edge removals.
    const nested: TextEdit[] = [];
    for (const op of stmt.operands) if (op.type === "subgraph") nested.push(...planStatementEdits(source, op.stmts, plan));
    return nested.length ? nested : null;
  }

  const attrText = stmt.attrs.length ? source.slice(stmt.attrs[0].start, stmt.attrs[stmt.attrs.length - 1].end) : "";
  const op = source.slice(stmt.operands[0].end, stmt.operands[1].start).trim() || "->";

  // Operand texts after applying nested plan; null when the operand is dropped.
  const operandTexts: (string | null)[] = stmt.operands.map((operand) => {
    if (operand.type === "noderef") {
      return operand.id.value === nodeId ? null : source.slice(operand.start, operand.end);
    }
    const members = collectSubgraphMembers(operand);
    if (nodeId !== null) members.delete(nodeId);
    if (members.size === 0 && !operand.id) return null;
    return renderSubgraphWithPlan(source, operand, plan);
  });

  // A segment is "cut" when explicitly removed or when an operand dropped.
  const cut = new Set<number>();
  const extraEdges: string[] = [];
  for (const removal of removedSegments) {
    cut.add(removal.segment);
    const tailOp = stmt.operands[removal.segment];
    const headOp = stmt.operands[removal.segment + 1];
    if (tailOp.type === "subgraph" || headOp.type === "subgraph") {
      // Re-add the other expansions of this segment explicitly.
      const removedHere = removedSegments.filter((r) => r.segment === removal.segment);
      if (removedHere[0] !== removal) continue;
      for (const tail of getOperandMembers(tailOp)) {
        for (const head of getOperandMembers(headOp)) {
          if (tail === nodeId || head === nodeId) continue;
          if (removedHere.some((r) => r.tail === tail && r.head === head)) continue;
          const tailText = tailOp.type === "noderef" ? source.slice(tailOp.start, tailOp.end) : quoteId(tail);
          const headText = headOp.type === "noderef" ? source.slice(headOp.start, headOp.end) : quoteId(head);
          extraEdges.push(`${tailText} ${op} ${headText}${attrText ? " " + attrText : ""}`);
        }
      }
    }
  }

  // Build runs of consecutive operands linked by non-cut segments.
  const pieces: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length >= 2) pieces.push(`${run.join(` ${op} `)}${attrText ? " " + attrText : ""}`);
    else if (run.length === 1 && run[0].trimStart().startsWith("subgraph")) pieces.push(run[0]);
    else if (run.length === 1 && run[0].trimStart().startsWith("{") && /[;\[=]|->|--/.test(run[0])) pieces.push(run[0]);
    run = [];
  };
  for (let i = 0; i < operandTexts.length; i++) {
    const text = operandTexts[i];
    if (text === null) {
      flush();
      continue;
    }
    run.push(text);
    if (cut.has(i)) flush();
  }
  flush();
  pieces.push(...extraEdges);

  if (!pieces.length) {
    return [{ ...getStatementDeletionRange(source, stmt), text: "" }];
  }
  const joined = pieces.join("; ") + (stmt.hasSemicolon || pieces.length > 1 ? ";" : "");
  return [{ start: stmt.start, end: stmt.end, text: joined }];
}

/** Compute edits for a list of statements under a removal plan. */
function planStatementEdits(source: string, stmts: Stmt[], plan: RemovalPlan): TextEdit[] {
  const edits: TextEdit[] = [];
  for (const stmt of stmts) {
    if (stmt.type === "node") {
      if (stmt.node.id.value === plan.nodeId) edits.push({ ...getStatementDeletionRange(source, stmt), text: "" });
    } else if (stmt.type === "edge") {
      const result = planEdgeStatement(source, stmt, plan);
      if (result) edits.push(...result);
    } else if (stmt.type === "subgraph") {
      edits.push(...planStatementEdits(source, stmt.stmts, plan));
    }
  }
  return edits;
}

/**
 * Apply a removal plan and re-declare any node that would otherwise vanish
 * as a side effect (e.g. `a -> b` was the only mention of `b`).
 */
function applyRemovalPlan(source: string, model: GraphModel, plan: RemovalPlan): string {
  const edits = planStatementEdits(source, model.ast.stmts, plan);
  let result = applyTextEdits(source, edits);
  const after = buildGraphModel(result);
  const missing = [...model.nodes.keys()].filter((id) => id !== plan.nodeId && !after.nodes.has(id));
  for (const id of missing) result = insertStatement(result, quoteId(id));
  return result;
}

/** Remove a node, its declarations and all incident edges from the DOT source. */
export function removeNodeFromDot(source: string, nodeId: string): string {
  const model = buildGraphModel(source);
  if (!model.nodes.has(nodeId)) return source;
  return applyRemovalPlan(source, model, { nodeId, edges: new Map() });
}

/** Remove one edge (identified by its model key) from the DOT source. */
export function removeEdgeFromDot(source: string, edgeKey: string): string {
  const model = buildGraphModel(source);
  const edge = model.edges.find((e) => e.key === edgeKey);
  if (!edge) return source;
  return applyRemovalPlan(source, model, { nodeId: null, edges: createEdgeRemovals(edge) });
}

function createEdgeRemovals(edge: EdgeInfo): RemovalPlan["edges"] {
  const map: RemovalPlan["edges"] = new Map();
  for (const origin of edge.origins) {
    const list = map.get(origin.stmt) ?? [];
    list.push({ segment: origin.segment, tail: edge.tail, head: edge.head });
    map.set(origin.stmt, list);
  }
  return map;
}

/* ------------------------------------------------------------------------ */
/* Node attributes                                                           */
/* ------------------------------------------------------------------------ */

/** Collect every node statement for a node ID, in source order (including inside subgraphs). */
function collectNodeStatements(stmts: Stmt[], nodeId: string, out: NodeStmt[] = []): NodeStmt[] {
  for (const stmt of stmts) {
    if (stmt.type === "node" && stmt.node.id.value === nodeId) out.push(stmt);
    else if (stmt.type === "subgraph") collectNodeStatements(stmt.stmts, nodeId, out);
    else if (stmt.type === "edge") {
      for (const operand of stmt.operands) if (operand.type === "subgraph") collectNodeStatements(operand.stmts, nodeId, out);
    }
  }
  return out;
}

/**
 * Quote a raw DOT escString for a label: keeps escapes such as `\n` and `\l`
 * as typed and escapes bare double quotes.
 */
export function quoteEscString(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\\") {
      out += i + 1 < raw.length ? ch + raw[++i] : "\\\\";
    } else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else out += ch;
  }
  return `"${out}"`;
}

/** Format an attribute value for DOT text. */
export function formatAttrValue(key: string, value: string, html = false): string {
  if (html) return `<${value}>`;
  if (key === "label" || key === "xlabel" || key === "tooltip") return quoteEscString(value);
  return quoteId(value);
}

/** Remove one attribute item (with its separator) or its whole list when it is the only item. */
function createAttrRemovalEdit(source: string, stmt: NodeStmt, list: AttrList, item: AttrItem): TextEdit {
  if (list.items.length === 1) {
    let start = list.start;
    while (start > stmt.node.end && /[ \t]/.test(source[start - 1])) start--;
    return { start, end: list.end, text: "" };
  }
  const index = list.items.indexOf(item);
  if (index < list.items.length - 1) {
    return { start: item.start, end: list.items[index + 1].start, text: "" };
  }
  return { start: list.items[index - 1].end, end: item.end, text: "" };
}

/** Set (or with `null`, remove) one attribute on a node, editing the DOT text in place. */
function setSingleNodeAttribute(source: string, nodeId: string, key: string, value: string | null, html: boolean): string {
  if (value === null) {
    // Remove every explicit occurrence, one at a time (each edit re-parses).
    let text = source;
    for (let guard = 0; guard < 100; guard++) {
      const stmts = collectNodeStatements(parseDot(text).stmts, nodeId);
      let edit: TextEdit | null = null;
      for (const stmt of stmts) {
        for (const list of stmt.attrs) {
          const item = list.items.find((i) => i.key.value === key);
          if (item) {
            edit = createAttrRemovalEdit(text, stmt, list, item);
            break;
          }
        }
        if (edit) break;
      }
      if (!edit) return text;
      text = applyTextEdits(text, [edit]);
    }
    return text;
  }
  const valueText = formatAttrValue(key, value, html);
  const stmts = collectNodeStatements(parseDot(source).stmts, nodeId);
  // The last explicit occurrence is the effective one: edit it in place.
  for (let s = stmts.length - 1; s >= 0; s--) {
    const stmt = stmts[s];
    for (let l = stmt.attrs.length - 1; l >= 0; l--) {
      const items = stmt.attrs[l].items;
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.key.value !== key) continue;
        if (item.value) return applyTextEdits(source, [{ start: item.value.start, end: item.value.end, text: valueText }]);
        return applyTextEdits(source, [{ start: item.key.end, end: item.key.end, text: `=${valueText}` }]);
      }
    }
  }
  const assignment = `${quoteId(key)}=${valueText}`;
  const stmt = stmts[stmts.length - 1];
  if (!stmt) return insertStatement(source, `${quoteId(nodeId)} [${assignment}]`);
  if (stmt.attrs.length) {
    const list = stmt.attrs[stmt.attrs.length - 1];
    const lastItem = list.items[list.items.length - 1];
    if (!lastItem) return applyTextEdits(source, [{ start: list.start + 1, end: list.end - 1, text: assignment }]);
    return applyTextEdits(source, [{ start: lastItem.end, end: lastItem.end, text: `, ${assignment}` }]);
  }
  return applyTextEdits(source, [{ start: stmt.node.end, end: stmt.node.end, text: ` [${assignment}]` }]);
}

/**
 * Change attributes of a node in the DOT text. `null` removes the attribute.
 * The node's last explicit setting is edited in place; otherwise the attribute
 * is appended to the node's last statement, or a new `id [key=value]`
 * statement is added when the node only appears in edges.
 */
export function setNodeAttributesInDot(
  source: string,
  nodeId: string,
  changes: Record<string, string | null>,
  htmlKeys: string[] = [],
): string {
  let text = source;
  for (const [key, value] of Object.entries(changes)) text = setSingleNodeAttribute(text, nodeId, key, value, htmlKeys.includes(key));
  return text;
}
