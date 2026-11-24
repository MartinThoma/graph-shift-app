/**
 * AST for the DOT language with source offsets.
 *
 * Every node records `start`/`end` offsets into the source text so that
 * write-back operations can edit the original text surgically instead of
 * re-serializing the whole document (which would lose comments and formatting).
 */

export interface Span {
  /** Offset of the first character. */
  start: number;
  /** Offset one past the last character. */
  end: number;
}

export interface IdToken extends Span {
  /** Unescaped value (quotes removed, `\"` resolved, `+` concatenation applied). */
  value: string;
  kind: "plain" | "numeral" | "quoted" | "html";
}

export interface AttrItem extends Span {
  key: IdToken;
  value: IdToken | null;
}

export interface AttrList extends Span {
  items: AttrItem[];
}

export interface NodeRef extends Span {
  type: "noderef";
  id: IdToken;
  port: IdToken | null;
  compass: IdToken | null;
}

export interface NodeStmt extends Span {
  type: "node";
  node: NodeRef;
  attrs: AttrList[];
  /** End offset of the statement content, excluding a trailing `;`. */
  contentEnd: number;
  hasSemicolon: boolean;
}

export interface EdgeStmt extends Span {
  type: "edge";
  /** Operands of the chain `a -> b -> {c d}`. */
  operands: (NodeRef | SubgraphStmt)[];
  attrs: AttrList[];
  contentEnd: number;
  hasSemicolon: boolean;
}

export interface AttrStmt extends Span {
  type: "attr";
  target: "graph" | "node" | "edge";
  attrs: AttrList[];
  contentEnd: number;
  hasSemicolon: boolean;
}

export interface AssignStmt extends Span {
  type: "assign";
  key: IdToken;
  value: IdToken;
  contentEnd: number;
  hasSemicolon: boolean;
}

export interface SubgraphStmt extends Span {
  type: "subgraph";
  id: IdToken | null;
  stmts: Stmt[];
  /** Offset just after `{`. */
  bodyStart: number;
  /** Offset of the closing `}`. */
  bodyEnd: number;
  contentEnd: number;
  hasSemicolon: boolean;
}

export type Stmt = NodeStmt | EdgeStmt | AttrStmt | AssignStmt | SubgraphStmt;

export interface GraphAst extends Span {
  strict: boolean;
  directed: boolean;
  id: IdToken | null;
  stmts: Stmt[];
  bodyStart: number;
  bodyEnd: number;
}
