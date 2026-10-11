(() => {
  'use strict';

  const {
    LS, $, lsGet, lsSet, lsDel, esc, fmtTime, toast, isPassError,
    FISH, fishKind, fishIcon, SPOT_GEO, SPOT_IDS, normalizeSchedule, store, getMe, setMe,
  } = window.Tsuri;

  const RANKS = [
    { id: 'count', label: '釣果数' },
    { id: 'aori', label: 'アオリイカ' },
    { id: 'kurodai', label: 'クロダイ' },
    { id: 'other', label: 'ほかの魚' },
  ];

  // ---------- 状態 ----------
  let catches = [];
  let profiles = new Map();
  let schedule = normalizeSchedule(null);
  let spotViews = {};
  let currentSpot = 'funakata';
  let currentRank = 'count';
  let picking = false;
  let tempMarker = null;
  let pendingPos = null;
  let mapTouched = false;
  let me = getMe();
  const markers = new Map();
  const myIds = new Set(lsGet(LS.mine, []));

  const fmtSize = (n) => (n == null ? '' : `${Number(n)}`);
  const spotInfo = (id) => ({ ...SPOT_GEO[id], ...schedule.spots.find((s) => s.id === id) });
  const spotView = (id) => {
    const v = spotViews[id];
    return v && Array.isArray(v.c) ? { center: v.c, zoom: v.z } : SPOT_GEO[id];
  };
  const spotName = (id) => (SPOT_GEO[id] ? spotInfo(id).name : '');

  function avatarUrl(name) {
    const p = profiles.get(name);
    if (p && p.avatar_url) return p.avatar_url;
    if (me && me.name === name && me.avatar_url) return me.avatar_url;
    return null;
  }
  function avatarHtml(name, cls = '') {
    const url = avatarUrl(name);
    return url
      ? `<img class="avatar ${cls}" src="${esc(url)}" alt="">`
      : `<span class="avatar avatar-empty ${cls}" aria-hidden="true">${esc((name || '?').slice(0, 1))}</span>`;
  }
  const latestPhotoOf = (name) => {
    for (let i = catches.length - 1; i >= 0; i--) {
      if (catches[i].angler === name && catches[i].photo_url) return catches[i].photo_url;
    }
    return null;
  };
  const canDelete = (c) => myIds.has(c.id) || (me && me.name === c.angler);

  // ---------- 地図 ----------
  const first = spotView(currentSpot);
  const map = L.map('map', { zoomControl: true, attributionControl: true, maxZoom: 19 }).setView(first.center, first.zoom);
  map.attributionControl.setPrefix(false);
  map.on('dragstart', () => { mapTouched = true; });
  map.getContainer().addEventListener('wheel', () => { mapTouched = true; }, { passive: true });
  map.getContainer().addEventListener('touchstart', () => { mapTouched = true; }, { passive: true });
  const gsiAttr = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';
  const layers = {
    night: L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
      maxNativeZoom: 18, maxZoom: 19, className: 'tiles-night', attribution: gsiAttr,
    }),
    photo: L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', {
      maxNativeZoom: 18, maxZoom: 19, className: 'tiles-photo', attribution: `${gsiAttr}(全国最新写真)`,
    }),
  };
  let layerName = lsGet(LS.layer, 'night') === 'photo' ? 'photo' : 'night';
  layers[layerName].addTo(map);

  const layerBtn = $('#layer-toggle');
  const syncLayerBtn = () => { layerBtn.textContent = layerName === 'photo' ? '図にする' : '航空写真'; };
  syncLayerBtn();
  layerBtn.addEventListener('click', () => {
    map.removeLayer(layers[layerName]);
    layerName = layerName === 'photo' ? 'night' : 'photo';
    layers[layerName].addTo(map);
    lsSet(LS.layer, layerName);
    syncLayerBtn();
  });

  // 全体表示のときだけポイント名ラベルを出す
  let spotLabels = L.layerGroup();
  function buildSpotLabels() {
    const show = map.hasLayer(spotLabels);
    spotLabels.remove();
    spotLabels = L.layerGroup(SPOT_IDS.map((id) => {
      const s = spotInfo(id);
      return L.marker(spotView(id).center, {
        keyboard: false,
        icon: L.divIcon({ className: '', html: `<span class="spot-label"><b>${s.no}</b>${esc(s.name)}</span>`, iconSize: [0, 0] }),
      }).on('click', () => selectSpot(id));
    }));
    if (show) spotLabels.addTo(map);
  }
  const syncSpotLabels = () => { if (map.getZoom() <= 14) spotLabels.addTo(map); else spotLabels.remove(); };
  map.on('zoomend', syncSpotLabels);

  $('#locate-btn').addEventListener('click', () => {
    if (!navigator.geolocation) { toast('この端末では現在地が使えません'); return; }
    toast('現在地をさがしています…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        mapTouched = true;
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

  // いま見えている範囲を、そのポイントを押したときの表示にする(みんな共通)
  const saveViewBtn = $('#save-view');
  saveViewBtn.addEventListener('click', async () => {
    if (currentSpot === 'all') return;
    const c = map.getCenter();
    const name = spotName(currentSpot);
    spotViews = { ...spotViews, [currentSpot]: { c: [+c.lat.toFixed(6), +c.lng.toFixed(6)], z: map.getZoom() } };
    buildSpotLabels();
    try {
      await store.setKV('spot_views', spotViews);
      toast(`${name} の初期位置を保存しました`);
    } catch (ex) {
      console.error(ex);
      toast('保存できませんでした(Supabase のアップデートSQLは実行済み？)');
    }
  });
  const syncSaveViewBtn = () => { saveViewBtn.hidden = currentSpot === 'all'; };

  function nearestSpot(latlng) {
    let best = SPOT_IDS[0];
    let bestD = Infinity;
    for (const id of SPOT_IDS) {
      const d = map.distance(latlng, spotView(id).center);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  function pinIcon(c, extra = '') {
    const size = c.size_cm != null ? `<span class="pin-size">${esc(Math.round(c.size_cm))}</span>` : '';
    return L.divIcon({
      className: 'pin-wrap',
      html: `<div class="pin pin-${fishKind(c.fish)} ${extra}">${fishIcon(c.fish)}</div>${size}`,
      iconSize: [34, 34],
      iconAnchor: [4, 34],
      popupAnchor: [13, -30],
    });
  }

  function popupHtml(c) {
    return `<div class="pop">
      ${c.photo_url ? `<img class="pop-photo" src="${esc(c.photo_url)}" alt="${esc(c.fish)}の写真" loading="lazy">` : ''}
      <div class="pop-who">${avatarHtml(c.angler, 'av-sm')}<b>${esc(c.angler)}</b></div>
      <div class="pop-fish">${fishIcon(c.fish)}${esc(c.fish)}${c.size_cm != null ? ` <span class="mono">${esc(fmtSize(c.size_cm))}cm</span>` : ''}</div>
      ${c.comment ? `<p class="pop-comment">「${esc(c.comment)}」</p>` : ''}
      <div class="pop-meta">${esc(fmtTime(c.created_at))} ・ ${esc(spotName(c.spot))}</div>
      ${canDelete(c) ? `<button type="button" class="del-btn" data-del="${esc(c.id)}">この釣果を消す</button>` : ''}
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
          const img = e.popup.getElement().querySelector('img.pop-photo');
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

  // ---------- ヘッダー・最新の1匹 ----------
  function renderHeader() {
    $('#hero-date').textContent = schedule.date;
    $('#goal-text').textContent = schedule.goal;
    $('#spots-step').textContent = `STEP ${schedule.steps.length + 1}`;
    $('#spots-note').textContent = schedule.spotsNote;
    const t = schedule.title.trim();
    const sp = t.indexOf(' ');
    $('#hero-title').innerHTML = sp > 0 ? `${esc(t.slice(0, sp))}<br>${esc(t.slice(sp + 1))}` : esc(t);
  }

  function renderMeChip() {
    $('#me-chip').innerHTML = me
      ? `${avatarHtml(me.name, 'av-xs')}<span>${esc(me.name)}</span>`
      : '<span class="avatar avatar-empty av-xs">?</span><span>名前を登録</span>';
  }

  function renderLatest() {
    const el = $('#latest');
    const c = catches[catches.length - 1];
    if (!c) {
      el.innerHTML = `<div class="latest-card latest-empty">
        <span class="latest-media"><span class="latest-ph">${fishIcon('アオリイカ')}</span></span>
        <span class="latest-body"><span class="latest-label">LATEST CATCH</span><b>まだ釣果なし</b><span class="latest-meta">最初の1匹は誰だ？</span></span>
      </div>`;
      return;
    }
    el.innerHTML = `<button type="button" class="latest-card" data-catch="${esc(c.id)}">
      <span class="latest-media">${c.photo_url
        ? `<img src="${esc(c.photo_url)}" alt="${esc(c.fish)}の写真">`
        : `<span class="latest-ph latest-${fishKind(c.fish)}">${fishIcon(c.fish)}</span>`}</span>
      <span class="latest-body">
        <span class="latest-label">LATEST CATCH 最新の1匹</span>
        <span class="latest-fish">${fishIcon(c.fish)}${esc(c.fish)}${c.size_cm != null ? `<span class="mono">${esc(fmtSize(c.size_cm))}<small>cm</small></span>` : ''}</span>
        <span class="latest-who">${avatarHtml(c.angler, 'av-sm')}<b>${esc(c.angler)}</b></span>
        ${c.comment ? `<span class="latest-comment">「${esc(c.comment)}」</span>` : ''}
        <span class="latest-meta">${esc(fmtTime(c.created_at))} ・ ${esc(spotName(c.spot))}</span>
      </span>
    </button>`;
  }
  $('#latest').addEventListener('click', (e) => {
    const b = e.target.closest('[data-catch]');
    if (b) focusCatch(b.dataset.catch);
  });

  // ---------- ポイントのタブ ----------
  function renderSpotTabs() {
    const counts = {};
    for (const c of catches) counts[c.spot] = (counts[c.spot] || 0) + 1;
    const tabs = SPOT_IDS.map((id) => {
      const s = spotInfo(id);
      return `<button type="button" class="spot-tab" role="tab" data-spot="${id}" aria-selected="${currentSpot === id}">
        <span class="spot-no">${s.no}</span>
        <span class="spot-name">${esc(s.name)}</span>
        <span class="spot-meta">${s.tagType !== 'none' && s.tag ? `<span class="tag tag-${s.tagType}">${esc(s.tag)}</span>` : ''}${counts[id] ? `<span class="spot-count">${counts[id]}匹</span>` : ''}</span>
        <span class="spot-note">${esc([s.note, s.hint].filter(Boolean).join('・'))}</span>
      </button>`;
    }).join('');
    const all = `<button type="button" class="spot-tab" role="tab" data-spot="all" aria-selected="${currentSpot === 'all'}">
        <span class="spot-no">全</span>
        <span class="spot-name">全体マップ</span>
        <span class="spot-meta"><span class="tag tag-none">3か所</span>${catches.length ? `<span class="spot-count">${catches.length}匹</span>` : ''}</span>
        <span class="spot-note">ぜんぶの釣果をまとめて見る</span>
      </button>`;
    $('#spot-tabs').innerHTML = tabs + all;
  }

  function selectSpot(id) {
    currentSpot = id;
    mapTouched = true;
    if (id === 'all') {
      map.flyToBounds(L.latLngBounds(SPOT_IDS.map((s) => spotView(s).center)).pad(0.25), { duration: 0.8 });
    } else {
      const v = spotView(id);
      map.flyTo(v.center, v.zoom, { duration: 0.8 });
    }
    renderSpotTabs();
    syncSaveViewBtn();
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
      if (!prev || c.size_cm > prev.size_cm) best.set(c.angler, c);
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
        .map((r) => ({ name: r.name, sub: [...r.kinds].join('・'), val: r.n, unit: '匹', photo: latestPhotoOf(r.name) }));
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
      sub: `${id === 'other' ? `${c.fish} ・ ` : ''}${spotName(c.spot)} ${fmtTime(c.created_at)}`,
      val: fmtSize(c.size_cm),
      unit: 'cm',
      id: c.id,
      photo: c.photo_url || latestPhotoOf(c.angler),
    }));
  }

  function renderRanking() {
    $('#rank-tabs').innerHTML = RANKS.map((r) =>
      `<button type="button" role="tab" data-rank="${r.id}" aria-selected="${currentRank === r.id}">${esc(r.label)}</button>`).join('');
    const rows = computeRank(currentRank).slice(0, 10);
    const emptyMsg = currentRank === 'count' ? 'まだ釣果なし。最初の1匹は誰だ？' : 'サイズ入りの釣果がまだありません';
    $('#rank-list').innerHTML = rows.length
      ? rows.map((r, i) => `
        <li ${r.id ? `data-catch="${esc(r.id)}"` : `data-angler="${esc(r.name)}"`}>
          <span class="rank-no">${i + 1}</span>
          ${avatarHtml(r.name, 'av-md')}
          <span class="rank-name">${esc(r.name)}<span class="rank-sub">${esc(r.sub)}</span></span>
          ${r.photo ? `<img class="rank-photo" src="${esc(r.photo)}" alt="" loading="lazy">` : '<span></span>'}
          <span class="rank-val">${esc(r.val)}<small>${r.unit}</small></span>
        </li>`).join('')
      : `<li class="rank-empty">${emptyMsg}</li>`;
    renderRankBar();
  }

  function renderRankBar() {
    const parts = [];
    const top = computeRank('count')[0];
    if (top) parts.push(`釣果数 ${esc(top.name)} <b>${top.val}匹</b>`);
    const aori = computeRank('aori')[0];
    if (aori) parts.push(`イカ ${esc(aori.name)} <b>${aori.val}cm</b>`);
    const kuro = computeRank('kurodai')[0];
    if (kuro) parts.push(`クロダイ ${esc(kuro.name)} <b>${kuro.val}cm</b>`);
    const lead = top ? avatarHtml(top.name, 'av-xs') : '';
    $('#rank-bar').innerHTML = `<span class="rb-crown">1位</span>${lead}<span class="rb-text">${parts.length ? parts.join(' ／ ') : 'まだ釣果なし'}</span>`;
  }

  $('#rank-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rank]');
    if (!btn) return;
    currentRank = btn.dataset.rank;
    renderRanking();
  });
  $('#rank-list').addEventListener('click', (e) => {
    const li = e.target.closest('[data-catch], [data-angler]');
    if (!li) return;
    if (li.dataset.catch) { focusCatch(li.dataset.catch); return; }
    const last = [...catches].reverse().find((c) => c.angler === li.dataset.angler);
    if (last) focusCatch(last.id);
  });

  // ランキング欄が画面から外れたら、下にランキングバーを出す
  const rankBar = $('#rank-bar');
  new IntersectionObserver(([entry]) => { rankBar.hidden = entry.isIntersecting; }).observe($('#ranking'));
  rankBar.addEventListener('click', () => $('#ranking').scrollIntoView({ behavior: 'smooth', block: 'start' }));

  // ---------- 釣果一覧 ----------
  const feedFilter = $('#feed-filter');
  function renderFeedFilter() {
    const v = feedFilter.value;
    feedFilter.innerHTML = '<option value="all">ぜんぶ</option>'
      + SPOT_IDS.map((id) => `<option value="${id}">${esc(spotName(id))}</option>`).join('');
    feedFilter.value = v || 'all';
  }
  feedFilter.addEventListener('change', renderFeed);

  function renderFeed() {
    const f = feedFilter.value || 'all';
    const list = catches.filter((c) => f === 'all' || c.spot === f).slice().reverse();
    $('#feed').innerHTML = list.length
      ? list.map((c) => `<li><button type="button" class="feed-item" data-catch="${esc(c.id)}">
          ${c.photo_url
            ? `<img class="feed-thumb" src="${esc(c.photo_url)}" alt="" loading="lazy">`
            : `<span class="feed-thumb feed-ph latest-${fishKind(c.fish)}">${fishIcon(c.fish)}</span>`}
          <span>
            <span class="feed-top">
              ${avatarHtml(c.angler, 'av-sm')}
              <span class="feed-name">${esc(c.angler)}</span>
              <span class="fish-badge fb-${fishKind(c.fish)}">${fishIcon(c.fish)}${esc(c.fish)}</span>
              ${c.size_cm != null ? `<span class="feed-size">${esc(fmtSize(c.size_cm))}cm</span>` : ''}
            </span>
            ${c.comment ? `<p class="feed-comment">「${esc(c.comment)}」</p>` : ''}
            <span class="feed-meta">${esc(fmtTime(c.created_at))} ・ ${esc(spotName(c.spot))}</span>
          </span>
        </button></li>`).join('')
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
    syncSaveViewBtn();
    mapTouched = true;
    $('.map-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    map.flyTo([c.lat, c.lng], Math.max(map.getZoom(), 17), { duration: 0.7 });
    setTimeout(() => m.openPopup(), 800);
  }

  // 釣果の削除
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    if (!confirm('この釣果を消しますか？')) return;
    try {
      await store.removeCatch(btn.dataset.del, lsGet(LS.pass, ''));
      map.closePopup();
      toast('消しました');
      await reload('catches');
    } catch (err) {
      console.error(err);
      toast(isPassError(err) ? '合言葉がちがうので消せませんでした' : '消せませんでした');
    }
  });

  // ---------- 名前とアイコン ----------
  const pDialog = $('#profile-dialog');
  let pAvatarFile = null;
  let pAvatarUrl = null;
  let afterProfile = null;

  function openProfile(lead, then) {
    afterProfile = then || null;
    pAvatarFile = null;
    $('#profile-lead').textContent = lead || 'このブラウザに覚えておくので、次からは入力いりません。';
    $('#p-name').value = me ? me.name : '';
    $('#p-pass').value = '';
    $('#p-avatar').value = '';
    $('#p-error').textContent = '';
    $('#angler-list').innerHTML = [...profiles.keys()].map((n) => `<option value="${esc(n)}">`).join('');
    updateProfileForm();
    pDialog.showModal();
  }

  function showAvatarPreview(url) {
    $('#p-avatar-img').hidden = !url;
    if (url) $('#p-avatar-img').src = url;
    $('#p-avatar-ph').hidden = Boolean(url);
  }

  function updateProfileForm() {
    const name = $('#p-name').value.trim();
    const known = profiles.has(name);
    if (!pAvatarFile) showAvatarPreview(name ? avatarUrl(name) : null);
    const needPass = store.shared && name && !known && !lsGet(LS.pass, '');
    $('#p-pass-field').hidden = !needPass;
    let status = '';
    if (name && known) status = avatarUrl(name) ? '登録済みの名前です。前のアイコンを引き継ぎます(画像をえらぶと上書き)' : '登録済みの名前です';
    else if (name) status = 'はじめての名前です';
    $('#p-status').textContent = status;
  }
  $('#p-name').addEventListener('input', updateProfileForm);

  $('#p-avatar').addEventListener('change', (e) => {
    const file = e.target.files[0] || null;
    pAvatarFile = file;
    if (pAvatarUrl) URL.revokeObjectURL(pAvatarUrl);
    pAvatarUrl = file ? URL.createObjectURL(file) : null;
    if (file) showAvatarPreview(pAvatarUrl); else updateProfileForm();
  });

  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#p-error');
    const name = $('#p-name').value.trim();
    const typed = $('#p-pass').value.trim();
    const pass = typed || lsGet(LS.pass, '');
    if (!name) { err.textContent = '名前を入れてね'; $('#p-name').focus(); return; }
    if (store.shared && !profiles.has(name) && !pass) { err.textContent = '合言葉を入れてね'; $('#p-pass-field').hidden = false; $('#p-pass').focus(); return; }

    const btn = $('#p-submit');
    btn.disabled = true;
    btn.textContent = pAvatarFile ? 'アイコンを送っています…' : '確認しています…';
    err.textContent = '';
    try {
      const p = await store.saveProfile(name, pAvatarFile, pass);
      profiles.set(p.name, p);
      if (typed) lsSet(LS.pass, typed);
      me = { name: p.name, avatar_url: p.avatar_url || null };
      setMe(me);
      pDialog.close();
      toast(`${p.name} で登録しました`);
      renderAll();
      const then = afterProfile;
      afterProfile = null;
      if (then) then();
    } catch (ex) {
      console.error(ex);
      if (isPassError(ex)) {
        if (!typed) lsDel(LS.pass);
        $('#p-pass-field').hidden = false;
        err.textContent = '合言葉がちがいます';
      } else {
        err.textContent = `保存できませんでした(${ex.message || ex})`;
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'これでOK';
    }
  });

  $('#me-chip').addEventListener('click', () => openProfile());

  // ---------- 釣果の登録 ----------
  const fab = $('#fab');
  const mapWrap = $('.map-wrap');

  function startPicking() {
    if (!me) {
      openProfile('まずは名前を登録してね。', startPicking);
      return;
    }
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
    openCatchForm(nearestSpot(latlng));
  }

  const cDialog = $('#catch-dialog');
  const cForm = $('#catch-form');
  let formSpot = 'funakata';

  $('#fish-grid').innerHTML = FISH.map((f, i) => `
    <label class="fk-${fishKind(f.name)}"><input type="radio" name="fish" value="${esc(f.name)}" ${i === 0 ? 'checked' : ''}><span>${fishIcon(f.name)}${esc(f.name)}</span></label>`).join('');

  function renderFormSpot() {
    $('#form-spot').innerHTML = SPOT_IDS.map((id) =>
      `<button type="button" data-fspot="${id}" aria-pressed="${formSpot === id}">${SPOT_GEO[id].no} ${esc(spotName(id))}</button>`).join('');
  }
  $('#form-spot').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fspot]');
    if (!b) return;
    formSpot = b.dataset.fspot;
    renderFormSpot();
  });

  const renderWho = () => { $('#who').innerHTML = me ? `${avatarHtml(me.name, 'av-md')}<b>${esc(me.name)}</b>` : ''; };

  function openCatchForm(spotId) {
    formSpot = spotId;
    renderFormSpot();
    renderWho();
    $('#f-size').value = '';
    $('#f-comment').value = '';
    $('#f-photo').value = '';
    $('#photo-preview').hidden = true;
    $('#photo-hint').hidden = false;
    $('#form-error').textContent = '';
    cDialog.showModal();
  }

  cDialog.addEventListener('close', () => {
    if (tempMarker && !pDialog.open) { tempMarker.remove(); tempMarker = null; }
  });
  for (const d of [cDialog, pDialog]) {
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  }
  pDialog.addEventListener('close', () => {
    if (!cDialog.open && tempMarker && !afterProfile) { tempMarker.remove(); tempMarker = null; }
  });

  $('#who-change').addEventListener('click', () => {
    openProfile('名前やアイコンを変えられます。', () => { renderWho(); });
  });

  let previewUrl = null;
  $('#f-photo').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = file ? URL.createObjectURL(file) : null;
    $('#photo-preview').src = previewUrl || '';
    $('#photo-preview').hidden = !file;
    $('#photo-hint').hidden = Boolean(file);
  });

  cForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#form-error');
    const fish = cForm.elements.fish.value;
    const sizeRaw = $('#f-size').value.trim();
    const size = sizeRaw === '' ? null : Math.round(Number(sizeRaw) * 10) / 10;
    const comment = $('#f-comment').value.trim();
    const photo = $('#f-photo').files[0] || null;

    if (!me) { openProfile('まずは名前を登録してね。', renderWho); return; }
    if (!fish) { err.textContent = '魚をえらんでね'; return; }
    if (size != null && !(size > 0 && size < 300)) { err.textContent = 'サイズは 0〜300cm で入れてね'; return; }

    const btn = $('#submit-btn');
    btn.disabled = true;
    btn.textContent = photo ? '写真を送っています…' : '登録しています…';
    err.textContent = '';
    try {
      const row = await store.addCatch({
        angler: me.name, fish, size_cm: size, comment: comment || null,
        spot: formSpot, lat: pendingPos.lat, lng: pendingPos.lng,
      }, photo, lsGet(LS.pass, ''));
      myIds.add(row.id);
      lsSet(LS.mine, [...myIds]);
      cDialog.close();
      toast(`${fish}${size != null ? ` ${size}cm` : ''} を登録しました！`);
      await reload('catches', row.id);
    } catch (ex) {
      console.error(ex);
      if (isPassError(ex)) {
        err.textContent = 'この名前はまだ登録されていません。「変更」から合言葉を入れて登録してね';
      } else {
        err.textContent = `登録できませんでした(${ex.message || ex})`;
      }
    } finally {
      btn.disabled = false;
      btn.textContent = '登録する';
    }
  });

  // ---------- 読み込み ----------
  function renderAll(newId) {
    renderHeader();
    renderMeChip();
    renderLatest();
    renderMarkers(newId);
    renderSpotTabs();
    renderRanking();
    renderFeedFilter();
    renderFeed();
    syncSaveViewBtn();
  }

  async function loadKV() {
    const [sched, views] = await Promise.all([store.getKV('schedule'), store.getKV('spot_views')]);
    schedule = normalizeSchedule(sched);
    spotViews = views && typeof views === 'object' ? views : {};
    buildSpotLabels();
  }

  let busy = null;
  let again = false;
  async function reload(what = 'all', newId) {
    if (busy) { again = true; return busy; }
    busy = (async () => {
      try {
        const jobs = [];
        if (what === 'all' || what === 'catches') {
          jobs.push(store.listCatches().then((rows) => {
            catches = rows.map((c) => ({ ...c, size_cm: c.size_cm == null ? null : Number(c.size_cm) }));
          }));
        }
        if (what === 'all' || what === 'profiles' || what === 'catches') {
          jobs.push(store.listProfiles().then((rows) => {
            profiles = new Map(rows.map((p) => [p.name, p]));
            // 同じ名前ならアイコンを復活(このブラウザの記憶も更新)
            if (me && profiles.has(me.name)) {
              const url = profiles.get(me.name).avatar_url || me.avatar_url || null;
              if (url !== me.avatar_url) { me = { ...me, avatar_url: url }; setMe(me); }
            }
          }));
        }
        if (what === 'all' || what === 'kv') jobs.push(loadKV());
        await Promise.all(jobs);
      } catch (ex) {
        console.error(ex);
        toast('読み込めませんでした');
      }
      renderAll(newId);
    })();
    try { await busy; } finally {
      busy = null;
      if (again) { again = false; reload('all'); }
    }
  }

  if (!store.shared) {
    const note = $('#mode-note');
    note.hidden = false;
    note.textContent = 'お試しモード：いまはこの端末にだけ保存されます。Supabase をつなぐと、みんなの釣果が共有されます(README 参照)。';
  }

  renderAll();
  syncSpotLabels();
  store.subscribe((what) => reload(what), (live) => { $('#live-dot').hidden = !live; });
  reload('all').then(() => {
    // 保存された初期位置で開き直す(まだ地図をさわっていなければ)
    if (!mapTouched && currentSpot !== 'all') {
      const v = spotView(currentSpot);
      map.setView(v.center, v.zoom);
    }
  });
})();
