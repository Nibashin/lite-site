(() => {
  'use strict';

  // ---------- 設定 ----------
  const SPOTS = [
    { id: 'funakata', no: 1, name: '船形漁港', note: 'まずはここから・青灯台付近', tag: '深夜狙い', tagClass: 'tag-night', center: [35.0228, 139.8298], zoom: 16 },
    { id: 'okinoshima', no: 2, name: '沖ノ島護岸', note: '夜明けに合わせて移動', tag: '朝まずめ', tagClass: 'tag-dawn', center: [34.9922, 139.8262], zoom: 16 },
    { id: 'sakata', no: 3, name: '坂田漁港', note: 'どこも空いてなかったら', tag: '予備', tagClass: 'tag-reserve', center: [34.9747, 139.7755], zoom: 17 },
  ];
  const SPOT_BY_ID = Object.fromEntries(SPOTS.map((s) => [s.id, s]));

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

  const RANKS = [
    { id: 'count', label: '釣果数' },
    { id: 'aori', label: 'アオリイカ' },
    { id: 'kurodai', label: 'クロダイ' },
    { id: 'other', label: 'ほかの魚' },
  ];

  const LS = {
    demo: 'tateyama-demo-catches',
    mine: 'tateyama-my-ids',
    angler: 'tateyama-angler',
    pass: 'tateyama-pass',
    layer: 'tateyama-layer',
  };

  const cfg = window.FISHING_CONFIG || {};
  const useSupabase = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);

  // ---------- 小物 ----------
  const $ = (sel) => document.querySelector(sel);
  const lsGet = (k, fallback) => {
    try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = (iso) => {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const fmtSize = (n) => (n == null ? '' : `${Number(n)}`);
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // 写真は送る前に縮小(通信量と保存容量の節約)
  function resizeImage(file, maxSide, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
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

  // ---------- データ保存 ----------
  // Supabase が設定されていればみんなで共有、なければこの端末だけに保存(お試しモード)
  const store = useSupabase ? createSupabaseStore() : createLocalStore();

  function createLocalStore() {
    return {
      shared: false,
      needsPass: false,
      async list() { return lsGet(LS.demo, []); },
      async checkPass() { return true; },
      async add(entry, photo) {
        const all = lsGet(LS.demo, []);
        const row = { ...entry, id: uuid(), created_at: new Date().toISOString(), photo_url: null };
        if (photo) row.photo_url = await blobToDataUrl(await resizeImage(photo, 720, 0.7));
        all.push(row);
        if (!lsSet(LS.demo, all)) throw new Error('この端末の保存容量がいっぱいです');
        return row;
      },
      async remove(id) { lsSet(LS.demo, lsGet(LS.demo, []).filter((c) => c.id !== id)); },
      subscribe() {
        window.addEventListener('storage', (e) => { if (e.key === LS.demo) reload(); });
      },
    };
  }

  function createSupabaseStore() {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const BUCKET = 'catch-photos';
    const withUrl = (row) => ({
      ...row,
      photo_url: row.photo_path ? sb.storage.from(BUCKET).getPublicUrl(row.photo_path).data.publicUrl : null,
    });
    return {
      shared: true,
      needsPass: true,
      async list() {
        const { data, error } = await sb.from('catches').select('*').order('created_at', { ascending: true });
        if (error) throw error;
        return data.map(withUrl);
      },
      async checkPass(pass) {
        const { data, error } = await sb.rpc('check_passcode', { p_pass: pass });
        if (error) throw error;
        return data === true;
      },
      async add(entry, photo, pass) {
        let photoPath = null;
        if (photo) {
          const blob = await resizeImage(photo, 1600, 0.82);
          const day = new Date().toISOString().slice(0, 10);
          photoPath = `${day}/${uuid()}.jpg`;
          const { error } = await sb.storage.from(BUCKET).upload(photoPath, blob, { contentType: 'image/jpeg' });
          if (error) throw error;
        }
        const { data, error } = await sb.rpc('add_catch', {
          p_pass: pass,
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
        return withUrl(data);
      },
      async remove(id, pass) {
        const { error } = await sb.rpc('delete_catch', { p_pass: pass, p_id: id });
        if (error) throw error;
      },
      subscribe() {
        sb.channel('catches-feed')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'catches' }, () => reload())
          .subscribe((status) => { $('#live-dot').hidden = status !== 'SUBSCRIBED'; });
        // リアルタイムが切れていても1分ごとに取り直す
        setInterval(reload, 60000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reload(); });
      },
    };
  }

  // ---------- 状態 ----------
  let catches = [];
  let currentSpot = 'funakata';
  let currentRank = 'count';
  let picking = false;
  let tempMarker = null;
  let pendingPos = null;
  const markers = new Map();
  const myIds = new Set(lsGet(LS.mine, []));

  // ---------- 地図 ----------
  const map = L.map('map', { zoomControl: true, attributionControl: true, maxZoom: 19 })
    .setView(SPOT_BY_ID[currentSpot].center, SPOT_BY_ID[currentSpot].zoom);
  map.attributionControl.setPrefix(false);
  const gsiAttr = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';
  const layers = {
    night: L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
      maxNativeZoom: 18, maxZoom: 19, className: 'tiles-night', attribution: gsiAttr,
    }),
    photo: L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', {
      maxNativeZoom: 18, maxZoom: 19, className: 'tiles-photo', attribution: `${gsiAttr}(全国最新写真)`,
    }),
  };
  let layerName = lsGet(LS.layer, 'photo') === 'night' ? 'night' : 'photo';
  layers[layerName].addTo(map);

  const layerBtn = $('#layer-toggle');
  function syncLayerBtn() {
    layerBtn.textContent = layerName === 'photo' ? '図にする' : '航空写真';
  }
  syncLayerBtn();
  layerBtn.addEventListener('click', () => {
    map.removeLayer(layers[layerName]);
    layerName = layerName === 'photo' ? 'night' : 'photo';
    layers[layerName].addTo(map);
    lsSet(LS.layer, layerName);
    syncLayerBtn();
  });

  // 全体表示のときだけポイント名ラベルを出す
  const spotLabels = L.layerGroup(SPOTS.map((s) => L.marker(s.center, {
    interactive: true,
    keyboard: false,
    icon: L.divIcon({ className: '', html: `<span class="spot-label"><b>${s.no}</b>${esc(s.name)}</span>`, iconSize: [0, 0] }),
  }).on('click', () => selectSpot(s.id))));
  function syncSpotLabels() {
    if (map.getZoom() <= 14) spotLabels.addTo(map); else spotLabels.remove();
  }
  map.on('zoomend', syncSpotLabels);

  $('#locate-btn').addEventListener('click', () => {
    if (!navigator.geolocation) { toast('この端末では現在地が使えません'); return; }
    toast('現在地をさがしています…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        map.setView(ll, Math.max(map.getZoom(), 17));
        if (picking) placePending(L.latLng(ll));
        else {
          L.circleMarker(ll, { radius: 8, color: '#a9c9f2', weight: 3, fillOpacity: 0.5 }).addTo(map)
            .bindTooltip('いまここ').openTooltip();
        }
      },
      () => toast('現在地がとれませんでした'),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  });

  function nearestSpot(latlng) {
    let best = SPOTS[0];
    let bestD = Infinity;
    for (const s of SPOTS) {
      const d = map.distance(latlng, s.center);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best.id;
  }

  function pinIcon(c, extra = '') {
    const g = FISH_GROUP[c.fish] || '';
    const label = c.size_cm != null ? fmtSize(Math.round(c.size_cm)) : c.fish.slice(0, 1);
    return L.divIcon({
      className: '',
      html: `<div class="pin ${g ? `pin-${g}` : ''} ${extra}"><span>${esc(label)}</span></div>`,
      iconSize: [34, 34],
      iconAnchor: [4, 34],
      popupAnchor: [13, -30],
    });
  }

  function popupHtml(c) {
    const spot = SPOT_BY_ID[c.spot];
    return `<div class="pop">
      ${c.photo_url ? `<img src="${esc(c.photo_url)}" alt="${esc(c.fish)}の写真" loading="lazy">` : ''}
      <div class="pop-title">${esc(c.angler)} <span class="pop-fish">${esc(c.fish)}${c.size_cm != null ? ` ${esc(fmtSize(c.size_cm))}cm` : ''}</span></div>
      ${c.comment ? `<p class="pop-comment">「${esc(c.comment)}」</p>` : ''}
      <div class="pop-meta">${esc(fmtTime(c.created_at))} ・ ${esc(spot ? spot.name : '')}</div>
      ${myIds.has(c.id) ? `<button type="button" class="del-btn" data-del="${esc(c.id)}">この釣果を消す</button>` : ''}
    </div>`;
  }

  function renderMarkers(newId) {
    const seen = new Set();
    for (const c of catches) {
      seen.add(c.id);
      let m = markers.get(c.id);
      if (!m) {
        m = L.marker([c.lat, c.lng], { icon: pinIcon(c, c.id === newId ? 'pin-new' : ''), riseOnHover: true })
          .bindPopup(() => popupHtml(c), { maxWidth: 260, autoPanPaddingTopLeft: [16, 60], autoPanPaddingBottomRight: [16, 16] })
          .addTo(map);
        m.on('popupopen', (e) => {
          const img = e.popup.getElement().querySelector('img');
          if (img && !img.complete) img.addEventListener('load', () => e.popup.update(), { once: true });
        });
        markers.set(c.id, m);
      } else {
        m.setPopupContent(() => popupHtml(c));
      }
    }
    for (const [id, m] of markers) {
      if (!seen.has(id)) { m.remove(); markers.delete(id); }
    }
  }

  // ---------- ポイントのタブ ----------
  function renderSpotTabs() {
    const counts = {};
    for (const c of catches) counts[c.spot] = (counts[c.spot] || 0) + 1;
    const tabs = SPOTS.map((s) => `
      <button type="button" class="spot-tab" role="tab" data-spot="${s.id}" aria-selected="${currentSpot === s.id}">
        <span class="spot-no">${s.no}</span>
        <span class="spot-name">${esc(s.name)}</span>
        <span class="spot-meta"><span class="tag ${s.tagClass}">${esc(s.tag)}</span>${counts[s.id] ? `<span class="spot-count">${counts[s.id]}匹</span>` : ''}</span>
        <span class="spot-note">${esc(s.note)}</span>
      </button>`).join('');
    const all = `
      <button type="button" class="spot-tab" role="tab" data-spot="all" aria-selected="${currentSpot === 'all'}">
        <span class="spot-no">全</span>
        <span class="spot-name">全体マップ</span>
        <span class="spot-meta"><span class="tag tag-all">3か所</span>${catches.length ? `<span class="spot-count">${catches.length}匹</span>` : ''}</span>
        <span class="spot-note">ぜんぶの釣果をまとめて見る</span>
      </button>`;
    $('#spot-tabs').innerHTML = tabs + all;
  }

  function selectSpot(id) {
    currentSpot = id;
    if (id === 'all') {
      map.flyToBounds(L.latLngBounds(SPOTS.map((s) => s.center)).pad(0.25), { duration: 0.8 });
    } else {
      const s = SPOT_BY_ID[id];
      map.flyTo(s.center, s.zoom, { duration: 0.8 });
    }
    renderSpotTabs();
  }

  $('#spot-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-spot]');
    if (btn) selectSpot(btn.dataset.spot);
  });

  // ---------- ランキング ----------
  function bestPerAngler(list) {
    const best = new Map();
    for (const c of list) {
      if (c.size_cm == null) continue;
      const prev = best.get(c.angler);
      if (!prev || Number(c.size_cm) > Number(prev.size_cm)) best.set(c.angler, c);
    }
    return [...best.values()].sort((a, b) => b.size_cm - a.size_cm || a.created_at.localeCompare(b.created_at));
  }

  function computeRank(id) {
    if (id === 'count') {
      const m = new Map();
      for (const c of catches) {
        const r = m.get(c.angler) || { name: c.angler, n: 0, kinds: new Set(), first: c.created_at };
        r.n += 1;
        r.kinds.add(c.fish);
        m.set(c.angler, r);
      }
      return [...m.values()]
        .sort((a, b) => b.n - a.n || b.kinds.size - a.kinds.size || a.first.localeCompare(b.first))
        .map((r) => ({ name: r.name, sub: [...r.kinds].join('・'), val: r.n, unit: '匹' }));
    }
    const filter = {
      aori: (c) => c.fish === 'アオリイカ',
      kurodai: (c) => c.fish === 'クロダイ',
      other: (c) => c.fish !== 'アオリイカ' && c.fish !== 'クロダイ',
    }[id];
    const list = id === 'other'
      ? catches.filter(filter).filter((c) => c.size_cm != null).sort((a, b) => b.size_cm - a.size_cm)
      : bestPerAngler(catches.filter(filter));
    return list.map((c) => ({
      name: c.angler,
      sub: `${id === 'other' ? `${c.fish} ・ ` : ''}${SPOT_BY_ID[c.spot]?.name || ''} ${fmtTime(c.created_at)}`,
      val: fmtSize(c.size_cm),
      unit: 'cm',
      id: c.id,
    }));
  }

  function renderRanking() {
    $('#rank-tabs').innerHTML = RANKS.map((r) =>
      `<button type="button" role="tab" data-rank="${r.id}" aria-selected="${currentRank === r.id}">${esc(r.label)}</button>`).join('');
    const rows = computeRank(currentRank).slice(0, 10);
    const emptyMsg = currentRank === 'count' ? 'まだ釣果なし。最初の1匹は誰だ？' : 'サイズ入りの釣果がまだありません';
    $('#rank-list').innerHTML = rows.length
      ? rows.map((r, i) => `
        <li ${r.id ? `data-catch="${esc(r.id)}"` : ''}>
          <span class="rank-no">${i + 1}</span>
          <span class="rank-name">${esc(r.name)}<span class="rank-sub">${esc(r.sub)}</span></span>
          <span class="rank-val">${esc(r.val)}<small>${r.unit}</small></span>
        </li>`).join('')
      : `<li class="rank-empty">${emptyMsg}</li>`;
    renderRankBar();
  }

  function renderRankBar() {
    const bar = $('#rank-bar');
    const parts = [];
    const top = computeRank('count')[0];
    if (top) parts.push(`釣果数 ${esc(top.name)} <b>${top.val}匹</b>`);
    const aori = computeRank('aori')[0];
    if (aori) parts.push(`イカ ${esc(aori.name)} <b>${aori.val}cm</b>`);
    const kuro = computeRank('kurodai')[0];
    if (kuro) parts.push(`クロダイ ${esc(kuro.name)} <b>${kuro.val}cm</b>`);
    bar.innerHTML = `<span class="rb-crown">1位</span><span class="rb-text">${parts.length ? parts.join(' ／ ') : 'まだ釣果なし'}</span>`;
  }

  $('#rank-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rank]');
    if (!btn) return;
    currentRank = btn.dataset.rank;
    renderRanking();
  });
  $('#rank-list').addEventListener('click', (e) => {
    const li = e.target.closest('[data-catch]');
    if (li) focusCatch(li.dataset.catch);
  });

  // ランキング欄が画面から外れたら、下にランキングバーを出す
  const rankBar = $('#rank-bar');
  new IntersectionObserver(([entry]) => { rankBar.hidden = entry.isIntersecting; }).observe($('#ranking'));
  rankBar.addEventListener('click', () => $('#ranking').scrollIntoView({ behavior: 'smooth', block: 'start' }));

  // ---------- 釣果一覧 ----------
  const feedFilter = $('#feed-filter');
  feedFilter.insertAdjacentHTML('beforeend', SPOTS.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join(''));
  feedFilter.addEventListener('change', renderFeed);

  function renderFeed() {
    const f = feedFilter.value;
    const list = catches.filter((c) => f === 'all' || c.spot === f).slice().reverse();
    $('#feed').innerHTML = list.length
      ? list.map((c) => {
        const g = FISH_GROUP[c.fish] || '';
        return `<li><button type="button" class="feed-item" data-catch="${esc(c.id)}">
          ${c.photo_url ? `<img class="feed-thumb" src="${esc(c.photo_url)}" alt="" loading="lazy">` : `<span class="feed-thumb">${esc(c.fish.slice(0, 1))}</span>`}
          <span>
            <span class="feed-top">
              <span class="feed-name">${esc(c.angler)}</span>
              <span class="fish-badge ${g}">${esc(c.fish)}</span>
              ${c.size_cm != null ? `<span class="feed-size">${esc(fmtSize(c.size_cm))}cm</span>` : ''}
            </span>
            ${c.comment ? `<p class="feed-comment">「${esc(c.comment)}」</p>` : ''}
            <span class="feed-meta">${esc(fmtTime(c.created_at))} ・ ${esc(SPOT_BY_ID[c.spot]?.name || '')}</span>
          </span>
        </button></li>`;
      }).join('')
      : '<li class="feed-empty">ここにみんなの釣果が並びます。釣れたら右下の「釣った！」から登録しよう。</li>';
  }

  $('#feed').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-catch]');
    if (btn) focusCatch(btn.dataset.catch);
  });

  function focusCatch(id) {
    const c = catches.find((x) => x.id === id);
    const m = markers.get(id);
    if (!c || !m) return;
    currentSpot = c.spot;
    renderSpotTabs();
    $('.map-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    map.flyTo([c.lat, c.lng], Math.max(map.getZoom(), 17), { duration: 0.7 });
    setTimeout(() => m.openPopup(), 800);
  }

  // 自分の釣果の削除
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    if (!confirm('この釣果を消しますか？')) return;
    try {
      await store.remove(btn.dataset.del, lsGet(LS.pass, ''));
      map.closePopup();
      toast('消しました');
      await reload();
    } catch (err) {
      toast(passError(err) ? '合言葉がちがうので消せませんでした' : '消せませんでした');
    }
  });

  // ---------- 登録フロー ----------
  const fab = $('#fab');
  const mapWrap = $('.map-wrap');

  function startPicking() {
    picking = true;
    mapWrap.classList.add('picking');
    $('#pick-banner').hidden = false;
    if (currentSpot === 'all') selectSpot('funakata');
    mapWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function stopPicking() {
    picking = false;
    mapWrap.classList.remove('picking');
    $('#pick-banner').hidden = true;
  }
  fab.addEventListener('click', startPicking);
  $('#pick-cancel').addEventListener('click', stopPicking);

  map.on('click', (e) => { if (picking) placePending(e.latlng); });

  function placePending(latlng) {
    stopPicking();
    pendingPos = latlng;
    if (tempMarker) tempMarker.remove();
    tempMarker = L.marker(latlng, {
      icon: L.divIcon({ className: '', html: '<div class="pin pin-temp"></div>', iconSize: [34, 34], iconAnchor: [4, 34] }),
      interactive: false,
    }).addTo(map);
    openForm(nearestSpot(latlng));
  }

  const dialog = $('#catch-dialog');
  const form = $('#catch-form');
  let formSpot = 'funakata';

  $('#fish-grid').innerHTML = FISH.map((f, i) => `
    <label class="${f.group || ''}"><input type="radio" name="fish" value="${esc(f.name)}" ${i === 0 ? 'checked' : ''}><span>${esc(f.name)}</span></label>`).join('');

  function renderFormSpot() {
    $('#form-spot').innerHTML = SPOTS.map((s) =>
      `<button type="button" data-fspot="${s.id}" aria-pressed="${formSpot === s.id}">${s.no} ${esc(s.name)}</button>`).join('');
  }
  $('#form-spot').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fspot]');
    if (!b) return;
    formSpot = b.dataset.fspot;
    renderFormSpot();
  });

  function openForm(spotId) {
    formSpot = spotId;
    renderFormSpot();
    $('#form-pos').textContent = `${pendingPos.lat.toFixed(5)}, ${pendingPos.lng.toFixed(5)}`;
    $('#f-angler').value = lsGet(LS.angler, '');
    $('#angler-list').innerHTML = [...new Set(catches.map((c) => c.angler))].map((n) => `<option value="${esc(n)}">`).join('');
    $('#f-size').value = '';
    $('#f-comment').value = '';
    $('#f-photo').value = '';
    $('#photo-preview').hidden = true;
    $('#photo-hint').hidden = false;
    $('#pass-field').hidden = !store.needsPass;
    $('#f-pass').value = lsGet(LS.pass, '');
    $('#form-error').textContent = '';
    dialog.showModal();
  }

  function closeForm() {
    if (dialog.open) dialog.close();
  }
  dialog.addEventListener('close', () => {
    if (tempMarker) { tempMarker.remove(); tempMarker = null; }
  });
  $('#dialog-close').addEventListener('click', closeForm);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeForm(); });

  let previewUrl = null;
  $('#f-photo').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = file ? URL.createObjectURL(file) : null;
    $('#photo-preview').src = previewUrl || '';
    $('#photo-preview').hidden = !file;
    $('#photo-hint').hidden = Boolean(file);
  });

  const passError = (err) => /passcode/i.test(String(err && (err.message || err)));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#form-error');
    const angler = $('#f-angler').value.trim();
    const fish = form.elements.fish.value;
    const sizeRaw = $('#f-size').value.trim();
    const size = sizeRaw === '' ? null : Math.round(Number(sizeRaw) * 10) / 10;
    const comment = $('#f-comment').value.trim();
    const pass = $('#f-pass').value.trim();
    const photo = $('#f-photo').files[0] || null;

    if (!angler) { err.textContent = '名前を入れてね'; $('#f-angler').focus(); return; }
    if (!fish) { err.textContent = '魚をえらんでね'; return; }
    if (size != null && !(size > 0 && size < 300)) { err.textContent = 'サイズは 0〜300cm で入れてね'; return; }
    if (store.needsPass && !pass) { err.textContent = '合言葉を入れてね'; $('#f-pass').focus(); return; }

    const btn = $('#submit-btn');
    btn.disabled = true;
    btn.textContent = photo ? '写真を送っています…' : '登録しています…';
    err.textContent = '';
    try {
      if (store.needsPass && !(await store.checkPass(pass))) {
        err.textContent = '合言葉がちがいます';
        return;
      }
      const row = await store.add({
        angler, fish, size_cm: size, comment: comment || null,
        spot: formSpot, lat: pendingPos.lat, lng: pendingPos.lng,
      }, photo, pass);
      lsSet(LS.angler, angler);
      if (store.needsPass) lsSet(LS.pass, pass);
      myIds.add(row.id);
      lsSet(LS.mine, [...myIds]);
      closeForm();
      toast(`${fish}${size != null ? ` ${size}cm` : ''} を登録しました！`);
      await reload(row.id);
    } catch (ex) {
      console.error(ex);
      err.textContent = passError(ex) ? '合言葉がちがいます' : `登録できませんでした(${ex.message || ex})`;
    } finally {
      btn.disabled = false;
      btn.textContent = '登録する';
    }
  });

  // ---------- 読み込み ----------
  let loading = null;
  async function reload(newId) {
    if (loading) return loading;
    loading = (async () => {
      try {
        catches = (await store.list()).map((c) => ({ ...c, size_cm: c.size_cm == null ? null : Number(c.size_cm) }));
      } catch (ex) {
        console.error(ex);
        toast('釣果を読み込めませんでした');
      }
      renderMarkers(newId);
      renderSpotTabs();
      renderRanking();
      renderFeed();
    })();
    try { await loading; } finally { loading = null; }
  }

  if (!store.shared) {
    const note = $('#mode-note');
    note.hidden = false;
    note.textContent = 'お試しモード：いまはこの端末にだけ保存されます。Supabase をつなぐと、みんなの釣果が共有されます(README 参照)。';
  }

  renderSpotTabs();
  renderRanking();
  renderFeed();
  syncSpotLabels();
  store.subscribe();
  reload();
})();
