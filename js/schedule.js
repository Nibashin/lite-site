(() => {
  'use strict';

  const { $, esc, toast, SPOT_GEO, normalizeSchedule, store } = window.Tsuri;

  const TAG_TYPES = [
    { id: 'night', label: '深夜(青)' },
    { id: 'dawn', label: '朝(オレンジ)' },
    { id: 'reserve', label: '予備(枠線)' },
    { id: 'none', label: 'なし' },
  ];

  let schedule = normalizeSchedule(null);
  let editing = false;
  let draft = null;
  const root = $('#sched');
  const bar = $('#sched-bar');

  // ---------- 見る ----------
  function renderView() {
    const s = schedule;
    const t = s.title.trim();
    const sp = t.indexOf(' ');
    const title = sp > 0 ? `${esc(t.slice(0, sp))}<br>${esc(t.slice(sp + 1))}` : esc(t);
    const steps = s.steps.map((st, i) => `
      <section class="sv-step">
        <h2 class="sv-step-title"><span class="step">STEP ${i + 1}</span>${esc(st.title)}</h2>
        <ol class="timeline">
          ${st.items.map((it) => `
            <li class="${it.hl ? 'hl' : ''}">
              <span class="tl-time">${esc(it.time)}</span>
              <span class="tl-dot" aria-hidden="true"></span>
              <span class="tl-body"><b>${esc(it.title)}</b>${it.sub ? `<span>${esc(it.sub)}</span>` : ''}</span>
            </li>`).join('')}
        </ol>
      </section>`).join('');
    const spots = s.spots.map((p) => `
      <li class="sv-spot">
        <span class="sv-spot-no">${SPOT_GEO[p.id].no}</span>
        <span class="sv-spot-body">
          <b>${esc(p.name)}</b>
          ${p.note ? `<span class="sv-spot-note">${esc(p.note)}</span>` : ''}
          <span class="sv-spot-tags">
            ${p.fish ? `<span class="pill pill-y">${esc(p.fish)}</span>` : ''}
            ${p.hint ? `<span class="pill pill-t">${esc(p.hint)}</span>` : ''}
          </span>
        </span>
        ${p.tagType !== 'none' && p.tag ? `<span class="tag tag-${p.tagType}">${esc(p.tag)}</span>` : ''}
      </li>`).join('');

    root.innerHTML = `
      <header class="hero sv-hero">
        <div class="stars" aria-hidden="true"></div>
        <div class="moon" aria-hidden="true"></div>
        <p class="eyebrow">TATEYAMA NIGHT FISHING TRIP</p>
        <h1>${title}</h1>
        ${s.targets.length ? `<div class="sv-targets"><span class="step">TARGET</span>${s.targets.map((x) => `<span class="pill">${esc(x)}</span>`).join('')}</div>` : ''}
        <div class="hero-meta">
          <span class="date-pill">${esc(s.date)}</span>
          ${s.dateNote ? `<span class="hero-sub">${esc(s.dateNote)}</span>` : ''}
        </div>
      </header>
      <div class="sv-body">
        ${steps}
        <section class="sv-step">
          <div class="sv-step-head">
            <h2 class="sv-step-title"><span class="step">STEP ${s.steps.length + 1}</span>ポイント</h2>
            ${s.spotsNote ? `<span class="hint">${esc(s.spotsNote)}</span>` : ''}
          </div>
          <ol class="sv-spots">${spots}</ol>
          <a class="sv-link" href="./">釣果ボードの地図を見る →</a>
        </section>
        <section class="sv-goal"><span>GOAL</span>${esc(s.goal)}</section>
      </div>`;
    bar.innerHTML = '<button type="button" class="fab sched-fab" id="edit-btn">編集する</button>';
  }

  // ---------- 編集 ----------
  const inp = (path, value, attrs = '') => `<input type="text" data-path="${path}" value="${esc(value)}" ${attrs}>`;

  function renderEdit() {
    const s = draft;
    root.innerHTML = `
      <div class="se">
        <h1 class="se-title">スケジュールを編集</h1>
        <p class="sheet-lead">保存すると、みんなの画面に反映されます。</p>

        <section class="se-card">
          <label class="field"><span class="label">タイトル <small>スペースで改行</small></span>${inp('title', s.title)}</label>
          <label class="field"><span class="label">日程</span>${inp('date', s.date)}</label>
          <label class="field"><span class="label">日程メモ</span>${inp('dateNote', s.dateNote)}</label>
          <label class="field"><span class="label">ターゲット <small>「、」区切り</small></span>${inp('targets', s.targets.join('、'))}</label>
        </section>

        ${s.steps.map((st, i) => `
          <section class="se-card">
            <div class="se-card-head">
              <span class="step">STEP ${i + 1}</span>
              <button type="button" class="link-btn danger" data-act="del-step" data-i="${i}">このSTEPを消す</button>
            </div>
            <label class="field"><span class="label">STEPの名前</span>${inp(`steps.${i}.title`, st.title)}</label>
            <ol class="se-items">
              ${st.items.map((it, j) => `
                <li class="se-item">
                  <div class="se-item-row">
                    ${inp(`steps.${i}.items.${j}.time`, it.time, 'class="se-time" placeholder="19:30" aria-label="時間"')}
                    ${inp(`steps.${i}.items.${j}.title`, it.title, 'placeholder="やること" aria-label="やること"')}
                  </div>
                  ${inp(`steps.${i}.items.${j}.sub`, it.sub, 'placeholder="場所・メモ" aria-label="場所・メモ"')}
                  <div class="se-item-foot">
                    <label class="check"><input type="checkbox" data-path="steps.${i}.items.${j}.hl" ${it.hl ? 'checked' : ''}> 黄色で目立たせる</label>
                    <span>
                      <button type="button" class="mini-btn" data-act="up" data-i="${i}" data-j="${j}" ${j === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
                      <button type="button" class="mini-btn" data-act="down" data-i="${i}" data-j="${j}" ${j === st.items.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
                      <button type="button" class="mini-btn danger" data-act="del-item" data-i="${i}" data-j="${j}">消す</button>
                    </span>
                  </div>
                </li>`).join('')}
            </ol>
            <button type="button" class="add-btn" data-act="add-item" data-i="${i}">＋ 予定を追加</button>
          </section>`).join('')}
        <button type="button" class="add-btn add-step" data-act="add-step">＋ STEPを追加</button>

        <section class="se-card">
          <div class="se-card-head"><span class="step">STEP ${s.steps.length + 1}</span><b>ポイント</b></div>
          <label class="field"><span class="label">ひとこと</span>${inp('spotsNote', s.spotsNote)}</label>
          ${s.spots.map((p, k) => `
            <div class="se-spot">
              <div class="se-spot-no">${SPOT_GEO[p.id].no}</div>
              <div class="se-spot-fields">
                <label class="field"><span class="label">名前</span>${inp(`spots.${k}.name`, p.name)}</label>
                <label class="field"><span class="label">メモ</span>${inp(`spots.${k}.note`, p.note)}</label>
                <div class="se-2col">
                  <label class="field"><span class="label">タグ</span>${inp(`spots.${k}.tag`, p.tag)}</label>
                  <label class="field"><span class="label">タグの色</span>
                    <select data-path="spots.${k}.tagType">${TAG_TYPES.map((t) => `<option value="${t.id}" ${p.tagType === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}</select>
                  </label>
                </div>
                <div class="se-2col">
                  <label class="field"><span class="label">釣れそうな魚</span>${inp(`spots.${k}.fish`, p.fish)}</label>
                  <label class="field"><span class="label">目印・釣り方</span>${inp(`spots.${k}.hint`, p.hint)}</label>
                </div>
              </div>
            </div>`).join('')}
        </section>

        <section class="se-card">
          <label class="field"><span class="label">GOAL</span>${inp('goal', s.goal)}</label>
        </section>
      </div>`;
    bar.innerHTML = `
      <button type="button" class="chip-btn sched-cancel" id="cancel-btn">やめる</button>
      <button type="button" class="fab sched-fab" id="save-btn">保存する</button>`;
  }

  // 入力欄 → draft
  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = value;
  }
  function collect() {
    root.querySelectorAll('[data-path]').forEach((el) => {
      const path = el.dataset.path;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (path === 'targets') v = v.split(/[、,]/).map((x) => x.trim()).filter(Boolean);
      setPath(draft, path, v);
    });
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !editing) return;
    collect();
    const i = Number(b.dataset.i);
    const j = Number(b.dataset.j);
    const items = draft.steps[i] && draft.steps[i].items;
    switch (b.dataset.act) {
      case 'add-item': items.push({ time: '', title: '', sub: '', hl: false }); break;
      case 'del-item': items.splice(j, 1); break;
      case 'up': [items[j - 1], items[j]] = [items[j], items[j - 1]]; break;
      case 'down': [items[j + 1], items[j]] = [items[j], items[j + 1]]; break;
      case 'add-step': draft.steps.push({ title: '', items: [{ time: '', title: '', sub: '', hl: false }] }); break;
      case 'del-step':
        if (!confirm(`STEP ${i + 1} を消しますか？`)) return;
        draft.steps.splice(i, 1);
        break;
      default: return;
    }
    renderEdit();
  });

  bar.addEventListener('click', async (e) => {
    const id = e.target.closest('button') && e.target.closest('button').id;
    if (id === 'edit-btn') {
      editing = true;
      draft = JSON.parse(JSON.stringify(schedule));
      renderEdit();
      window.scrollTo(0, 0);
    } else if (id === 'cancel-btn') {
      editing = false;
      renderView();
    } else if (id === 'save-btn') {
      collect();
      const btn = e.target.closest('button');
      btn.disabled = true;
      btn.textContent = '保存しています…';
      try {
        const next = normalizeSchedule(draft);
        await store.setKV('schedule', next);
        schedule = next;
        editing = false;
        renderView();
        window.scrollTo(0, 0);
        toast('スケジュールを保存しました');
      } catch (ex) {
        console.error(ex);
        toast('保存できませんでした(Supabase のアップデートSQLは実行済み？)');
        btn.disabled = false;
        btn.textContent = '保存する';
      }
    }
  });

  async function load() {
    try {
      schedule = normalizeSchedule(await store.getKV('schedule'));
    } catch (ex) {
      console.error(ex);
    }
    if (!editing) renderView();
  }

  window.addEventListener('beforeunload', (e) => { if (editing) e.preventDefault(); });

  renderView();
  store.subscribe((what) => { if (what === 'kv' || what === 'all') load(); });
  load();
})();
