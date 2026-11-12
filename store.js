/* Shared storage for the Glana server: one record per document path (team/…, months/…, config/settings).
 * Same model as the app's store: set / update (deep merge) / delete a document, read all, replace all.
 *
 *   FileStore   one JSON file on this computer (npm start)
 *   RedisStore  Upstash Redis over its REST API (Vercel: Storage → Upstash for Redis). No packages needed.
 *   MemoryStore for tests
 *
 * Each store also keeps one sign-in record (getAuth / putAuth: the hashed website password set in Settings).
 * It lives outside the documents on purpose: /api/db never returns it, backups don't contain it,
 * and "Restore from backup" (replaceAll) leaves it alone. The same is true of the two other things kept beside
 * the documents:
 *   change history   addLog(entry) / getLog(limit)            newest first, the last LOG_MAX entries
 *   server backups   addBackup({id, at, reason, docs}, keep) / listBackups() / getBackup(id) */
"use strict";
const fs = require("fs");
const path = require("path");

/** Paths the app writes. Anything else is refused. */
const PATH_RE = /^(config\/settings|debug\/lastPull|team\/[A-Za-z0-9_-]{1,64}|months\/\d{4}-\d{2}(\/(incidents|jira)\/[A-Za-z0-9_-]{1,64})?)$/;
const validPath = (p) => typeof p === "string" && PATH_RE.test(p);
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const clone = (o) => JSON.parse(JSON.stringify(o));
const LOG_MAX = 2000;
const backupMeta = (b) => ({ id: b.id, at: b.at, reason: b.reason, count: Object.keys(b.docs).length });
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
  let docs = new Map(Object.entries(initial || {})); let rev = 0; let auth = null; let log = []; let backups = [];
  return {
    kind: "memory",
    async getAuth() { return auth ? clone(auth) : null; },
    async putAuth(a) { auth = clone(a); },
    async addLog(e) { log.unshift(clone(e)); log.length = Math.min(log.length, LOG_MAX); },
    async getLog(n) { return clone(log.slice(0, n)); },
    async addBackup(b, keep) { backups.unshift(clone(b)); backups.length = Math.min(backups.length, keep); },
    async listBackups() { return backups.map(backupMeta); },
    async getBackup(id) { const b = backups.find((x) => x.id === id); return b ? clone(b) : null; },
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
  const read = () => { try { const d = JSON.parse(fs.readFileSync(file, "utf8")); return { docs: d.docs || {}, rev: d.rev || 0, auth: d.auth || null, log: Array.isArray(d.log) ? d.log : [] }; } catch (e) { return { docs: {}, rev: 0, auth: null, log: [] }; } };
  const bdir = path.join(path.dirname(file), "backups");
  const bfile = (id) => path.join(bdir, id + ".json");
  const blist = () => { try { return fs.readdirSync(bdir).filter((f) => /^[A-Za-z0-9_-]+\.json$/.test(f)).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(bdir, f), "utf8")); } catch (e) { return null; } }).filter((b) => b && b.id && b.docs).sort((a, b) => (a.at < b.at ? 1 : -1)); } catch (e) { return []; } };
  let state = read();
  let queue = Promise.resolve();
  const save = () => { const tmp = file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(state)); fs.renameSync(tmp, file); };
  const serial = (fn) => (queue = queue.then(fn, fn));
  return {
    kind: "file",
    async getAuth() { return state.auth ? clone(state.auth) : null; },
    putAuth: (a) => serial(() => { state.auth = clone(a); save(); }),
    addLog: (e) => serial(() => { state.log.unshift(clone(e)); state.log.length = Math.min(state.log.length, LOG_MAX); save(); }),
    async getLog(n) { return clone(state.log.slice(0, n)); },
    addBackup: (b, keep) => serial(() => { fs.mkdirSync(bdir, { recursive: true }); fs.writeFileSync(bfile(b.id), JSON.stringify(b)); for (const old of blist().slice(keep)) fs.rmSync(bfile(old.id), { force: true }); }),
    async listBackups() { return blist().map(backupMeta); },
    async getBackup(id) { return /^[A-Za-z0-9_-]+$/.test(id) && fs.existsSync(bfile(id)) ? JSON.parse(fs.readFileSync(bfile(id), "utf8")) : null; },
    async all() { return { docs: clone(state.docs), rev: state.rev }; },
    async rev() { return state.rev; },
    async get(p) { return state.docs[p] ? clone(state.docs[p]) : null; },
    put: (p, d) => serial(() => { state.docs[p] = clone(d); state.rev++; save(); }),
    del: (p) => serial(() => { delete state.docs[p]; state.rev++; save(); }),
    replaceAll: (all) => serial(() => { state = { docs: clone(all), rev: state.rev + 1, auth: state.auth, log: state.log }; save(); }),
  };
}

// ---------- Upstash Redis (REST) ----------
function RedisStore(url, token, prefix, fetchImpl) {
  const base = String(url).replace(/\/+$/, "");
  const H = (prefix || "glanapay") + ":docs", REV = (prefix || "glanapay") + ":rev", AUTH = (prefix || "glanapay") + ":auth", LOG = (prefix || "glanapay") + ":log", BK = (prefix || "glanapay") + ":backups", BKM = (prefix || "glanapay") + ":backupmeta";
  const CHUNK = 350000; // a backup is stored in pieces: Upstash limits the size of one request
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
    async getAuth() { const v = await cmd("GET", AUTH); return v == null ? null : JSON.parse(v); },
    async putAuth(a) { await cmd("SET", AUTH, JSON.stringify(a)); },
    async addLog(e) { await tx([["LPUSH", LOG, JSON.stringify(e)], ["LTRIM", LOG, 0, LOG_MAX - 1]]); },
    async getLog(n) { return ((await cmd("LRANGE", LOG, 0, n - 1)) || []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean); },
    async listBackups() {
      const flat = (await cmd("HGETALL", BKM)) || []; const out = [];
      for (let i = 0; i < flat.length; i += 2) { try { out.push(JSON.parse(flat[i + 1])); } catch (e) {} }
      return out.sort((a, b) => (a.at < b.at ? 1 : -1));
    },
    async addBackup(b, keep) {
      const text = JSON.stringify(b.docs); const parts = Math.max(1, Math.ceil(text.length / CHUNK));
      for (let i = 0; i < parts; i++) await cmd("HSET", BK, b.id + ":" + i, text.slice(i * CHUNK, (i + 1) * CHUNK));
      await cmd("HSET", BKM, b.id, JSON.stringify(Object.assign(backupMeta(b), { parts })));
      for (const old of (await this.listBackups()).slice(keep)) {
        const del = ["HDEL", BK]; for (let i = 0; i < (old.parts || 1); i++) del.push(old.id + ":" + i);
        await tx([del, ["HDEL", BKM, old.id]]);
      }
    },
    async getBackup(id) {
      const raw = await cmd("HGET", BKM, id); if (raw == null) return null;
      const meta = JSON.parse(raw); let text = "";
      for (let i = 0; i < (meta.parts || 1); i++) text += (await cmd("HGET", BK, id + ":" + i)) || "";
      return { id: meta.id, at: meta.at, reason: meta.reason, docs: JSON.parse(text) };
    },
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
