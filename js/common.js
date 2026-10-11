// 釣果ボードとスケジュールページで共通に使う道具・データ保存
(() => {
  'use strict';

  const cfg = window.FISHING_CONFIG || {};
  const useSupabase = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);

  const LS = {
    demoCatches: 'tateyama-demo-catches',
    demoProfiles: 'tateyama-demo-profiles',
    demoKv: 'tateyama-demo-kv',
    mine: 'tateyama-my-ids',
    me: 'tateyama-me',
    legacyAngler: 'tateyama-angler',
    pass: 'tateyama-pass',
    layer: 'tateyama-layer',
  };

  // ---------- 小物 ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const lsGet = (k, fallback) => {
    try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* noop */ } };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtTime = (iso) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const isPassError = (err) => /passcode/i.test(String(err && (err.message || err)));

  let toastTimer;
  function toast(msg) {
    let el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // 写真は送る前に縮小。square=true なら真ん中を正方形に切り抜く(アイコン用)
  function resizeImage(file, maxSide, quality, square = false) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        let sx = 0;
        let sy = 0;
        let sw = img.naturalWidth;
        let sh = img.naturalHeight;
        if (square) {
          const s = Math.min(sw, sh);
          sx = (sw - s) / 2;
          sy = (sh - s) / 2;
          sw = s;
          sh = s;
        }
        const scale = Math.min(1, maxSide / Math.max(sw, sh));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(sw * scale);
        canvas.height = Math.round(sh * scale);
        canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像の変換に失敗しました'))), 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('この画像は読み込めませんでした')); };
      img.src = url;
    });
  }
  const blobToDataUrl = (blob) => new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });

  // ---------- 魚 ----------
  const FISH = [
    { name: 'アオリイカ', group: 'ika' },
    { name: 'コウイカ', group: 'ika' },
    { name: 'ヤリイカ', group: 'ika' },
    { name: 'クロダイ', group: 'kurodai' },
    { name: 'メジナ' }, { name: 'スズキ' }, { name: 'アジ' }, { name: 'サバ' },
    { name: 'イワシ' }, { name: 'カサゴ' }, { name: 'メバル' }, { name: 'ムラソイ' },
    { name: 'キス' }, { name: 'マゴチ' }, { name: 'ヒラメ' }, { name: 'カワハギ' },
    { name: 'ベラ' }, { name: 'フグ' }, { name: 'その他' },
  ];
  const FISH_GROUP = Object.fromEntries(FISH.map((f) => [f.name, f.group || '']));

  const ICONS = {
    // イカ:三角のエンペラ+胴+足
    ika: '<svg viewBox="0 0 32 32"><path d="M16 1.5 9.5 9.5c-1 1.3-1.5 3-1.5 4.7V19c0 2.2 3.6 3.6 8 3.6s8-1.4 8-3.6v-4.8c0-1.7-.5-3.4-1.5-4.7z" fill="currentColor"/><path d="M10.5 21.5 8 30M13.5 22.2 12.5 31M18.5 22.2 19.5 31M21.5 21.5 24 30" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/><circle cx="12.8" cy="17.2" r="1.5" fill="#0e1628"/><circle cx="19.2" cy="17.2" r="1.5" fill="#0e1628"/></svg>',
    // クロダイ:体高のある鯛型+背びれ
    kurodai: '<svg viewBox="0 0 32 32"><path d="M2 16.5C4.5 9.5 10 6.5 16 6.5c4 0 6.8 2.4 8.6 5.2L30 7.5v18l-5.4-4.2C22.8 24.1 20 26.5 16 26.5c-6 0-11.5-3-14-10z" fill="currentColor"/><path d="M9.5 8.2 11.5 3.5 14 6.6 16.5 3 18.5 6.8 21 4.5 22 8.6" fill="currentColor"/><circle cx="8" cy="14.5" r="1.7" fill="#0e1628"/><path d="M12.5 12.5c1.6 2.6 1.6 6.4 0 9" stroke="#0e1628" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".6"/></svg>',
    // その他の魚:細身
    fish: '<svg viewBox="0 0 32 32"><path d="M2 16c3-4.8 8-7.5 13.5-7.5 4.2 0 7.3 2 9.3 4.4L30 9v14l-5.2-3.9c-2 2.4-5.1 4.4-9.3 4.4C10 23.5 5 20.8 2 16z" fill="currentColor"/><circle cx="8" cy="14.6" r="1.6" fill="#0e1628"/><path d="M11.5 12c1.2 2.4 1.2 5.6 0 8" stroke="#0e1628" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".6"/></svg>',
  };
  const fishKind = (name) => {
    const g = FISH_GROUP[name];
    return g === 'ika' || g === 'kurodai' ? g : 'fish';
  };
  const fishIcon = (name, cls = '') => `<span class="fish-ico fi-${fishKind(name)} ${cls}" aria-hidden="true">${ICONS[fishKind(name)]}</span>`;

  // ---------- ポイントとスケジュール ----------
  // 地図の初期位置(「ここを初期位置にする」で保存した値があればそちらを使う)
  const SPOT_GEO = {
    funakata: { no: 1, center: [35.0228, 139.8298], zoom: 16 },
    okinoshima: { no: 2, center: [34.9922, 139.8262], zoom: 16 },
    sakata: { no: 3, center: [34.9747, 139.7755], zoom: 17 },
  };
  const SPOT_IDS = Object.keys(SPOT_GEO);

  const DEFAULT_SCHEDULE = {
    title: '館山 夜釣り遠征',
    date: '2026.10.16 FRI → 10.17 SAT',
    dateNote: '夜発・午前中まで',
    targets: ['アオリイカ(エギング)', 'クロダイ'],
    steps: [
      {
        title: '集合・準備',
        items: [
          { time: '19:30', title: '一時集合', sub: '西船橋', hl: false },
          { time: '20:00', title: '車レンタル → 買い出し', sub: '西船橋 ／ ダイソー・コーナン など', hl: false },
        ],
      },
      {
        title: '移動',
        items: [
          { time: '22:00', title: '船橋 出発', sub: '経由 つり具の上州屋 新千葉美浜店', hl: false },
          { time: '24:00', title: '館山 到着(目標)', sub: '', hl: true },
        ],
      },
    ],
    spotsNote: '順繰りに回ってみる',
    spots: [
      { id: 'funakata', name: '船形漁港', note: 'まずはここから', tag: '深夜狙い', tagType: 'night', fish: 'イカ○ クロダイ○', hint: '青灯台付近' },
      { id: 'okinoshima', name: '沖ノ島護岸', note: '夜明けに合わせて移動', tag: '朝まずめ', tagType: 'dawn', fish: 'イカ○ クロダイ○', hint: '' },
      { id: 'sakata', name: '坂田漁港', note: 'どこも空いてなかったら', tag: '予備', tagType: 'reserve', fish: 'イカ○ クロダイ○', hint: 'フカセ・ダンゴ' },
    ],
    goal: '午前中 終了予定',
  };

  const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
  function normalizeSchedule(v) {
    const d = DEFAULT_SCHEDULE;
    const s = v && typeof v === 'object' ? v : {};
    const steps = Array.isArray(s.steps) ? s.steps : d.steps;
    const spotsIn = Array.isArray(s.spots) ? s.spots : [];
    return {
      title: str(s.title, d.title),
      date: str(s.date, d.date),
      dateNote: str(s.dateNote, d.dateNote),
      targets: Array.isArray(s.targets) ? s.targets.map((t) => str(t)).filter(Boolean) : d.targets.slice(),
      steps: steps.map((st) => ({
        title: str(st && st.title),
        items: (Array.isArray(st && st.items) ? st.items : []).map((it) => ({
          time: str(it && it.time), title: str(it && it.title), sub: str(it && it.sub), hl: Boolean(it && it.hl),
        })),
      })),
      spotsNote: str(s.spotsNote, d.spotsNote),
      // ポイントは3か所固定(釣果と紐づくため)。文言だけ編集できる
      spots: d.spots.map((def) => {
        const o = spotsIn.find((x) => x && x.id === def.id) || {};
        return {
          id: def.id,
          name: str(o.name, def.name) || def.name,
          note: str(o.note, def.note),
          tag: str(o.tag, def.tag),
          tagType: ['night', 'dawn', 'reserve', 'none'].includes(o.tagType) ? o.tagType : def.tagType,
          fish: str(o.fish, def.fish),
          hint: str(o.hint, def.hint),
        };
      }),
      goal: str(s.goal, d.goal),
    };
  }

  // ---------- データ保存 ----------
  // Supabase が設定されていればみんなで共有、なければこの端末だけに保存(お試しモード)
  function createLocalStore() {
    const listeners = [];
    const emit = (t) => listeners.forEach((fn) => fn(t));
    const save = (k, v) => { if (!lsSet(k, v)) throw new Error('この端末の保存容量がいっぱいです'); };
    return {
      shared: false,
      async listCatches() { return lsGet(LS.demoCatches, []); },
      async addCatch(entry, photo) {
        const all = lsGet(LS.demoCatches, []);
        const row = { ...entry, id: uuid(), created_at: new Date().toISOString(), photo_url: null };
        if (photo) row.photo_url = await blobToDataUrl(await resizeImage(photo, 720, 0.7));
        all.push(row);
        save(LS.demoCatches, all);
        const profiles = lsGet(LS.demoProfiles, {});
        if (!profiles[entry.angler]) { profiles[entry.angler] = { name: entry.angler, avatar_url: null }; save(LS.demoProfiles, profiles); }
        emit('catches');
        return row;
      },
      async removeCatch(id) {
        save(LS.demoCatches, lsGet(LS.demoCatches, []).filter((c) => c.id !== id));
        emit('catches');
      },
      async listProfiles() { return Object.values(lsGet(LS.demoProfiles, {})); },
      async saveProfile(name, avatar) {
        const profiles = lsGet(LS.demoProfiles, {});
        const prev = profiles[name] || { name, avatar_url: null };
        if (avatar) prev.avatar_url = await blobToDataUrl(await resizeImage(avatar, 192, 0.8, true));
        profiles[name] = prev;
        save(LS.demoProfiles, profiles);
        emit('profiles');
        return prev;
      },
      async getKV(key) { return lsGet(LS.demoKv, {})[key] ?? null; },
      async setKV(key, value) {
        const kv = lsGet(LS.demoKv, {});
        kv[key] = value;
        save(LS.demoKv, kv);
        emit('kv');
      },
      subscribe(fn) {
        listeners.push(fn);
        window.addEventListener('storage', (e) => {
          if (e.key === LS.demoCatches) fn('catches');
          if (e.key === LS.demoProfiles) fn('profiles');
          if (e.key === LS.demoKv) fn('kv');
        });
      },
    };
  }

  function createSupabaseStore() {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const BUCKET = 'catch-photos';
    const pub = (path) => (path ? sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null);
    async function upload(folder, blob) {
      const path = `${folder}/${uuid()}.jpg`;
      const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
      if (error) throw error;
      return path;
    }
    return {
      shared: true,
      async listCatches() {
        const { data, error } = await sb.from('catches').select('*').order('created_at', { ascending: true });
        if (error) throw error;
        return data.map((r) => ({ ...r, photo_url: pub(r.photo_path) }));
      },
      async addCatch(entry, photo, pass) {
        const photoPath = photo
          ? await upload(new Date().toISOString().slice(0, 10), await resizeImage(photo, 1600, 0.82))
          : null;
        const { data, error } = await sb.rpc('add_catch', {
          p_pass: pass || '',
          p_angler: entry.angler,
          p_fish: entry.fish,
          p_size_cm: entry.size_cm,
          p_comment: entry.comment,
          p_spot: entry.spot,
          p_lat: entry.lat,
          p_lng: entry.lng,
          p_photo_path: photoPath,
        });
        if (error) throw error;
        return { ...data, photo_url: pub(data.photo_path) };
      },
      async removeCatch(id, pass) {
        const { error } = await sb.rpc('delete_catch', { p_pass: pass || '', p_id: id });
        if (error) throw error;
      },
      async listProfiles() {
        const { data, error } = await sb.from('profiles').select('*');
        if (error) { console.warn('profiles:', error.message); return []; }
        return data.map((p) => ({ ...p, avatar_url: pub(p.avatar_path) }));
      },
      async saveProfile(name, avatar, pass) {
        const avatarPath = avatar ? await upload('avatars', await resizeImage(avatar, 256, 0.85, true)) : null;
        const { data, error } = await sb.rpc('save_profile', { p_pass: pass || '', p_name: name, p_avatar_path: avatarPath });
        if (error) throw error;
        return { ...data, avatar_url: pub(data.avatar_path) };
      },
      async getKV(key) {
        const { data, error } = await sb.from('kv').select('value').eq('key', key).maybeSingle();
        if (error) { console.warn('kv:', error.message); return null; }
        return data ? data.value : null;
      },
      async setKV(key, value) {
        const { error } = await sb.from('kv').upsert({ key, value, updated_at: new Date().toISOString() });
        if (error) throw error;
      },
      subscribe(fn, onStatus) {
        const ch = sb.channel('tateyama-live');
        for (const table of ['catches', 'profiles', 'kv']) {
          ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => fn(table));
        }
        ch.subscribe((status) => onStatus && onStatus(status === 'SUBSCRIBED'));
        // リアルタイムが切れていても1分ごとに取り直す
        setInterval(() => fn('all'), 60000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) fn('all'); });
      },
    };
  }

  const store = useSupabase ? createSupabaseStore() : createLocalStore();

  // 自分の名前(このブラウザに保存)。古い保存形式からも引き継ぐ
  function getMe() {
    const me = lsGet(LS.me, null);
    if (me && me.name) return me;
    const legacy = lsGet(LS.legacyAngler, '');
    return legacy ? { name: legacy, avatar_url: null } : null;
  }
  const setMe = (me) => lsSet(LS.me, me);

  window.Tsuri = {
    LS, $, lsGet, lsSet, lsDel, esc, pad2, fmtTime, uuid, toast, isPassError,
    resizeImage, FISH, FISH_GROUP, fishKind, fishIcon,
    SPOT_GEO, SPOT_IDS, DEFAULT_SCHEDULE, normalizeSchedule,
    store, getMe, setMe,
  };
})();
