(() => {
  'use strict';

  // ---------- 保存キー ----------
  const LS = {
    sets: 'wk-sets',
    ex: 'wk-ex',
    settings: 'wk-settings',
    cur: 'wk-current',
  };
  const DEFAULT_EX = [
    'ベンチプレス', 'スクワット', 'デッドリフト', 'ショルダープレス', 'ラットプルダウン',
    'バーベルロウ', 'ダンベルカール', '懸垂', '腕立て', '腹筋', 'レッグプレス', 'サイドレイズ',
  ];

  // ---------- 小物 ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const lsGet = (k, fb) => { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch { return fb; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* noop */ } };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const hhmm = (iso) => { const d = new Date(iso); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const fmtDay = (key) => { const d = new Date(`${key}T00:00:00`); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`; };
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const fmtW = (w) => (w > 0 ? `${w}kg` : '自重');
  const vol = (rows) => rows.reduce((a, s) => a + s.w * s.r, 0);

  let toastTimer;
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
    if (action) $('button', el).onclick = () => { el.classList.remove('show'); action.fn(); };
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2200);
  }

  // ---------- 状態 ----------
  let sets = lsGet(LS.sets, []);           // {id, t, ex, w, r, note, upd, dirty?, del?}
  let exercises = lsGet(LS.ex, null);      // [{name, last}]
  let settings = lsGet(LS.settings, {});
  let current = lsGet(LS.cur, null);       // 選択中の種目名
  if (!exercises) {
    exercises = DEFAULT_EX.map((name) => ({ name, last: 0 }));
    lsSet(LS.ex, exercises);
  }
  const live = () => sets.filter((s) => !s.del);
  const saveSets = () => lsSet(LS.sets, sets);
  const saveEx = () => lsSet(LS.ex, exercises);

  // ---------- Supabase(任意) ----------
  const cfg = window.WORKOUT_CONFIG || {};
  const sbAvailable = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const sb = sbAvailable ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  const syncOn = () => Boolean(sb && settings.pass);
  let syncing = false;
  let pushTimer;

  function setSync(state, text) {
    const el = $('#sync');
    el.hidden = !syncOn();
    el.className = `sync ${state || ''}`;
    el.textContent = text || '';
  }

  async function push() {
    if (!syncOn() || syncing) return;
    const dirty = sets.filter((s) => s.dirty);
    if (!dirty.length) { setSync('on', '同期OK'); return; }
    syncing = true;
    setSync('', '送信中…');
    try {
      const rows = dirty.map((s) => ({
        id: s.id, done_at: s.t, exercise: s.ex, weight_kg: s.w, reps: s.r,
        note: s.note || null, updated_at: s.upd, deleted: Boolean(s.del),
      }));
      const { error } = await sb.rpc('wk_upsert', { p_pass: settings.pass, p_rows: rows });
      if (error) throw error;
      const ids = new Set(dirty.map((s) => s.id));
      sets = sets.filter((s) => !(ids.has(s.id) && s.del)).map((s) => (ids.has(s.id) ? { ...s, dirty: false } : s));
      saveSets();
      setSync('on', '同期OK');
    } catch (e) {
      setSync('err', /passcode/i.test(String(e.message || e)) ? '合言葉が違う' : '未同期');
    } finally {
      syncing = false;
    }
  }
  const schedulePush = () => { clearTimeout(pushTimer); pushTimer = setTimeout(push, 800); };

  async function pull() {
    if (!syncOn() || syncing) return;
    syncing = true;
    setSync('', '取得中…');
    try {
      const { data, error } = await sb.rpc('wk_pull', { p_pass: settings.pass });
      if (error) throw error;
      const byId = new Map(sets.map((s) => [s.id, s]));
      const next = new Map(byId);
      for (const r of data || []) {
        const local = byId.get(r.id);
        if (local && local.dirty) continue;
        if (r.deleted) { next.delete(r.id); continue; }
        next.set(r.id, {
          id: r.id, t: r.done_at, ex: r.exercise, w: num(r.weight_kg), r: num(r.reps),
          note: r.note || '', upd: r.updated_at, dirty: false,
        });
      }
      sets = Array.from(next.values()).sort((a, b) => a.t.localeCompare(b.t));
      // 端末側にしかない行(同期を後から始めた分)は送る
      const remote = new Set((data || []).map((r) => r.id));
      sets = sets.map((s) => (remote.has(s.id) ? s : { ...s, dirty: true }));
      saveSets();
      ensureExercisesFromSets();
      syncing = false;
      setSync('on', '同期OK');
      renderAll();
      push();
    } catch (e) {
      syncing = false;
      setSync('err', /passcode/i.test(String(e.message || e)) ? '合言葉が違う' : '未同期');
    }
  }

  function ensureExercisesFromSets() {
    const names = new Set(exercises.map((e) => e.name));
    let changed = false;
    for (const s of live()) {
      if (!names.has(s.ex)) { exercises.push({ name: s.ex, last: Date.parse(s.t) || 0 }); names.add(s.ex); changed = true; }
    }
    if (changed) saveEx();
  }

  // ---------- 記録の操作 ----------
  function addSet(ex, w, r) {
    const now = new Date();
    const row = { id: uuid(), t: now.toISOString(), ex, w, r, note: '', upd: now.toISOString(), dirty: true };
    sets.push(row);
    saveSets();
    touchEx(ex, now.getTime());
    schedulePush();
    return row;
  }
  function removeSet(id) {
    const s = sets.find((x) => x.id === id);
    if (!s) return;
    s.del = true; s.dirty = true; s.upd = new Date().toISOString();
    if (!syncOn()) sets = sets.filter((x) => x.id !== id);
    saveSets();
    schedulePush();
  }
  function restoreSet(id) {
    const s = sets.find((x) => x.id === id);
    if (!s) return;
    s.del = false; s.dirty = true; s.upd = new Date().toISOString();
    saveSets();
    schedulePush();
  }
  function touchEx(name, ts) {
    const e = exercises.find((x) => x.name === name);
    if (e) e.last = ts; else exercises.push({ name, last: ts });
    saveEx();
  }
  const sortedEx = () => exercises.slice().sort((a, b) => (b.last || 0) - (a.last || 0));
  const lastSetOf = (ex) => { const rows = live().filter((s) => s.ex === ex); return rows.length ? rows[rows.length - 1] : null; };
  const todayKey = () => dayKey(new Date());
  const todaySets = () => live().filter((s) => dayKey(new Date(s.t)) === todayKey());

  // 前回(きょう以外で最後にやった日)のサマリ
  function prevSummary(ex) {
    const tk = todayKey();
    const rows = live().filter((s) => s.ex === ex && dayKey(new Date(s.t)) !== tk);
    if (!rows.length) return '';
    const lastDay = dayKey(new Date(rows[rows.length - 1].t));
    const day = rows.filter((s) => dayKey(new Date(s.t)) === lastDay);
    const top = day.reduce((a, s) => (s.w > a.w || (s.w === a.w && s.r > a.r) ? s : a), day[0]);
    return `前回 ${fmtDay(lastDay)} ${fmtW(top.w)}×${top.r} ${day.length}セット`;
  }

  // ---------- 入力UI ----------
  const wIn = $('#w');
  const rIn = $('#r');
  const recBtn = $('#rec');

  function selectEx(name, prefill = true) {
    current = name;
    lsSet(LS.cur, current);
    $('#entry-ex').textContent = name || '種目をえらぶ';
    $('#entry-prev').textContent = name ? prevSummary(name) : '';
    recBtn.disabled = !name;
    if (name && prefill) {
      const last = lastSetOf(name);
      if (last) { wIn.value = last.w; rIn.value = last.r; }
    }
    renderChips();
    renderRecSub();
  }

  function renderChips() {
    const list = sortedEx();
    $('#ex-chips').innerHTML = list.map((e) =>
      `<button type="button" class="chip ${e.name === current ? 'on' : ''}" data-ex="${esc(e.name)}">${esc(e.name)}</button>`).join('')
      + '<button type="button" class="chip add" data-add>＋ 種目</button>';
    const on = $('.chip.on', $('#ex-chips'));
    if (on) on.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }
  $('#ex-chips').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-add')) { addExercisePrompt(); return; }
    selectEx(b.dataset.ex);
  });

  function addExercisePrompt() {
    const name = (prompt('種目名') || '').trim().slice(0, 30);
    if (!name) return;
    if (!exercises.some((e) => e.name === name)) { exercises.push({ name, last: Date.now() }); saveEx(); }
    selectEx(name);
  }

  function renderRecSub() {
    const n = current ? todaySets().filter((s) => s.ex === current).length : 0;
    $('#rec-sub').textContent = current ? `${n + 1}セット目` : '';
  }

  $('#w-stepper').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-w]');
    if (!b) return;
    wIn.value = Math.max(0, Math.round((num(wIn.value) + Number(b.dataset.w)) * 100) / 100);
  });
  $('.stepper.reps').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-r]');
    if (!b) return;
    rIn.value = Math.max(0, Math.round(num(rIn.value) + Number(b.dataset.r)));
  });
  [wIn, rIn].forEach((el) => {
    el.addEventListener('focus', () => el.select());
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { el.blur(); record(); } });
  });

  function record() {
    if (!current) { toast('種目をえらんでね'); return; }
    const w = Math.max(0, num(wIn.value));
    const r = Math.max(0, Math.round(num(rIn.value)));
    if (r <= 0) { toast('回数を入れてね'); return; }
    const row = addSet(current, w, r);
    if (navigator.vibrate) navigator.vibrate(20);
    renderToday();
    renderRecSub();
    startRest();
    toast(`${current} ${fmtW(w)}×${r} 記録した`, { label: '取り消す', fn: () => { removeSet(row.id); renderToday(); renderRecSub(); } });
  }
  recBtn.addEventListener('click', record);

  // ---------- 休憩タイマー(前のセットからの経過) ----------
  let restTimer;
  function startRest() {
    clearInterval(restTimer);
    const tick = () => {
      const t = todaySets();
      if (!t.length) { $('#rest').hidden = true; clearInterval(restTimer); return; }
      const sec = Math.floor((Date.now() - Date.parse(t[t.length - 1].t)) / 1000);
      if (sec > 3600) { $('#rest').hidden = true; clearInterval(restTimer); return; }
      $('#rest').hidden = false;
      $('#rest-t').textContent = `${Math.floor(sec / 60)}:${pad2(sec % 60)}`;
    };
    tick();
    restTimer = setInterval(tick, 1000);
  }

  // ---------- きょうの記録 ----------
  function groupByEx(rows) {
    const map = new Map();
    for (const s of rows) {
      if (!map.has(s.ex)) map.set(s.ex, []);
      map.get(s.ex).push(s);
    }
    return Array.from(map.entries());
  }
  function groupHtml(ex, rows, { canDelete = true, reuse = false } = {}) {
    return `<div class="grp">
      <div class="grp-head"><span>${esc(ex)} <small>${rows.length}セット・${Math.round(vol(rows))}kg</small></span>
        ${reuse ? `<button type="button" data-use="${esc(ex)}">この種目</button>` : ''}</div>
      ${rows.map((s, i) => `<div class="set" data-id="${esc(s.id)}">
        <span class="no">${i + 1}</span>
        <span class="v"><b>${esc(fmtW(s.w))}</b><span>×</span><b>${s.r}</b></span>
        <span class="t">${hhmm(s.t)}</span>
        ${canDelete ? '<button type="button" class="x" aria-label="削除">×</button>' : '<span></span>'}
      </div>`).join('')}
    </div>`;
  }
  function renderToday() {
    const rows = todaySets();
    const el = $('#today-list');
    if (!rows.length) {
      el.innerHTML = '<p class="empty">まだなし。種目をえらんで「セット記録」を押すだけ。</p>';
      $('#today-sum').textContent = '';
      return;
    }
    const groups = groupByEx(rows).reverse();
    el.innerHTML = groups.map(([ex, r]) => groupHtml(ex, r)).join('');
    $('#today-sum').textContent = `${rows.length}セット・合計 ${Math.round(vol(rows))}kg`;
  }
  function onSetClick(ev) {
    const x = ev.target.closest('.x');
    if (x) {
      const id = x.closest('.set').dataset.id;
      const s = sets.find((r) => r.id === id);
      if (!s) return;
      removeSet(id);
      renderToday(); renderRecSub(); renderHistory();
      toast(`${s.ex} ${fmtW(s.w)}×${s.r} を消した`, { label: '元に戻す', fn: () => { if (!sets.some((r) => r.id === id)) { sets.push({ ...s, del: false, dirty: true }); saveSets(); } else restoreSet(id); renderToday(); renderRecSub(); renderHistory(); } });
      return;
    }
    const use = ev.target.closest('[data-use]');
    if (use) { selectEx(use.dataset.use); closePanels(); }
  }
  $('#today-list').addEventListener('click', onSetClick);
  $('#hist-list').addEventListener('click', onSetClick);

  // ---------- 履歴 ----------
  function renderHistory() {
    const filter = $('#hist-ex').value;
    const rows = live().filter((s) => !filter || s.ex === filter);
    const days = new Map();
    for (const s of rows) {
      const k = dayKey(new Date(s.t));
      if (!days.has(k)) days.set(k, []);
      days.get(k).push(s);
    }
    const keys = Array.from(days.keys()).sort().reverse();
    const el = $('#hist-list');
    if (!keys.length) { el.innerHTML = '<p class="empty">記録はまだありません</p>'; return; }
    el.innerHTML = keys.map((k) => {
      const r = days.get(k);
      return `<section class="day"><h3><span>${fmtDay(k)}</span><small>${r.length}セット・${Math.round(vol(r))}kg</small></h3>
        ${groupByEx(r).map(([ex, rr]) => groupHtml(ex, rr, { reuse: true })).join('')}</section>`;
    }).join('');
  }
  function renderHistFilter() {
    const sel = $('#hist-ex');
    const cur = sel.value;
    const names = Array.from(new Set(live().map((s) => s.ex)));
    sel.innerHTML = '<option value="">すべての種目</option>' + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    sel.value = names.includes(cur) ? cur : '';
  }
  $('#hist-ex').addEventListener('change', renderHistory);

  // ---------- CSV ----------
  const CSV_HEAD = ['日付', '時刻', '種目', '重量kg', '回数', 'ボリューム', 'メモ', 'id'];
  const csvCell = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function toCsv(rows) {
    const lines = [CSV_HEAD.join(',')];
    for (const s of rows) {
      const d = new Date(s.t);
      lines.push([dayKey(d), hhmm(s.t), s.ex, s.w, s.r, s.w * s.r, s.note || '', s.id].map(csvCell).join(','));
    }
    return `﻿${lines.join('\r\n')}\r\n`;
  }
  async function exportCsv(scope) {
    let rows = live().slice().sort((a, b) => a.t.localeCompare(b.t));
    let name = 'workout_all';
    if (scope === 'month') {
      const now = new Date();
      const ym = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
      rows = rows.filter((s) => dayKey(new Date(s.t)).startsWith(ym));
      name = `workout_${ym.replace('-', '')}`;
    }
    if (!rows.length) { toast('書き出す記録がありません'); return; }
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const file = new File([blob], `${name}.csv`, { type: 'text/csv' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: '筋トレ記録' }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast(`${rows.length}件を書き出した`);
  }
  $('#csv-all').addEventListener('click', () => exportCsv('all'));
  $('#csv-month').addEventListener('click', () => exportCsv('month'));

  function parseCsv(text) {
    const out = [];
    let row = [];
    let cell = '';
    let q = false;
    const src = text.replace(/^﻿/, '');
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (q) {
        if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && src[i + 1] === '\n') i++;
        row.push(cell); out.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); out.push(row); }
    return out.filter((r) => r.some((c) => c !== ''));
  }
  function importCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) { toast('読めるデータがありません'); return; }
    const head = rows[0].map((h) => h.trim());
    const col = (names) => head.findIndex((h) => names.includes(h));
    const iDate = col(['日付', 'date']);
    const iTime = col(['時刻', 'time']);
    const iEx = col(['種目', 'exercise']);
    const iW = col(['重量kg', 'weight_kg', 'weight', '重量']);
    const iR = col(['回数', 'reps']);
    const iNote = col(['メモ', 'note']);
    const iId = col(['id']);
    if (iDate < 0 || iEx < 0 || iR < 0) { toast('列が足りません(日付・種目・回数)'); return; }
    const ids = new Set(sets.map((s) => s.id));
    let n = 0;
    for (const r of rows.slice(1)) {
      const id = iId >= 0 && r[iId] ? r[iId] : uuid();
      if (ids.has(id)) continue;
      const t = new Date(`${r[iDate].trim().replace(/\//g, '-')}T${(iTime >= 0 && r[iTime]) ? r[iTime].trim() : '12:00'}:00`);
      if (Number.isNaN(t.getTime())) continue;
      const ex = (r[iEx] || '').trim();
      const reps = Math.round(num(r[iR]));
      if (!ex || reps <= 0) continue;
      sets.push({ id, t: t.toISOString(), ex, w: iW >= 0 ? num(r[iW]) : 0, r: reps, note: iNote >= 0 ? r[iNote] : '', upd: new Date().toISOString(), dirty: true });
      ids.add(id);
      n++;
    }
    sets.sort((a, b) => a.t.localeCompare(b.t));
    saveSets();
    ensureExercisesFromSets();
    renderAll();
    schedulePush();
    toast(`${n}件を取り込んだ`);
  }
  $('#import-csv').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    importCsv(await f.text());
    ev.target.value = '';
  });

  // ---------- 設定 ----------
  function renderSettings() {
    $('#set-ex-list').innerHTML = sortedEx().map((e) => `<button type="button" class="chip del" data-del="${esc(e.name)}">${esc(e.name)} ×</button>`).join('');
    $('#sb-note').textContent = sbAvailable
      ? (settings.pass ? '同期中。別の端末でも同じ合言葉を入れると同じ記録が見られます。' : '合言葉を入れると Supabase に保存され、別の端末からも見られます。')
      : 'config.js に Supabase の URL と anon キーを入れると使えます(README参照)。';
    $('#sb-pass').value = settings.pass || '';
    $('#sb-pass').disabled = !sbAvailable;
    $('#sb-save').disabled = !sbAvailable;
  }
  $('#set-ex-list').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-del]');
    if (!b) return;
    const name = b.dataset.del;
    if (!confirm(`「${name}」を種目リストから消す?`)) return;
    exercises = exercises.filter((e) => e.name !== name);
    saveEx();
    if (current === name) selectEx(null);
    renderSettings(); renderChips();
  });
  $('#add-ex-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('#add-ex-name').value.trim().slice(0, 30);
    if (!name) return;
    if (!exercises.some((e) => e.name === name)) { exercises.push({ name, last: Date.now() }); saveEx(); }
    $('#add-ex-name').value = '';
    renderSettings(); renderChips();
    toast(`「${name}」を追加した`);
  });
  $('#sb-save').addEventListener('click', () => {
    settings.pass = $('#sb-pass').value.trim();
    lsSet(LS.settings, settings);
    if (!settings.pass) { setSync(); toast('合言葉が空です'); return; }
    sets = sets.map((s) => ({ ...s, dirty: true }));
    saveSets();
    renderSettings();
    pull();
    toast('同期を始めた');
  });
  $('#sb-clear').addEventListener('click', () => {
    delete settings.pass;
    lsSet(LS.settings, settings);
    sets = sets.filter((s) => !s.del);
    saveSets();
    setSync();
    renderSettings();
    toast('同期をやめた(端末の記録は残ります)');
  });
  $('#wipe').addEventListener('click', () => {
    if (!confirm('この端末の記録を全部消します。CSVは書き出しましたか?')) return;
    if (!confirm('本当に消す?')) return;
    sets = [];
    saveSets();
    renderAll();
    toast('消した');
  });

  // ---------- パネル ----------
  function openPanel(id) {
    closePanels();
    $(id).hidden = false;
    $(id).scrollTop = 0;
    history.pushState({ panel: id }, '');
  }
  function closePanels() { $$('.panel').forEach((p) => { p.hidden = true; }); }
  $('#btn-history').addEventListener('click', () => { renderHistFilter(); renderHistory(); openPanel('#history'); });
  $('#btn-settings').addEventListener('click', () => { renderSettings(); openPanel('#settings'); });
  $$('[data-close-panel]').forEach((b) => b.addEventListener('click', () => history.back()));
  window.addEventListener('popstate', () => { closePanels(); });

  // ---------- 全体 ----------
  function renderTop() {
    const d = new Date();
    $('#top-date').textContent = `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
  }
  function renderAll() {
    renderTop();
    renderChips();
    renderToday();
    renderRecSub();
    if (current) $('#entry-prev').textContent = prevSummary(current);
    if (!$('#history').hidden) { renderHistFilter(); renderHistory(); }
    startRest();
  }

  // 起動:最後に使った種目を選んで、前回の重量・回数を入れておく
  (function init() {
    ensureExercisesFromSets();
    const t = todaySets();
    const pick = current && exercises.some((e) => e.name === current) ? current
      : (t.length ? t[t.length - 1].ex : (sortedEx()[0] || {}).name) || null;
    selectEx(pick);
    renderAll();
    setSync(syncOn() ? '' : undefined, syncOn() ? '…' : '');
    if (syncOn()) pull();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { renderTop(); startRest(); if (syncOn()) pull(); }
    });
    window.addEventListener('online', push);
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  })();
})();
