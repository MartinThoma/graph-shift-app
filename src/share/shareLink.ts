/**
 * Share links: the whole graph (its ID and name, DOT text, layout settings and
 * hand-placed positions) is compressed into the URL fragment `#share=v1.<data>`.
 * Fragments are never sent to a server, so sharing uploads nothing.
 */
import { checkLayoutEngine, type EdgeRoute, type LayoutEngine } from "../layout/initialLayout";
import type { Point } from "../render/shapes";
import type { DocState } from "../state/store";

export const SHARE_PREFIX = "#share=";
const FORMAT = "v1";
/** Longest link we hand out; longer URLs break in chats, mail clients and some browsers. */
export const MAX_SHARE_URL_LENGTH = 8000;
const MAX_DOT_LENGTH = 2_000_000;

/** The compact JSON stored in a link. */
interface SharePayload {
  /** The graph's stable ID, so opening a link twice finds the same graph. */
  id?: string;
  name?: string;
  dot: string;
  engine: LayoutEngine;
  isolated?: false;
  /** Node positions as [x, y], only when nodes were placed by hand. */
  pos?: Record<string, [number, number]>;
  /** Edge routes as [tailX, tailY, headX, headY, x1, y1, x2, y2, ...]. */
  routes?: Record<string, number[]>;
  hand?: string[];
}

export type SharedDocument = Pick<DocState, "dot" | "engine" | "groupIsolated"> &
  Partial<Pick<DocState, "positions" | "routes" | "manualNodes">> & {
    id?: string;
    name?: string;
  };

const MAX_NAME_LENGTH = 120;

/** The shareable parts of a snapshot; positions only count once nodes were placed by hand. */
export function createSharedDocument(doc: DocState, meta?: { id: string; name: string }): SharedDocument {
  return {
    ...(meta ? { id: meta.id, name: meta.name } : {}),
    dot: doc.dot,
    engine: doc.engine,
    groupIsolated: doc.groupIsolated,
    positions: doc.positions,
    routes: doc.routes,
    manualNodes: doc.hasManualChanges ? doc.manualNodes : [],
  };
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function transformBytes(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const output = input.pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

/** Build the compact payload for a document; positions are included only when placed by hand. */
function createPayload(doc: SharedDocument, includePositions: boolean): SharePayload {
  const payload: SharePayload = { dot: doc.dot, engine: doc.engine };
  if (doc.id) payload.id = doc.id;
  if (doc.name) payload.name = doc.name;
  if (doc.groupIsolated === false) payload.isolated = false;
  if (includePositions && doc.positions && doc.manualNodes?.length) {
    payload.pos = Object.fromEntries(Object.entries(doc.positions).map(([id, p]) => [id, [Math.round(p.x), Math.round(p.y)]]));
    payload.hand = doc.manualNodes;
    if (doc.routes && Object.keys(doc.routes).length) {
      payload.routes = Object.fromEntries(
        Object.entries(doc.routes).map(([key, r]) => [
          key,
          [r.tail, r.head, ...r.points].flatMap((p) => [Math.round(p.x), Math.round(p.y)]),
        ]),
      );
    }
  }
  return payload;
}

/** Compress a document into the fragment data (`v1.<base64url>`). */
export async function encodeShareData(doc: SharedDocument, includePositions = true): Promise<string> {
  const json = JSON.stringify(createPayload(doc, includePositions));
  const compressed = await transformBytes(new TextEncoder().encode(json), new CompressionStream("deflate-raw"));
  return `${FORMAT}.${encodeBase64Url(compressed)}`;
}

function checkNumberPair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

/** Decompress and validate fragment data. Throws on anything malformed. */
export async function decodeShareData(data: string): Promise<SharedDocument> {
  const [format, body] = data.split(".", 2);
  if (format !== FORMAT || !body) throw new Error("This share link is not in a format this version understands.");
  const bytes = await transformBytes(decodeBase64Url(body), new DecompressionStream("deflate-raw"));
  if (bytes.length > MAX_DOT_LENGTH * 2) throw new Error("This share link is too large.");
  const raw = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SharePayload>;
  if (!raw || typeof raw.dot !== "string" || raw.dot.length > MAX_DOT_LENGTH) throw new Error("This share link contains no graph.");
  const doc: SharedDocument = {
    dot: raw.dot,
    engine: checkLayoutEngine(raw.engine) ? raw.engine : "hierarchical",
    groupIsolated: raw.isolated === false ? false : true,
  };
  if (typeof raw.id === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(raw.id)) doc.id = raw.id;
  if (typeof raw.name === "string") {
    const name = raw.name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
    if (name) doc.name = name;
  }
  if (raw.pos && typeof raw.pos === "object") {
    const positions: Record<string, Point> = {};
    for (const [id, value] of Object.entries(raw.pos)) if (checkNumberPair(value)) positions[id] = { x: value[0], y: value[1] };
    doc.positions = positions;
    doc.manualNodes = Array.isArray(raw.hand) ? raw.hand.filter((id): id is string => typeof id === "string" && id in positions) : [];
    const routes: Record<string, EdgeRoute> = {};
    if (raw.routes && typeof raw.routes === "object") {
      for (const [key, flat] of Object.entries(raw.routes)) {
        if (!Array.isArray(flat) || flat.length < 4 || flat.length % 2 || !flat.every((n) => typeof n === "number" && Number.isFinite(n))) continue;
        const points: Point[] = [];
        for (let i = 0; i < flat.length; i += 2) points.push({ x: flat[i], y: flat[i + 1] });
        routes[key] = { tail: points[0], head: points[1], points: points.slice(2) };
      }
    }
    doc.routes = routes;
  }
  return doc;
}

/** JSON with object keys sorted, so equal content compares equal whatever the key order. */
function stringifySorted(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

/**
 * Whether two documents carry the same graph as far as a share link can tell:
 * DOT text, layout settings and (rounded) hand-placed positions. ID and name
 * don't count.
 */
export function checkSameSharedContent(a: SharedDocument, b: SharedDocument): boolean {
  const normalize = (doc: SharedDocument): SharePayload => {
    const payload = createPayload({ ...doc, id: undefined, name: undefined }, true);
    if (payload.hand) payload.hand = [...payload.hand].sort();
    return payload;
  };
  return stringifySorted(normalize(a)) === stringifySorted(normalize(b));
}

/** Extract the share data from a location hash, or null. */
export function parseShareHash(hash: string): string | null {
  return hash.startsWith(SHARE_PREFIX) ? hash.slice(SHARE_PREFIX.length) : null;
}

export type ShareLinkResult =
  | { ok: true; url: string; withPositions: boolean; length: number }
  | { ok: false; length: number; limit: number };

/**
 * Build the share link for a document. Falls back to a link without hand-placed
 * positions when the full one is too long, and reports when even that is too long.
 */
export async function createShareLink(doc: SharedDocument, baseUrl: string, limit = MAX_SHARE_URL_LENGTH): Promise<ShareLinkResult> {
  const base = baseUrl.split("#")[0];
  const hasPositions = !!doc.manualNodes?.length;
  const full = `${base}${SHARE_PREFIX}${await encodeShareData(doc, true)}`;
  if (full.length <= limit) return { ok: true, url: full, withPositions: hasPositions, length: full.length };
  if (hasPositions) {
    const lean = `${base}${SHARE_PREFIX}${await encodeShareData(doc, false)}`;
    if (lean.length <= limit) return { ok: true, url: lean, withPositions: false, length: lean.length };
  }
  return { ok: false, length: full.length, limit };
}
