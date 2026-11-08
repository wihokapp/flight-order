/*
 * ตัวจำลอง Google Apps Script แบบย่อ — ใช้รัน backend/Code.gs ตัวจริงใน "โหมดทดลอง" (Demo)
 * บนเบราว์เซอร์ และในชุดทดสอบด้วย Node โดยไม่ต้องมีบัญชี Google
 * รองรับเฉพาะ API ที่ Code.gs ใช้เท่านั้น
 */
(function (root) {
  'use strict';

  // ───── SHA-256 / HMAC (sync) ─────
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(bytes) {
    const l = bytes.length, bitLen = l * 8;
    const n = ((l + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(n);
    m.set(bytes); m[l] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(n - 4, bitLen >>> 0); dv.setUint32(n - 8, Math.floor(bitLen / 4294967296));
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    for (let o = 0; o < n; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = W[i - 15], b = W[i - 2];
        const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
    return out;
  }
  function hmac(value, key) {
    let k = Uint8Array.from(key);
    if (k.length > 64) k = sha256(k);
    const pad = new Uint8Array(64); pad.set(k);
    const ipad = pad.map(x => x ^ 0x36), opad = pad.map(x => x ^ 0x5c);
    const inner = new Uint8Array(64 + value.length); inner.set(ipad); inner.set(value, 64);
    const ih = sha256(inner);
    const outer = new Uint8Array(96); outer.set(opad); outer.set(ih, 64);
    return sha256(outer);
  }
  const toU8 = b => Uint8Array.from(b, x => x & 255);
  const toJavaBytes = u8 => Array.from(u8, x => (x > 127 ? x - 256 : x));
  const utf8 = s => toJavaBytes(new TextEncoder().encode(String(s)));
  const fromUtf8 = b => new TextDecoder().decode(toU8(b));
  function b64enc(bytes) {
    const u8 = toU8(bytes);
    if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
    let s = ''; u8.forEach(x => s += String.fromCharCode(x)); return btoa(s);
  }
  function b64dec(str) {
    if (typeof Buffer !== 'undefined') return toJavaBytes(Buffer.from(str, 'base64'));
    const s = atob(str); return toJavaBytes(Uint8Array.from(s, c => c.charCodeAt(0)));
  }
  function uuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return require('crypto').randomUUID();
  }

  // ───── Store (persisted by the host) ─────
  function createEnv(opts) {
    opts = opts || {};
    const store = opts.state || { files: {}, props: {}, cache: {} };
    const persist = opts.onChange || function () {};

    // ── Spreadsheet model ──
    function colToNum(s) { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
    function cell(v) { return v === undefined || v === null ? '' : v; }
    function display(v) { return typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(cell(v)); }

    function Sheet(file, name) { this._f = file; this._n = name; }
    Sheet.prototype = {
      get _d() { return this._f.sheets[this._n]; },
      getName() { return this._n; },
      getLastRow() {
        const d = this._d; let n = d.length;
        while (n > 0 && d[n - 1].every(v => cell(v) === '')) n--;
        return n;
      },
      getLastColumn() { return this._d.reduce((m, r) => Math.max(m, r.length), 0); },
      getRange(r, c, nr, nc) {
        if (typeof r === 'string') {
          const m = r.match(/^([A-Z]+):([A-Z]+)$/);
          if (!m) throw new Error('emulator: unsupported A1 ' + r);
          const c1 = colToNum(m[1]), c2 = colToNum(m[2]);
          return new Range(this, 1, c1, Math.max(this.getLastRow(), 1), c2 - c1 + 1);
        }
        return new Range(this, r, c, nr || 1, nc || 1);
      },
      getDataRange() { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); },
      appendRow(row) { this._d.splice(this.getLastRow(), 0, row.slice()); persist(); return this; },
      deleteRow(r) { this._d.splice(r - 1, 1); persist(); },
      setFrozenRows() { return this; },
    };

    function Range(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
    Range.prototype = {
      getRow() { return this.r; },
      getValues() {
        const d = this.sheet._d, out = [];
        for (let i = 0; i < this.nr; i++) {
          const row = d[this.r - 1 + i] || [], o = [];
          for (let j = 0; j < this.nc; j++) o.push(cell(row[this.c - 1 + j]));
          out.push(o);
        }
        return out;
      },
      getDisplayValues() { return this.getValues().map(r => r.map(display)); },
      getValue() { return this.getValues()[0][0]; },
      setValues(vals) {
        const d = this.sheet._d;
        if (vals.length !== this.nr || vals.some(v => v.length !== this.nc)) throw new Error('emulator: setValues size mismatch');
        for (let i = 0; i < this.nr; i++) {
          const ri = this.r - 1 + i;
          while (d.length <= ri) d.push([]);
          for (let j = 0; j < this.nc; j++) d[ri][this.c - 1 + j] = vals[i][j];
        }
        persist(); return this;
      },
      setValue(v) { return this.setValues([[v]]); },
      clearContent() { return this.setValues(Array.from({ length: this.nr }, () => Array(this.nc).fill(''))); },
      setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; },
      createTextFinder(text) {
        const range = this; const t = String(text).toLowerCase();
        const hits = () => {
          const v = range.getDisplayValues(), out = [];
          v.forEach((row, i) => row.forEach((x, j) => { if (x.toLowerCase() === t) out.push(new Range(range.sheet, range.r + i, range.c + j, 1, 1)); }));
          return out;
        };
        return { matchEntireCell() { return this; }, findNext() { return hits()[0] || null; }, findAll() { return hits(); } };
      },
    };

    function Spreadsheet(id) { this._id = id; }
    Spreadsheet.prototype = {
      get _f() { return store.files[this._id]; },
      getId() { return this._id; },
      getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this._id + '/edit (demo)'; },
      getSheetByName(n) { return this._f.sheets[n] ? new Sheet(this._f, n) : null; },
      insertSheet(n) { this._f.sheets[n] = []; this._f.order.push(n); persist(); return new Sheet(this._f, n); },
      getSheets() { return this._f.order.map(n => new Sheet(this._f, n)); },
      deleteSheet(s) { delete this._f.sheets[s._n]; this._f.order = this._f.order.filter(n => n !== s._n); persist(); },
    };

    const SpreadsheetApp = {
      create(name) {
        const id = 'demo' + uuid().replace(/-/g, '');
        store.files[id] = { name, sheets: { Sheet1: [] }, order: ['Sheet1'] };
        persist(); return new Spreadsheet(id);
      },
      openById(id) {
        if (!store.files[id]) throw new Error('ไม่พบไฟล์ ' + id);
        return new Spreadsheet(id);
      },
    };

    const props = {
      getProperty: k => (k in store.props ? store.props[k] : null),
      setProperty: (k, v) => { store.props[k] = String(v); persist(); return props; },
      deleteProperty: k => { delete store.props[k]; persist(); return props; },
    };
    const PropertiesService = { getScriptProperties: () => props };

    const cache = {
      get(k) { const e = store.cache[k]; if (!e) return null; if (e.exp < Date.now()) { delete store.cache[k]; return null; } return e.v; },
      put(k, v, ttl) { store.cache[k] = { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }; persist(); },
      remove(k) { delete store.cache[k]; persist(); },
    };
    const CacheService = { getScriptCache: () => cache };
    const LockService = { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) };
    const ContentService = {
      MimeType: { JSON: 'application/json' },
      createTextOutput(s) { return { _s: s, setMimeType() { return this; }, getContent() { return this._s; } }; },
    };

    function pad(n, w) { return String(n).padStart(w || 2, '0'); }
    const Utilities = {
      getUuid: uuid,
      formatDate(d, tz, fmt) {
        const offset = tz === 'Asia/Bangkok' ? 7 * 60 : 0;
        const t = new Date(d.getTime() + offset * 60000);
        return fmt.replace('yyyy', t.getUTCFullYear()).replace('MM', pad(t.getUTCMonth() + 1)).replace('dd', pad(t.getUTCDate()))
          .replace('HH', pad(t.getUTCHours())).replace('mm', pad(t.getUTCMinutes())).replace('ss', pad(t.getUTCSeconds()));
      },
      newBlob(data) {
        const bytes = typeof data === 'string' ? utf8(data) : Array.from(data);
        return { getBytes: () => bytes, getDataAsString: () => fromUtf8(bytes) };
      },
      base64Encode: b64enc,
      base64Decode: b64dec,
      computeHmacSha256Signature: (v, k) => toJavaBytes(hmac(toU8(typeof v === 'string' ? utf8(v) : v), toU8(typeof k === 'string' ? utf8(k) : k))),
      computeDigest: (alg, v) => toJavaBytes(sha256(toU8(typeof v === 'string' ? utf8(v) : v))),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      gzip: blob => blob,     // demo: ไม่บีบอัดจริง
      ungzip: blob => blob,
    };

    return { SpreadsheetApp, PropertiesService, CacheService, LockService, ContentService, Utilities, store };
  }

  /** โหลดซอร์ส Code.gs แล้วคืนฟังก์ชันระดับบนสุดที่ต้องใช้ */
  function loadScript(source, env) {
    const names = ['SpreadsheetApp', 'PropertiesService', 'CacheService', 'LockService', 'ContentService', 'Utilities'];
    const exportsList = ['doPost', 'doGet', 'setup', 'hashPassword_', 'db_', 'shortName_', 'nextBatch_', 'SHEETS'];
    const body = source + '\n;return {' + exportsList.map(n => n + ': typeof ' + n + ' !== "undefined" ? ' + n + ' : undefined').join(',') +
      ', _resetDbCache: function(){ DB_CACHE_ = null; } };';
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names, body);
    return fn(...names.map(n => env[n]));
  }

  const api = { createEnv, loadScript, sha256, hmac };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GasEmulator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
