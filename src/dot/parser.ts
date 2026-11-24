import type {
  AttrItem,
  AttrList,
  EdgeStmt,
  GraphAst,
  IdToken,
  NodeRef,
  Stmt,
  SubgraphStmt,
} from "./ast";

/** A DOT syntax error with a human-readable position. */
export class DotSyntaxError extends Error {
  readonly offset: number;
  readonly line: number;
  readonly column: number;

  constructor(message: string, source: string, offset: number) {
    const { line, column } = getLineColumn(source, offset);
    super(message);
    this.name = "DotSyntaxError";
    this.offset = offset;
    this.line = line;
    this.column = column;
  }
}

/** Convert an offset to a 1-based line and column. */
export function getLineColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  const limit = Math.min(offset, source.length);
  for (let i = 0; i < limit; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: offset - lastNewline };
}

type TokenKind =
  | "id"
  | "{"
  | "}"
  | "["
  | "]"
  | ";"
  | ","
  | "="
  | ":"
  | "->"
  | "--"
  | "eof";

interface Token {
  kind: TokenKind;
  start: number;
  end: number;
  /** Set when kind === "id". */
  id?: IdToken;
  /** Lower-cased keyword when the id is an unquoted keyword. */
  keyword?: "strict" | "graph" | "digraph" | "node" | "edge" | "subgraph";
}

const KEYWORDS = new Set(["strict", "graph", "digraph", "node", "edge", "subgraph"]);

function checkIdentStart(code: number): boolean {
  return (
    (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code >= 128
  );
}

function checkIdentPart(code: number): boolean {
  return checkIdentStart(code) || (code >= 48 && code <= 57);
}

function checkDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** Split DOT source into tokens, skipping whitespace and comments. */
export function tokenizeDot(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;
  let atLineStart = true;

  while (i < n) {
    const c = source.charCodeAt(i);
    // Whitespace
    if (c === 32 || c === 9 || c === 13 || c === 10 || c === 12 || c === 11) {
      if (c === 10) atLineStart = true;
      i++;
      continue;
    }
    // '#' preprocessor-style line comments (only at line start)
    if (c === 35 && atLineStart) {
      while (i < n && source.charCodeAt(i) !== 10) i++;
      continue;
    }
    atLineStart = false;
    // Comments
    if (c === 47 && source.charCodeAt(i + 1) === 47) {
      while (i < n && source.charCodeAt(i) !== 10) i++;
      continue;
    }
    if (c === 47 && source.charCodeAt(i + 1) === 42) {
      const close = source.indexOf("*/", i + 2);
      if (close < 0) throw new DotSyntaxError("Unterminated comment", source, i);
      i = close + 2;
      continue;
    }
    const start = i;
    // Punctuation
    if (c === 45 && (source[i + 1] === ">" || source[i + 1] === "-")) {
      tokens.push({ kind: source[i + 1] === ">" ? "->" : "--", start, end: i + 2 });
      i += 2;
      continue;
    }
    const ch = source[i];
    if ("{}[];,=:".includes(ch)) {
      tokens.push({ kind: ch as TokenKind, start, end: i + 1 });
      i++;
      continue;
    }
    // Quoted string (with optional '+' concatenation)
    if (c === 34) {
      let value = "";
      let end = i;
      for (;;) {
        const { text, end: stringEnd } = readQuoted(source, end);
        value += text;
        end = stringEnd;
        // Look ahead for '+' "..."
        let j = end;
        j = skipTrivia(source, j);
        if (source[j] === "+") {
          const k = skipTrivia(source, j + 1);
          if (source[k] === '"') {
            end = k;
            continue;
          }
          throw new DotSyntaxError("Expected a quoted string after '+'", source, k);
        }
        break;
      }
      tokens.push({ kind: "id", start, end, id: { value, kind: "quoted", start, end } });
      i = end;
      continue;
    }
    // HTML string
    if (c === 60) {
      let depth = 0;
      let j = i;
      for (; j < n; j++) {
        const cj = source[j];
        if (cj === "<") depth++;
        else if (cj === ">") {
          depth--;
          if (depth === 0) break;
        }
      }
      if (j >= n) throw new DotSyntaxError("Unterminated HTML string", source, i);
      const end = j + 1;
      tokens.push({
        kind: "id",
        start,
        end,
        id: { value: source.slice(i + 1, j), kind: "html", start, end },
      });
      i = end;
      continue;
    }
    // Numeral
    if (checkDigit(c) || (c === 46 && checkDigit(source.charCodeAt(i + 1))) || (c === 45 && (checkDigit(source.charCodeAt(i + 1)) || source[i + 1] === "."))) {
      let j = i;
      if (source[j] === "-") j++;
      while (j < n && checkDigit(source.charCodeAt(j))) j++;
      if (source[j] === ".") {
        j++;
        while (j < n && checkDigit(source.charCodeAt(j))) j++;
      }
      if (j < n && checkIdentStart(source.charCodeAt(j))) {
        throw new DotSyntaxError(
          `Invalid identifier '${source.slice(i, j + 1)}' (an ID cannot start with a digit; quote it)`,
          source,
          i,
        );
      }
      tokens.push({
        kind: "id",
        start,
        end: j,
        id: { value: source.slice(i, j), kind: "numeral", start, end: j },
      });
      i = j;
      continue;
    }
    // Identifier / keyword
    if (checkIdentStart(c)) {
      let j = i + 1;
      while (j < n && checkIdentPart(source.charCodeAt(j))) j++;
      const value = source.slice(i, j);
      const lower = value.toLowerCase();
      const token: Token = {
        kind: "id",
        start,
        end: j,
        id: { value, kind: "plain", start, end: j },
      };
      if (KEYWORDS.has(lower)) token.keyword = lower as Token["keyword"];
      tokens.push(token);
      i = j;
      continue;
    }
    throw new DotSyntaxError(`Unexpected character '${ch}'`, source, i);
  }
  tokens.push({ kind: "eof", start: n, end: n });
  return tokens;
}

function skipTrivia(source: string, i: number): number {
  const n = source.length;
  while (i < n) {
    const c = source.charCodeAt(i);
    if (c === 32 || c === 9 || c === 13 || c === 10) {
      i++;
    } else if (c === 47 && source.charCodeAt(i + 1) === 47) {
      while (i < n && source.charCodeAt(i) !== 10) i++;
    } else if (c === 47 && source.charCodeAt(i + 1) === 42) {
      const close = source.indexOf("*/", i + 2);
      if (close < 0) return n;
      i = close + 2;
    } else break;
  }
  return i;
}

function readQuoted(source: string, start: number): { text: string; end: number } {
  let text = "";
  let i = start + 1;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch === "\\") {
      const next = source[i + 1];
      if (next === '"') {
        text += '"';
        i += 2;
        continue;
      }
      if (next === "\n") {
        i += 2;
        continue;
      }
      if (next === "\r" && source[i + 2] === "\n") {
        i += 3;
        continue;
      }
      text += ch;
      i++;
      continue;
    }
    if (ch === '"') return { text, end: i + 1 };
    text += ch;
    i++;
  }
  throw new DotSyntaxError("Unterminated string", source, start);
}

/** Parse DOT source into an AST. Throws DotSyntaxError on malformed input. */
export function parseDot(source: string): GraphAst {
  const tokens = tokenizeDot(source);
  let pos = 0;

  const peek = (offset = 0): Token => tokens[Math.min(pos + offset, tokens.length - 1)];
  const next = (): Token => tokens[pos++];

  const fail = (message: string, token: Token = peek()): never => {
    const found =
      token.kind === "eof"
        ? "end of input"
        : `'${source.slice(token.start, Math.min(token.end, token.start + 24))}'`;
    throw new DotSyntaxError(`${message}, found ${found}`, source, token.start);
  };

  const expect = (kind: TokenKind, what?: string): Token => {
    const t = peek();
    if (t.kind !== kind) fail(`Expected ${what ?? `'${kind}'`}`);
    return next();
  };

  const checkId = (t: Token): boolean => t.kind === "id" && !t.keyword;

  const readId = (what = "an identifier"): IdToken => {
    const t = peek();
    if (!checkId(t)) fail(`Expected ${what}`);
    next();
    return t.id!;
  };

  // graph : [ strict ] (graph | digraph) [ ID ] '{' stmt_list '}'
  const first = peek();
  if (first.kind === "eof") throw new DotSyntaxError("The document is empty; start with 'digraph {' or 'graph {'", source, 0);
  const graphStart = first.start;
  let strict = false;
  if (first.keyword === "strict") {
    strict = true;
    next();
  }
  const kindToken = peek();
  if (kindToken.keyword !== "graph" && kindToken.keyword !== "digraph") {
    fail("Expected 'graph' or 'digraph'");
  }
  next();
  const directed = kindToken.keyword === "digraph";
  let graphId: IdToken | null = null;
  if (checkId(peek())) graphId = readId();
  const open = expect("{", "'{' to open the graph body");

  const parseAttrLists = (): AttrList[] => {
    const lists: AttrList[] = [];
    while (peek().kind === "[") {
      const open = next();
      const items: AttrItem[] = [];
      while (peek().kind !== "]") {
        const key = readId("an attribute name or ']'");
        let value: IdToken | null = null;
        let end = key.end;
        if (peek().kind === "=") {
          next();
          value = readId("an attribute value");
          end = value.end;
        }
        items.push({ key, value, start: key.start, end });
        if (peek().kind === ";" || peek().kind === ",") next();
      }
      const close = next();
      lists.push({ items, start: open.start, end: close.end });
    }
    return lists;
  };

  const parseNodeRef = (): NodeRef => {
    const id = readId("a node ID");
    let port: IdToken | null = null;
    let compass: IdToken | null = null;
    let end = id.end;
    if (peek().kind === ":") {
      next();
      port = readId("a port name");
      end = port.end;
      if (peek().kind === ":") {
        next();
        compass = readId("a compass point");
        end = compass.end;
      }
    }
    return { type: "noderef", id, port, compass, start: id.start, end };
  };

  const parseSubgraph = (): SubgraphStmt => {
    const startToken = peek();
    let id: IdToken | null = null;
    if (startToken.keyword === "subgraph") {
      next();
      if (checkId(peek())) id = readId();
    }
    const open = expect("{", "'{' to open the subgraph");
    const stmts = parseStmtList();
    const close = expect("}", "'}' to close the subgraph");
    return {
      type: "subgraph",
      id,
      stmts,
      start: startToken.start,
      end: close.end,
      bodyStart: open.end,
      bodyEnd: close.start,
      contentEnd: close.end,
      hasSemicolon: false,
    };
  };

  const finishStmt = <T extends Stmt>(stmt: T): T => {
    stmt.contentEnd = stmt.end;
    if (peek().kind === ";") {
      const semi = next();
      stmt.end = semi.end;
      stmt.hasSemicolon = true;
    } else {
      stmt.hasSemicolon = false;
    }
    return stmt;
  };

  const parseEdgeRest = (firstOperand: NodeRef | SubgraphStmt): EdgeStmt => {
    const operands: (NodeRef | SubgraphStmt)[] = [firstOperand];
    while (peek().kind === "->" || peek().kind === "--") {
      const op = next();
      if (op.kind === "->" && !directed) {
        throw new DotSyntaxError("'->' is only allowed in a digraph; use '--' in a graph", source, op.start);
      }
      if (op.kind === "--" && directed) {
        throw new DotSyntaxError("'--' is only allowed in a graph; use '->' in a digraph", source, op.start);
      }
      const t = peek();
      if (t.keyword === "subgraph" || t.kind === "{") operands.push(parseSubgraph());
      else operands.push(parseNodeRef());
    }
    const attrs = parseAttrLists();
    const end = attrs.length ? attrs[attrs.length - 1].end : operands[operands.length - 1].end;
    return {
      type: "edge",
      operands,
      attrs,
      start: firstOperand.start,
      end,
      contentEnd: end,
      hasSemicolon: false,
    };
  };

  const parseStmt = (): Stmt => {
    const t = peek();
    if (t.keyword === "graph" || t.keyword === "node" || t.keyword === "edge") {
      next();
      if (peek().kind !== "[") fail(`Expected '[' after '${t.keyword}'`);
      const attrs = parseAttrLists();
      const end = attrs[attrs.length - 1].end;
      return finishStmt({
        type: "attr",
        target: t.keyword,
        attrs,
        start: t.start,
        end,
        contentEnd: end,
        hasSemicolon: false,
      });
    }
    if (t.keyword === "subgraph" || t.kind === "{") {
      const sub = parseSubgraph();
      if (peek().kind === "->" || peek().kind === "--") return finishStmt(parseEdgeRest(sub));
      return finishStmt(sub);
    }
    if (t.keyword) fail(`Unexpected keyword '${t.keyword}'`);
    if (!checkId(t)) fail("Expected a statement");
    // ID '=' ID
    if (peek(1).kind === "=") {
      const key = readId();
      next();
      const value = readId("a value after '='");
      return finishStmt({
        type: "assign",
        key,
        value,
        start: key.start,
        end: value.end,
        contentEnd: value.end,
        hasSemicolon: false,
      });
    }
    const ref = parseNodeRef();
    if (peek().kind === "->" || peek().kind === "--") return finishStmt(parseEdgeRest(ref));
    const attrs = parseAttrLists();
    const end = attrs.length ? attrs[attrs.length - 1].end : ref.end;
    return finishStmt({
      type: "node",
      node: ref,
      attrs,
      start: ref.start,
      end,
      contentEnd: end,
      hasSemicolon: false,
    });
  };

  function parseStmtList(): Stmt[] {
    const stmts: Stmt[] = [];
    while (peek().kind !== "}" && peek().kind !== "eof") {
      if (peek().kind === ";") {
        next();
        continue;
      }
      stmts.push(parseStmt());
    }
    return stmts;
  }

  const stmts = parseStmtList();
  const close = expect("}", "'}' to close the graph");
  if (peek().kind !== "eof") fail("Unexpected content after the closing '}'");

  return {
    strict,
    directed,
    id: graphId,
    stmts,
    start: graphStart,
    end: close.end,
    bodyStart: open.end,
    bodyEnd: close.start,
  };
}
