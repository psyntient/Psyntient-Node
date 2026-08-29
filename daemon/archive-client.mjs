// Noetic Archive client — the Node's only path to archive.psyntient.io.
//
// Lives daemon-side, never browser-side: it reads ~/.psyntient/node.key (mode
// 600), and that token must not reach a web context. The Interface reaches the
// same functions through a gateway plugin route.
//
// DESIGN, settled in ARCHIVE_INTEGRATION.md:
//   - Traverse, never mirror. Mirroring would turn the backend's accepted 60s
//     revocation window into forever, and would put a shared corpus inside a
//     Vault defined as the user's own private data.
//   - Every read is Edition-stamped, and whatever an analysis actually used
//     gets pinned into the project. That is what keeps traversal reproducible
//     without copying the corpus: a bibliography, not a photocopy.
//   - Git is the citation namespace for frozen Editions; this client is the
//     access path to the current one. It never clones.
//
// Verified live 2026-08-28 against https://archive.psyntient.io with this
// Node's real node_token: /meta, /archetypes, /archetypes/{id}, /search.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { psyntientHome } from "./psyntient-home.mjs";

const NODE_KEY_PATH = path.join(psyntientHome(), "node.key");
const DEFAULT_BASE_URL = "https://archive.psyntient.io";
const TIMEOUT_MS = 30_000;

/** Thrown for anything the caller can act on: unpaired, revoked, unreachable. */
export class ArchiveError extends Error {
  constructor(message, { status = null, cause = null } = {}) {
    super(message);
    this.name = "ArchiveError";
    this.status = status;
    this.cause = cause;
  }
}

/**
 * The Archive authenticates with the same node_token pairing writes.
 *
 * Deliberately re-read per call rather than cached: `heartbeat()` wipes
 * node.key when psyntient.io reports the Node revoked (AUTH_FLOW.md rule 5),
 * and a cached token would keep working against a Node that has been cut off.
 */
function readNodeToken() {
  let raw;
  try {
    raw = fs.readFileSync(NODE_KEY_PATH, "utf8");
  } catch {
    throw new ArchiveError(
      "This Node is not paired with psyntient.io, so it cannot reach the Archive. Complete pairing first.",
    );
  }
  const token = JSON.parse(raw).node_token;
  if (!token) {
    throw new ArchiveError("node.key exists but has no node_token; re-pair this Node.");
  }
  return token;
}

export function archiveBaseUrl() {
  return process.env.PSYNTIENT_ARCHIVE_URL || DEFAULT_BASE_URL;
}

async function request(pathname, searchParams) {
  const url = new URL(`/api/v1${pathname}`, archiveBaseUrl());
  for (const [k, v] of Object.entries(searchParams ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${readNodeToken()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof ArchiveError) throw err;
    throw new ArchiveError(`Could not reach the Archive at ${archiveBaseUrl()}.`, { cause: err });
  }

  if (res.status === 401 || res.status === 403) {
    // The Archive validates the token against psyntient.io on every call, so
    // this means the pairing or the subscription is no longer good -- not that
    // the request was malformed.
    throw new ArchiveError(
      "The Archive rejected this Node's credentials. Its pairing or subscription may have lapsed.",
      { status: res.status },
    );
  }
  if (!res.ok) {
    throw new ArchiveError(`Archive returned HTTP ${res.status} for ${pathname}.`, {
      status: res.status,
    });
  }
  return res.json();
}

/**
 * Edition manifest + the archetype index: the map, and the orientation call.
 *
 * Cheap and stable enough to cache and put in context. The archetype index IS
 * the map -- archetypes are the Archive's primary semantic objects, there are
 * 25 of them, and they change rarely, while packets are the volume and the
 * churn. Cache the catalogue, fetch the books.
 */
export async function getMap() {
  const [meta, archetypes] = await Promise.all([
    request("/meta"),
    request("/archetypes", { limit: 200 }),
  ]);
  noteEdition(meta.edition_id);
  return {
    edition: {
      editionId: meta.edition_id,
      archetypeCount: meta.archetype_count,
      packetCount: meta.packet_count,
      mappingCount: meta.mapping_count,
      // NOTE: /meta exposes no version, git ref or integrity hash today, so a
      // pin records edition_id alone and cannot yet be resolved back to an
      // exact Git tag. See ARCHIVE_INTEGRATION.md gap 1.
      gitRef: meta.git_commit ?? null,
    },
    archetypes: (archetypes.items ?? []).map((a) => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      description: a.description,
      confidenceTier: a.confidence_tier,
      exemplars: a.n_exemplars,
    })),
  };
}

/** Ranked archetypes and packets for a plain-language query. */
export async function search(query, { limit } = {}) {
  if (!query?.trim()) throw new ArchiveError("search needs a query.");
  const body = await request("/search", { query: query.trim(), limit });
  return {
    archetypes: body.archetypes ?? [],
    packets: body.packets ?? [],
  };
}

/**
 * One full record by id, archetype or packet.
 *
 * Archetype ids look like `NA-0008-anxious-interoceptive-contraction`. The
 * archetype route is tried first and a 404 falls through to packets, so
 * callers never have to know which kind an id is -- which matters because the
 * model is one of those callers.
 */
export async function getRecord(id) {
  if (!id?.trim()) throw new ArchiveError("getRecord needs an id.");
  // Served from the batch a search already pulled, when present.
  const cached = cacheGet(id.trim());
  if (cached) {
    return { kind: "archetype", record: cached, cached: true };
  }
  try {
    return { kind: "archetype", record: await request(`/archetypes/${encodeURIComponent(id)}`) };
  } catch (err) {
    if (!(err instanceof ArchiveError) || err.status !== 404) throw err;
  }
  return { kind: "packet", record: await request(`/packets/${encodeURIComponent(id)}`) };
}

/** Exemplar packets for an archetype. */
export async function getArchetypePackets(archetypeId, { limit, offset } = {}) {
  return request(`/archetypes/${encodeURIComponent(archetypeId)}/packets`, { limit, offset });
}


// --- record cache ---------------------------------------------------------
//
// Shared by search and by the viewer expanding a chip. Search batch-pulls its
// shortlist, so by the time the chips render the records are already here and
// clicking one costs nothing. Without this the viewer re-fetches an archetype
// the Node downloaded seconds earlier.
//
// In-memory and process-local on purpose: this is a latency cache, not
// storage. The Archive is append-only with revocable consent, so a copy that
// outlived the process would be a small mirror -- exactly what
// ARCHIVE_INTEGRATION.md rules out.
const RECORD_CACHE = new Map();
/**
 * Session-length, not minutes.
 *
 * A researcher working one topic keeps meeting the same archetypes, and a
 * short TTL made them re-download records they had just looked at. The natural
 * clear point is gateway start -- this is in-memory, so a restart empties it
 * without any code. A browser refresh deliberately does NOT clear it: the
 * whole point is surviving a refresh mid-session.
 *
 * Still bounded rather than unbounded, for two different reasons:
 *  - Time: the gateway is a LaunchAgent and runs for days, so "no TTL" would
 *    mean "until reboot". The Archive is append-only with revocable consent,
 *    so a record cached indefinitely is a small mirror -- the thing
 *    ARCHIVE_INTEGRATION.md rules out.
 *  - Edition: archetypes get renamed and merged between Editions, so a cached
 *    record from a previous Edition is not merely stale, it can be wrong.
 */
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
/** Edition the cached records came from; a change wipes them. */
let cacheEdition = null;

/**
 * Drop everything when the Edition changes.
 *
 * Correctness, not housekeeping: a renamed or merged archetype held from a
 * previous Edition would be served as current with no indication it had moved.
 */
export function noteEdition(editionId) {
  if (editionId && cacheEdition && editionId !== cacheEdition) {
    RECORD_CACHE.clear();
  }
  if (editionId) cacheEdition = editionId;
}

/** Explicit wipe, for a "refresh from the Archive" control. */
export function clearCache() {
  const size = RECORD_CACHE.size;
  RECORD_CACHE.clear();
  return { cleared: size };
}

function cacheGet(id) {
  const hit = RECORD_CACHE.get(id);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    RECORD_CACHE.delete(id);
    return null;
  }
  return hit.record;
}

function cachePut(records) {
  const at = Date.now();
  for (const record of records) {
    if (record?.id) RECORD_CACHE.set(record.id, { at, record });
  }
}

/** Drops expired entries; called opportunistically rather than on a timer. */
function cacheSweep() {
  const now = Date.now();
  for (const [id, hit] of RECORD_CACHE) {
    if (now - hit.at > CACHE_TTL_MS) RECORD_CACHE.delete(id);
  }
}

export function cacheStats() {
  cacheSweep();
  return { size: RECORD_CACHE.size, ttlMs: CACHE_TTL_MS, edition: cacheEdition };
}

/**
 * Fetch many archetypes in ONE request, serving whatever is already cached.
 *
 * The Archive gained POST /api/v1/archetypes/batch for this. Fetching a
 * shortlist one id at a time was N HTTPS round trips against a shared service
 * -- fine for 3, wasteful at 8, and rude at scale.
 */
export async function batchGetArchetypes(ids) {
  const wanted = [...new Set((ids ?? []).filter(Boolean))];
  const cached = [];
  const missing = [];
  for (const id of wanted) {
    const hit = cacheGet(id);
    if (hit) cached.push(hit);
    else missing.push(id);
  }

  let fetched = [];
  if (missing.length > 0) {
    const url = new URL("/api/v1/archetypes/batch", archiveBaseUrl());
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${readNodeToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids: missing }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      throw new ArchiveError("The Archive rejected this Node's credentials.", {
        status: res.status,
      });
    }
    if (!res.ok) {
      throw new ArchiveError(`Archive returned HTTP ${res.status} for batch fetch.`, {
        status: res.status,
      });
    }
    fetched = await res.json();
    cachePut(fetched);
  }

  // Return in the caller's order: search ranks its shortlist by relevance and
  // cache-hit ordering would otherwise scramble it.
  const byId = new Map([...cached, ...fetched].map((r) => [r.id, r]));
  return wanted.map((id) => byId.get(id)).filter(Boolean);
}

export default {
  getMap,
  search,
  getRecord,
  getArchetypePackets,
  batchGetArchetypes,
  cacheStats,
  clearCache,
  noteEdition,
  archiveBaseUrl,
  ArchiveError,
};

// --- CLI ------------------------------------------------------------------
// Mirrors working-memory.mjs: every function reachable from the shell, so the
// client is testable without a running agent.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const [, , cmd, ...rest] = process.argv;
  const run = async () => {
    switch (cmd) {
      case "map":
        return getMap();
      case "search":
        return search(rest.join(" "));
      case "get":
        return getRecord(rest[0]);
      case "packets":
        return getArchetypePackets(rest[0]);
      default:
        throw new ArchiveError(`Usage: archive-client.mjs map|search <q>|get <id>|packets <archetypeId>`);
    }
  };
  run()
    .then((out) => console.log(JSON.stringify(out, null, 2)))
    .catch((err) => {
      console.error(err instanceof ArchiveError ? err.message : err);
      process.exit(1);
    });
}
