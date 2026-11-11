/* Shared storage for the Glana server: one record per document path (team/…, months/…, config/settings).
 * Same model as the app's store: set / update (deep merge) / delete a document, read all, replace all.
 *
 *   FileStore   one JSON file on this computer (npm start)
 *   RedisStore  Upstash Redis over its REST API (Vercel: Storage → Upstash for Redis). No packages needed.
 *   MemoryStore for tests */
"use strict";
const fs = require("fs");
const path = require("path");

/** Paths the app writes. Anything else is refused. */
const PATH_RE = /^(config\/settings|debug\/lastPull|team\/[A-Za-z0-9_-]{1,64}|months\/\d{4}-\d{2}(\/(incidents|jira)\/[A-Za-z0-9_-]{1,64})?)$/;
const validPath = (p) => typeof p === "string" && PATH_RE.test(p);
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const clone = (o) => JSON.parse(JSON.stringify(o));
/** Deep merge used by "update" (identical to the app's MemDB merge). */
function merge(a, b) {
  const o = Object.assign({}, a);
  for (const k in b) o[k] = isObj(b[k]) && isObj(a && a[k]) ? merge(a[k], b[k]) : clone(b[k]);
  return o;
}

/** Apply one write to a store. Returns { path, data } (data null after delete) or throws { status, code, message }. */
async function applyOp(store, op) {
  if (!op || !validPath(op.path)) throw { status: 400, code: "invalid_argument", message: "Unknown document path." };
  if (op.op === "delete") { await store.del(op.path); return { path: op.path, data: null }; }
  if (!isObj(op.data)) throw { status: 400, code: "invalid_argument", message: "Document data must be an object." };
  if (op.op === "set") { await store.put(op.path, op.data); return { path: op.path, data: op.data }; }
  if (op.op === "update") {
    const cur = await store.get(op.path);
    if (!cur) throw { status: 404, code: "invalid_argument", message: "missing" };
    const next = merge(cur, op.data);
    await store.put(op.path, next);
    return { path: op.path, data: next };
  }
  throw { status: 400, code: "invalid_argument", message: "Unknown operation." };
}
function checkAll(docs) {
  if (!isObj(docs)) return "Backup has no documents.";
  for (const [k, v] of Object.entries(docs)) if (!validPath(k) || !isObj(v)) return `Backup has an unknown document: ${k}`;
  return null;
}

// ---------- in memory (tests) ----------
function MemoryStore(initial) {
  let docs = new Map(Object.entries(initial || {})); let rev = 0;
  return {
    kind: "memory",
    async all() { return { docs: Object.fromEntries([...docs].map(([k, v]) => [k, clone(v)])), rev }; },
    async rev() { return rev; },
    async get(p) { return docs.has(p) ? clone(docs.get(p)) : null; },
    async put(p, d) { docs.set(p, clone(d)); rev++; },
    async del(p) { docs.delete(p); rev++; },
    async replaceAll(all) { docs = new Map(Object.entries(clone(all))); rev++; },
  };
}

// ---------- one JSON file ----------
function FileStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const read = () => { try { const d = JSON.parse(fs.readFileSync(file, "utf8")); return { docs: d.docs || {}, rev: d.rev || 0 }; } catch (e) { return { docs: {}, rev: 0 }; } };
  let state = read();
  let queue = Promise.resolve();
  const save = () => { const tmp = file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(state)); fs.renameSync(tmp, file); };
  const serial = (fn) => (queue = queue.then(fn, fn));
  return {
    kind: "file",
    async all() { return { docs: clone(state.docs), rev: state.rev }; },
    async rev() { return state.rev; },
    async get(p) { return state.docs[p] ? clone(state.docs[p]) : null; },
    put: (p, d) => serial(() => { state.docs[p] = clone(d); state.rev++; save(); }),
    del: (p) => serial(() => { delete state.docs[p]; state.rev++; save(); }),
    replaceAll: (all) => serial(() => { state = { docs: clone(all), rev: state.rev + 1 }; save(); }),
  };
}

// ---------- Upstash Redis (REST) ----------
function RedisStore(url, token, prefix, fetchImpl) {
  const base = String(url).replace(/\/+$/, "");
  const H = (prefix || "glanapay") + ":docs", REV = (prefix || "glanapay") + ":rev";
  const f = fetchImpl || globalThis.fetch;
  async function call(pathPart, body) {
    let r;
    try { r = await f(base + pathPart, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch (e) { throw { status: 503, code: "unavailable", message: "The database didn't answer." }; }
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) throw { status: 503, code: "unavailable", message: "The database refused the request." + (data && data.error ? " " + data.error : "") };
    return data;
  }
  const cmd = async (...args) => { const d = await call("", args); if (d.error) throw { status: 503, code: "unavailable", message: d.error }; return d.result; };
  const tx = async (cmds) => { const d = await call("/multi-exec", cmds); const bad = Array.isArray(d) && d.find((x) => x && x.error); if (bad) throw { status: 503, code: "unavailable", message: bad.error }; return d; };
  return {
    kind: "redis",
    async all() {
      const d = await call("/pipeline", [["HGETALL", H], ["GET", REV]]);
      const flat = (d[0] && d[0].result) || [];
      const docs = {}; for (let i = 0; i < flat.length; i += 2) { try { docs[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) {} }
      return { docs, rev: Number(d[1] && d[1].result) || 0 };
    },
    async rev() { return Number(await cmd("GET", REV)) || 0; },
    async get(p) { const v = await cmd("HGET", H, p); return v == null ? null : JSON.parse(v); },
    async put(p, d) { await tx([["HSET", H, p, JSON.stringify(d)], ["INCR", REV]]); },
    async del(p) { await tx([["HDEL", H, p], ["INCR", REV]]); },
    async replaceAll(all) {
      const set = ["HSET", H]; for (const [k, v] of Object.entries(all)) set.push(k, JSON.stringify(v));
      await tx(set.length > 2 ? [["DEL", H], set, ["INCR", REV]] : [["DEL", H], ["INCR", REV]]);
    },
  };
}

/** Pick the store from the environment: Upstash/Vercel KV variables → Redis; on a normal computer → a file; on Vercel without Redis → none. */
function redisFromEnv(env) {
  let url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  let token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // Vercel lets you pick a prefix when connecting Upstash (e.g. STORAGE_REST_API_URL): accept any.
    for (const k of Object.keys(env).sort()) {
      const m = k.match(/^(.+)_REST_API_URL$/);
      if (m && env[k] && env[m[1] + "_REST_API_TOKEN"]) { url = env[k]; token = env[m[1] + "_REST_API_TOKEN"]; break; }
    }
  }
  return { url, token };
}
function storeFromEnv(env, root) {
  const { url, token } = redisFromEnv(env);
  if (url && token) return RedisStore(url, token, env.DB_PREFIX);
  if (env.VERCEL) return null; // Vercel's disk is read-only and not shared: connect Upstash Redis instead
  return FileStore(env.DATA_FILE || path.join(root, "data", "db.json"));
}

module.exports = { MemoryStore, FileStore, RedisStore, storeFromEnv, applyOp, checkAll, validPath, merge };
