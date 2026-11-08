/* API client: เรียก Apps Script จริง หรือ backend จำลองในโหมดทดลอง */
(function () {
  'use strict';
  const cfg = window.APP_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const DEMO = !cfg.API_URL || params.get('demo') === '1';
  const TOKEN_KEY = DEMO ? 'fo602_demo_token' : 'fo602_token';
  const TIMEOUT_MS = 60000;   // ไม่ให้หมุนค้างไม่มีกำหนด (Apps Script ทำงานได้สูงสุด 6 นาที)

  class ApiError extends Error {
    constructor(code, message, extra) { super(message); this.code = code; this.extra = extra; }
  }

  let demoPromise = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('โหลด ' + src + ' ไม่ได้'));
      document.head.appendChild(s);
    });
  }
  function demoBackend() {
    if (!demoPromise) {
      demoPromise = (async () => {
        await loadScript('js/demo/gas-emulator.js');
        await loadScript('js/demo/demo-backend.js');
        const src = await (await fetch('backend/Code.gs', { cache: 'no-cache' })).text();
        return window.DemoBackend.createDemoBackend(src);
      })();
    }
    return demoPromise;
  }

  async function call(action, params) {
    const body = Object.assign({ action, token: API.token }, params || {});
    let res;
    if (DEMO) {
      const be = await demoBackend();
      // จำลองเวลารอเครือข่าย (ทดสอบเน็ตช้าได้ด้วย localStorage fo602_demo_latency = มิลลิวินาที)
      await new Promise(r => setTimeout(r, Number(localStorage.getItem('fo602_demo_latency')) || 120));
      res = be.call(body);
    } else {
      let r, text;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
      try {
        r = await fetch(cfg.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },  // simple request → ไม่มี CORS preflight
          body: JSON.stringify(body),
          redirect: 'follow',
          signal: ctrl ? ctrl.signal : undefined,
        });
        text = await r.text();
      } catch (e) {
        if (e && e.name === 'AbortError') throw new ApiError('TIMEOUT', 'เซิร์ฟเวอร์ไม่ตอบภายใน ' + (TIMEOUT_MS / 1000) + ' วินาที');
        throw new ApiError('NETWORK', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
      } finally { if (timer) clearTimeout(timer); }
      try { res = JSON.parse(text); }
      catch (e) { throw new ApiError('SERVER', 'เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ (ตรวจการ Deploy ว่าตั้ง Who has access = Anyone)'); }
    }
    if (!res.ok) {
      if (res.code === 'AUTH') API.setToken('');
      throw new ApiError(res.code, res.error, res.extra);
    }
    return res.data;
  }

  const API = {
    DEMO,
    ApiError,
    token: localStorage.getItem(TOKEN_KEY) || '',
    setToken(t) { this.token = t || ''; if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); },
    call,
    demoUsers: async () => (await demoBackend()).users,
    demoReset: async () => { (await demoBackend()).reset(); },
    demoSimulateLine: async (text, userId) => (await demoBackend()).simulateLine(text, userId),
    demoLineLog: async () => (await demoBackend()).lineLog(),
  };
  window.API = API;
})();
