/** Minimal DOT syntax highlighting for CodeMirror (stream tokenizer). */
import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StringStream } from "@codemirror/language";
import { tags } from "@lezer/highlight";

interface DotState {
  inBlockComment: boolean;
  inString: boolean;
  htmlDepth: number;
}

const KEYWORDS = /^(strict|graph|digraph|node|edge|subgraph)\b/i;

export const dotLanguage = StreamLanguage.define<DotState>({
  name: "dot",
  startState: () => ({ inBlockComment: false, inString: false, htmlDepth: 0 }),
  token(stream: StringStream, state: DotState): string | null {
    if (state.inBlockComment) {
      if (stream.skipTo("*/")) {
        stream.match("*/");
        state.inBlockComment = false;
      } else stream.skipToEnd();
      return "comment";
    }
    if (state.inString) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === "\\") stream.next();
        else if (ch === '"') {
          state.inString = false;
          break;
        }
      }
      return "string";
    }
    if (state.htmlDepth > 0) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === "<") state.htmlDepth++;
        else if (ch === ">" && --state.htmlDepth === 0) break;
      }
      return "string";
    }
    if (stream.eatSpace()) return null;
    if (stream.sol() && stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.inBlockComment = true;
      return "comment";
    }
    if (stream.peek() === '"') {
      stream.next();
      state.inString = true;
      return "string";
    }
    if (stream.peek() === "<") {
      stream.next();
      state.htmlDepth = 1;
      return "string";
    }
    if (stream.match("->") || stream.match("--")) return "operator";
    if (stream.match(KEYWORDS)) return "keyword";
    if (stream.match(/^-?(\.\d+|\d+(\.\d*)?)/)) return "number";
    if (stream.match(/^[A-Za-z_\u0080-￿][\w\u0080-￿]*/)) {
      return stream.peek() === "=" || /^\s*=/.test(stream.string.slice(stream.pos)) ? "attributeName" : "variableName";
    }
    stream.next();
    return "punctuation";
  },
  languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } },
});

export const dotHighlightStyle = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: "#1c1f23", fontWeight: "600" },
    { tag: tags.comment, color: "#6b7177", fontStyle: "italic" },
    { tag: tags.string, color: "#8a4f0e" },
    { tag: tags.number, color: "#1d5f8a" },
    { tag: tags.operator, color: "#3a3f45", fontWeight: "600" },
    { tag: tags.attributeName, color: "#4b5560" },
    { tag: tags.variableName, color: "#1c1f23" },
    { tag: tags.punctuation, color: "#6b7177" },
  ]),
);
