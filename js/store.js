// Flights storage: the server (/api/flights) with a copy of every flight kept in this browser,
// so edits made offline are saved locally and sent when the connection returns.
// Without a server (index.html opened as a file) everything lives in the browser.
(function (root) {
  'use strict';
  const LS = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full / blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const key = (id) => `navlog.flight.${id}`;
  const PENDING = 'navlog.pending';
  const LOCAL_INDEX = 'navlog.local';
  const online = location.protocol !== 'file:';
  let status = 'saved';
  const listeners = new Set();
  const setStatus = (s) => { status = s; listeners.forEach((f) => f(s)); };

  async function api(method, url, body) {
    const res = await fetch('api/' + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    if (res.status === 401) { const e = new Error('sign in'); e.auth = true; throw e; }
    const out = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) { const e = new Error((out && out.error) || res.status); e.status = res.status; e.body = out; throw e; }
    return out;
  }
  const newLocalId = () => 'l' + Math.random().toString(36).slice(2, 10);

  // ------------------------------------------------------------------ public API
  const Store = {
    get status() { return status; },
    onStatus(f) { listeners.add(f); return () => listeners.delete(f); },
    async session() {
      if (!online) return { authed: true };
      try { return await api('GET', 'session'); } catch (e) { return { authed: true, offline: true }; }
    },
    login: (credential) => api('POST', 'login', { credential }),

    async list() {
      const local = (LS.get(LOCAL_INDEX) || []).map((id) => LS.get(key(id))).filter(Boolean);
      if (!online) return local.filter((f) => !f.deleted).map(summaryRow);
      const rows = await api('GET', 'flights');
      // flights created offline (not yet on the server) are listed too
      const ids = new Set(rows.map((r) => r.id));
      for (const f of local) if (!ids.has(f.id) && !f.deleted) rows.push(summaryRow(f));
      for (const r of rows) { const c = LS.get(key(r.id)); if (c && c.dirty) r.summary = c.summary; }
      return rows.sort((a, b) => Math.max(b.updated, b.opened || 0) - Math.max(a.updated, a.opened || 0));
    },

    async create(data, summary) {
      const now = Date.now();
      if (online) {
        try {
          const r = await api('POST', 'flights', { data, summary });
          LS.set(key(r.id), { id: r.id, data, summary, version: r.version, updated: now, created: now });
          return r.id;
        } catch (e) { if (e.auth) throw e; /* offline: fall through */ }
      }
      const id = newLocalId();
      LS.set(key(id), { id, data, summary, version: 0, updated: now, created: now, dirty: true, local: true });
      LS.set(LOCAL_INDEX, [...new Set([...(LS.get(LOCAL_INDEX) || []), id])]);
      queue(id);
      return id;
    },

    async get(id) {
      const cached = LS.get(key(id));
      if (online && !(cached && cached.local)) {
        try {
          const r = await api('GET', `flights/${id}`);
          api('POST', `flights/${id}/opened`).catch(() => {});
          if (cached && cached.dirty && cached.version === r.version) return cached;   // our unsent edits win
          LS.set(key(id), { id, data: r.data, summary: r.summary, version: r.version, updated: r.updated, created: r.created, deleted: r.deleted });
          return LS.get(key(id));
        } catch (e) {
          if (e.auth) throw e;
          if (e.status === 404 && !cached) return null;
        }
      }
      return cached;
    },

    // debounced save of the open flight
    save(id, data, summary) {
      const c = LS.get(key(id)) || { id, version: 0, created: Date.now() };
      LS.set(key(id), { ...c, data, summary, updated: Date.now(), dirty: true });
      queue(id);
    },

    async remove(id) {
      const c = LS.get(key(id));
      if (c) LS.set(key(id), { ...c, deleted: true });
      if (online && !(c && c.local)) await api('DELETE', `flights/${id}`).catch(() => {});
    },
    async restore(id) {
      const c = LS.get(key(id));
      if (c) LS.set(key(id), { ...c, deleted: false });
      if (online && !(c && c.local)) await api('POST', `flights/${id}/restore`).catch(() => {});
    },
    flushNow: () => flush(),
  };

  function summaryRow(f) { return { id: f.id, summary: f.summary || {}, version: f.version, created: f.created, updated: f.updated, opened: f.opened || 0 }; }

  // ------------------------------------------------------------------ sync queue
  let timer = null;
  function queue(id) {
    const p = new Set(LS.get(PENDING) || []); p.add(id); LS.set(PENDING, [...p]);
    setStatus('saving');
    clearTimeout(timer);
    timer = setTimeout(flush, 700);
  }
  let flushing = false;
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      if (!online) { LS.set(PENDING, []); setStatus('saved'); return; }
      let failed = false;
      for (const id of LS.get(PENDING) || []) {
        const c = LS.get(key(id));
        if (!c || !c.dirty) { drop(id); continue; }
        try {
          if (c.local) {   // created offline: create it on the server now
            const r = await api('POST', 'flights', { data: c.data, summary: c.summary, id });
            LS.set(key(r.id), { ...c, id: r.id, version: r.version, local: false, dirty: false });
            LS.set(LOCAL_INDEX, (LS.get(LOCAL_INDEX) || []).filter((x) => x !== id));
          } else {
            const r = await api('PUT', `flights/${id}`, { data: c.data, summary: c.summary, version: c.version });
            const now = LS.get(key(id));
            LS.set(key(id), { ...now, version: r.version, dirty: now.updated !== c.updated });   // more edits may have arrived
          }
          if (!LS.get(key(id)).dirty) drop(id);
        } catch (e) {
          if (e.status === 409 && e.body) {
            // edited on another device meanwhile: keep ours (last writer wins), on top of their version
            LS.set(key(id), { ...LS.get(key(id)), version: e.body.version });
          } else failed = true;
        }
      }
      const left = (LS.get(PENDING) || []).length;
      setStatus(left ? (failed ? 'offline' : 'saving') : 'saved');
      if (left) { clearTimeout(timer); timer = setTimeout(flush, failed ? 5000 : 300); }
    } finally { flushing = false; }
  }
  function drop(id) { LS.set(PENDING, (LS.get(PENDING) || []).filter((x) => x !== id)); }
  window.addEventListener('online', () => flush());
  window.addEventListener('beforeunload', () => { if ((LS.get(PENDING) || []).length) flush(); });
  if ((LS.get(PENDING) || []).length) setTimeout(flush, 500);

  root.Store = Store;
})(window);
