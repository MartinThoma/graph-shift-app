import type { AttrList, EdgeStmt, GraphAst, NodeRef, Stmt, SubgraphStmt } from "./ast";
import { parseDot } from "./parser";

export type AttrMap = Record<string, string>;

export interface NodeInfo {
  id: string;
  attrs: AttrMap;
  /** Attribute keys whose value is an HTML string (`<...>`). */
  htmlKeys: string[];
  /** Order of first appearance. */
  order: number;
  /** Innermost cluster containing the node, or null. */
  cluster: string | null;
}

/** Where an edge came from in the source text. */
export interface EdgeOrigin {
  stmt: EdgeStmt;
  /** Index i of the chain segment operands[i] -> operands[i + 1]. */
  segment: number;
}

export interface EdgeInfo {
  /** Stable key: tail, head and occurrence index among edges with the same tail and head. */
  key: string;
  tail: string;
  head: string;
  tailPort: string | null;
  headPort: string | null;
  attrs: AttrMap;
  htmlKeys: string[];
  origins: EdgeOrigin[];
}

export interface ClusterInfo {
  id: string;
  attrs: AttrMap;
  htmlKeys: string[];
  parent: string | null;
  /** All nodes inside the cluster, including nested clusters. */
  nodeIds: string[];
  /** Direct child clusters. */
  children: string[];
  depth: number;
}

export interface GraphModel {
  directed: boolean;
  strict: boolean;
  name: string;
  graphAttrs: AttrMap;
  graphHtmlKeys: string[];
  nodes: Map<string, NodeInfo>;
  edges: EdgeInfo[];
  clusters: Map<string, ClusterInfo>;
  ast: GraphAst;
}

interface Scope {
  node: AttrMap;
  nodeHtml: Set<string>;
  edge: AttrMap;
  edgeHtml: Set<string>;
  cluster: string | null;
  /** Nodes mentioned anywhere in this subgraph (for edge operands). */
  members: Set<string>;
}

const EDGE_KEY_SEPARATOR = "\u001f";

/** Build the stable edge key from tail, head and occurrence index. */
export function createEdgeKey(tail: string, head: string, occurrence: number): string {
  return `${tail}${EDGE_KEY_SEPARATOR}${head}${EDGE_KEY_SEPARATOR}${occurrence}`;
}

/** Check whether a subgraph name designates a cluster. */
export function checkClusterName(name: string | null | undefined): boolean {
  return !!name && name.toLowerCase().startsWith("cluster");
}

function applyAttrLists(
  lists: AttrList[],
  target: AttrMap,
  html: Set<string> | null,
): void {
  for (const list of lists) {
    for (const item of list.items) {
      const key = item.key.value;
      const value = item.value ? item.value.value : "true";
      target[key] = value;
      if (html) {
        if (item.value?.kind === "html") html.add(key);
        else html.delete(key);
      }
    }
  }
}

/** Build the semantic graph model from DOT source. Throws DotSyntaxError. */
export function buildGraphModel(source: string): GraphModel {
  return buildGraphModelFromAst(parseDot(source));
}

/** Build the semantic graph model from a parsed AST. */
export function buildGraphModelFromAst(ast: GraphAst): GraphModel {
  const nodes = new Map<string, NodeInfo>();
  const nodeHtml = new Map<string, Set<string>>();
  const clusters = new Map<string, ClusterInfo>();
  const clusterHtml = new Map<string, Set<string>>();
  const graphAttrs: AttrMap = {};
  const graphHtml = new Set<string>();
  const rawEdges: {
    tail: string;
    head: string;
    tailPort: string | null;
    headPort: string | null;
    attrs: AttrMap;
    html: Set<string>;
    origin: EdgeOrigin;
  }[] = [];
  let order = 0;

  const touchNode = (id: string, scope: Scope[]): NodeInfo => {
    let info = nodes.get(id);
    const current = scope[scope.length - 1];
    if (!info) {
      info = {
        id,
        attrs: { ...current.node },
        htmlKeys: [],
        order: order++,
        cluster: current.cluster,
      };
      nodes.set(id, info);
      nodeHtml.set(id, new Set(current.nodeHtml));
    } else if (current.cluster && info.cluster === null) {
      info.cluster = current.cluster;
    } else if (current.cluster && info.cluster !== current.cluster) {
      // Prefer the deeper cluster (a node mentioned again in a nested cluster).
      const existing = clusters.get(info.cluster!);
      const candidate = clusters.get(current.cluster);
      if (existing && candidate && candidate.depth > existing.depth) info.cluster = current.cluster;
    }
    for (const s of scope) s.members.add(id);
    return info;
  };

  const processStmts = (stmts: Stmt[], scope: Scope[]): void => {
    for (const stmt of stmts) processStmt(stmt, scope);
  };

  const processSubgraph = (sub: SubgraphStmt, scope: Scope[]): Set<string> => {
    const parent = scope[scope.length - 1];
    const name = sub.id?.value ?? null;
    let clusterId = parent.cluster;
    if (checkClusterName(name)) {
      clusterId = name!;
      if (!clusters.has(clusterId)) {
        const parentCluster = parent.cluster ? clusters.get(parent.cluster)! : null;
        clusters.set(clusterId, {
          id: clusterId,
          attrs: {},
          htmlKeys: [],
          parent: parent.cluster,
          nodeIds: [],
          children: [],
          depth: parentCluster ? parentCluster.depth + 1 : 0,
        });
        clusterHtml.set(clusterId, new Set());
        if (parentCluster) parentCluster.children.push(clusterId);
      }
    }
    const child: Scope = {
      node: { ...parent.node },
      nodeHtml: new Set(parent.nodeHtml),
      edge: { ...parent.edge },
      edgeHtml: new Set(parent.edgeHtml),
      cluster: clusterId,
      members: new Set(),
    };
    const isNewCluster = checkClusterName(name);
    const innerScope = [...scope, child];
    for (const stmt of sub.stmts) {
      if (isNewCluster && (stmt.type === "assign" || (stmt.type === "attr" && stmt.target === "graph"))) {
        const cluster = clusters.get(clusterId!)!;
        const html = clusterHtml.get(clusterId!)!;
        if (stmt.type === "assign") {
          cluster.attrs[stmt.key.value] = stmt.value.value;
          if (stmt.value.kind === "html") html.add(stmt.key.value);
        } else {
          applyAttrLists(stmt.attrs, cluster.attrs, html);
        }
        continue;
      }
      processStmt(stmt, innerScope);
    }
    return child.members;
  };

  const getOperandMembers = (
    operand: NodeRef | SubgraphStmt,
    scope: Scope[],
  ): { id: string; port: string | null }[] => {
    if (operand.type === "noderef") {
      touchNode(operand.id.value, scope);
      return [{ id: operand.id.value, port: formatPort(operand) }];
    }
    const members = processSubgraph(operand, scope);
    for (const id of members) for (const s of scope) s.members.add(id);
    return [...members].map((id) => ({ id, port: null }));
  };

  const processEdge = (stmt: EdgeStmt, scope: Scope[]): void => {
    const current = scope[scope.length - 1];
    const explicit: AttrMap = {};
    const explicitHtml = new Set<string>();
    applyAttrLists(stmt.attrs, explicit, explicitHtml);
    const operandMembers = stmt.operands.map((operand) => getOperandMembers(operand, scope));
    for (let i = 0; i < operandMembers.length - 1; i++) {
      for (const tail of operandMembers[i]) {
        for (const head of operandMembers[i + 1]) {
          const html = new Set(current.edgeHtml);
          for (const key of Object.keys(explicit)) {
            if (explicitHtml.has(key)) html.add(key);
            else html.delete(key);
          }
          rawEdges.push({
            tail: tail.id,
            head: head.id,
            tailPort: tail.port ?? (explicit.tailport || null),
            headPort: head.port ?? (explicit.headport || null),
            attrs: { ...current.edge, ...explicit },
            html,
            origin: { stmt, segment: i },
          });
        }
      }
    }
  };

  function processStmt(stmt: Stmt, scope: Scope[]): void {
    const current = scope[scope.length - 1];
    switch (stmt.type) {
      case "node": {
        const info = touchNode(stmt.node.id.value, scope);
        const html = nodeHtml.get(info.id)!;
        applyAttrLists(stmt.attrs, info.attrs, html);
        break;
      }
      case "edge":
        processEdge(stmt, scope);
        break;
      case "attr":
        if (stmt.target === "node") applyAttrLists(stmt.attrs, current.node, current.nodeHtml);
        else if (stmt.target === "edge") applyAttrLists(stmt.attrs, current.edge, current.edgeHtml);
        else if (scope.length === 1) applyAttrLists(stmt.attrs, graphAttrs, graphHtml);
        break;
      case "assign":
        if (scope.length === 1) {
          graphAttrs[stmt.key.value] = stmt.value.value;
          if (stmt.value.kind === "html") graphHtml.add(stmt.key.value);
        }
        break;
      case "subgraph":
        processSubgraph(stmt, scope);
        break;
    }
  }

  const root: Scope = {
    node: {},
    nodeHtml: new Set(),
    edge: {},
    edgeHtml: new Set(),
    cluster: null,
    members: new Set(),
  };
  processStmts(ast.stmts, [root]);

  for (const [id, info] of nodes) info.htmlKeys = [...nodeHtml.get(id)!];
  for (const [id, info] of clusters) info.htmlKeys = [...clusterHtml.get(id)!];

  // Cluster membership (including nested clusters).
  for (const node of nodes.values()) {
    let cluster = node.cluster;
    while (cluster) {
      const info = clusters.get(cluster)!;
      info.nodeIds.push(node.id);
      cluster = info.parent;
    }
  }

  // Edge identity and strict merging.
  const edges: EdgeInfo[] = [];
  const occurrences = new Map<string, number>();
  const strictIndex = new Map<string, EdgeInfo>();
  for (const raw of rawEdges) {
    if (ast.strict) {
      const pairKey = ast.directed
        ? `${raw.tail}${EDGE_KEY_SEPARATOR}${raw.head}`
        : [raw.tail, raw.head].sort().join(EDGE_KEY_SEPARATOR);
      const existing = strictIndex.get(pairKey);
      if (existing) {
        Object.assign(existing.attrs, raw.attrs);
        existing.htmlKeys = [...new Set([...existing.htmlKeys, ...raw.html])];
        existing.origins.push(raw.origin);
        continue;
      }
    }
    const pair = `${raw.tail}${EDGE_KEY_SEPARATOR}${raw.head}`;
    const occurrence = occurrences.get(pair) ?? 0;
    occurrences.set(pair, occurrence + 1);
    const edge: EdgeInfo = {
      key: createEdgeKey(raw.tail, raw.head, occurrence),
      tail: raw.tail,
      head: raw.head,
      tailPort: raw.tailPort,
      headPort: raw.headPort,
      attrs: raw.attrs,
      htmlKeys: [...raw.html],
      origins: [raw.origin],
    };
    edges.push(edge);
    if (ast.strict) {
      const pairKey = ast.directed
        ? pair
        : [raw.tail, raw.head].sort().join(EDGE_KEY_SEPARATOR);
      strictIndex.set(pairKey, edge);
    }
  }

  return {
    directed: ast.directed,
    strict: ast.strict,
    name: ast.id?.value ?? "",
    graphAttrs,
    graphHtmlKeys: [...graphHtml],
    nodes,
    edges,
    clusters,
    ast,
  };
}

function formatPort(ref: NodeRef): string | null {
  if (!ref.port) return null;
  return ref.compass ? `${ref.port.value}:${ref.compass.value}` : ref.port.value;
}
