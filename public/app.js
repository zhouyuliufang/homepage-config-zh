'use strict';

/* ============ 基础工具 ============ */
const TOKEN_KEY = 'hcz_token';
const state = { token: '', files: [], current: null, data: null, raw: '', tab: 'visual' };

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function toast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  setTimeout(() => { t.className = 'toast hidden'; }, 2600);
}

function setStatus(msg, ok) {
  const s = document.getElementById('save-status');
  s.textContent = msg;
  s.style.color = ok === false ? 'var(--danger)' : (ok === true ? 'var(--ok)' : 'var(--muted)');
}

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token && state.token !== 'open') headers['x-auth-token'] = state.token;
  const res = await fetch('/api/' + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let json = {};
  try { json = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));
  return json;
}

/* ============ 鉴权 ============ */
async function checkHealth() {
  const h = await api('GET', 'health');
  return h.auth;
}

async function doLogin() {
  const pwd = document.getElementById('login-password').value;
  try {
    const r = await api('POST', 'login', { password: pwd });
    state.token = r.token;
    localStorage.setItem(TOKEN_KEY, r.token);
    document.getElementById('login').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    await loadApp();
  } catch (e) {
    const err = document.getElementById('login-error');
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}

async function verifyToken() {
  try { await api('GET', 'files'); return true; }
  catch (e) { return false; }
}

/* ============ 应用初始化 ============ */
async function init() {
  const loginBtn = document.getElementById('login-btn');
  loginBtn.addEventListener('click', doLogin);
  document.getElementById('login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('refresh-btn').addEventListener('click', loadFiles);
  document.getElementById('new-file-btn').addEventListener('click', newFile);

  let requiresAuth = false;
  try { requiresAuth = await checkHealth(); } catch (e) {}
  state.token = localStorage.getItem(TOKEN_KEY) || '';

  if (requiresAuth && !state.token) { showLogin(); return; }
  if (state.token && state.token !== 'open') {
    const ok = await verifyToken();
    if (!ok) { showLogin(); return; }
  }
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  await loadApp();
}

function showLogin() {
  document.getElementById('login').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-password').focus();
}

async function loadApp() {
  setStatus('');
  await loadFiles();
}

async function loadFiles() {
  try {
    const r = await api('GET', 'files');
    state.files = r.files;
    renderFileList();
    setStatus('已加载 ' + r.files.length + ' 个配置文件');
  } catch (e) {
    toast('加载文件失败：' + e.message, 'err');
  }
}

const FILE_META = {
  'services.yaml': { label: '服务配置', desc: '分组 / 服务 / 小部件', type: 'services' },
  'settings.yaml': { label: '全局设置', desc: '标题 / 主题 / 布局 / 语言', type: 'settings' },
  'bookmarks.yaml': { label: '书签', desc: '分组 / 书签链接', type: 'bookmarks' },
  'widgets.yaml': { label: '信息小部件', desc: '页眉信息组件（天气/时间等）', type: 'generic' },
  'docker.yaml': { label: 'Docker 配置', desc: 'Docker 实例连接设置', type: 'generic' }
};

function renderFileList() {
  const ul = document.getElementById('file-list');
  ul.innerHTML = '';
  if (state.files.length === 0) {
    ul.appendChild(el('li', { class: 'muted' }, '（目录为空，请新建配置文件）'));
    return;
  }
  for (const f of state.files) {
    const meta = FILE_META[f.name] || { label: f.name, desc: '自定义配置', type: 'generic' };
    const li = el('li', { 'data-name': f.name, onclick: () => openFile(f.name) },
      el('span', { class: 'fn' }, meta.label + ' · ' + f.name),
      el('span', { class: 'fd' }, meta.desc + '　' + prettySize(f.size))
    );
    if (state.current === f.name) li.classList.add('active');
    ul.appendChild(li);
  }
}

function prettySize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

/* ============ 打开文件 ============ */
async function openFile(name) {
  try {
    setStatus('加载中…');
    const r = await api('GET', 'file/' + encodeURIComponent(name));
    state.current = name;
    state.raw = r.content || '';
    state.data = (r.parseError || r.content.trim() === '') ? null : r.parsed;
    if (r.parseError) toast('YAML 解析有误（仍可原始编辑）：' + r.parseError, 'err');
    state.tab = 'visual';
    renderFileList();
    renderEditor();
    setStatus('');
  } catch (e) {
    toast('打开失败：' + e.message, 'err');
  }
}

function currentType() {
  const meta = FILE_META[state.current];
  return meta ? meta.type : 'generic';
}

function renderEditor() {
  const editor = document.getElementById('editor');
  editor.innerHTML = '';
  const meta = FILE_META[state.current] || { label: state.current, desc: '自定义配置文件', type: 'generic' };

  const tabs = el('div', { class: 'tabs' },
    el('div', { class: 'tab' + (state.tab === 'visual' ? ' active' : ''), onclick: () => { state.tab = 'visual'; renderEditor(); } }, '可视化编辑'),
    el('div', { class: 'tab' + (state.tab === 'raw' ? ' active' : ''), onclick: () => { state.tab = 'raw'; renderEditor(); } }, '原始 YAML')
  );

  const actions = el('div', { class: 'file-header-actions' },
    el('button', { class: 'btn small ok', onclick: saveCurrent }, '保存（自动备份）'),
    el('button', { class: 'btn small ghost', onclick: showBackups }, '历史备份')
  );

  const header = el('div', { class: 'file-header' },
    el('div', {},
      el('h2', {}, meta.label),
      el('div', { class: 'desc' }, state.current + '　·　' + meta.desc)
    ),
    actions
  );
  editor.appendChild(header);
  editor.appendChild(tabs);

  const body = el('div', {});
  editor.appendChild(body);

  if (state.tab === 'raw') { renderRaw(body); return; }

  const type = currentType();
  if (type === 'services') renderGroupTree(body, ensureArray(state.data), SERVICE_OPTS, '服务');
  else if (type === 'bookmarks') renderGroupTree(body, ensureArray(state.data), BOOKMARK_OPTS, '书签');
  else if (type === 'settings') renderSettings(body, state.data && typeof state.data === 'object' ? state.data : {});
  else renderGeneric(body, state.data);
}

function ensureArray(d) { return Array.isArray(d) ? d : []; }

/* ============ 分组树编辑器（服务 / 书签共用） ============ */
const SERVICE_OPTS = {
  label: '服务',
  fields: [
    { k: 'href', label: '链接地址', type: 'text', hint: '点击卡片跳转的 URL，如 http://<服务IP>:<端口>' },
    { k: 'icon', label: '图标', type: 'text', hint: '图标文件名（emby.png）或前缀图标 mdi-xxx / si-xxx / sh-xxx' },
    { k: 'description', label: '描述', type: 'text', hint: '服务说明文字' },
    { k: 'ping', label: 'Ping 主机', type: 'text', hint: '用 ICMP 监测主机存活（填主机名/IP）' },
    { k: 'siteMonitor', label: '站点监测', type: 'text', hint: '用 HTTP 监测 URL 可用性并显示响应时间' },
    { k: 'server', label: 'Docker 服务器', type: 'text', hint: 'docker.yaml 中定义的实例名' },
    { k: 'container', label: '容器名', type: 'text', hint: '要关联的容器名称（显示 CPU/内存等状态）' },
    { k: 'sort', label: '排序权重', type: 'number', hint: '数字越小越靠前' }
  ],
  boolFields: [
    { k: 'showStats', label: '默认展开容器状态' }
  ],
  selectFields: [
    { k: 'statusStyle', label: '状态样式', options: [['', '默认（显示响应时间/状态）'], ['dot', '圆点（绿点表示正常）'], ['basic', '文字（UP / DOWN）']] }
  ],
  enableWidgets: true
};

const BOOKMARK_OPTS = {
  label: '书签',
  fields: [
    { k: 'abbr', label: '缩写', type: 'text', hint: '默认显示 2 个字母，如 GH' },
    { k: 'icon', label: '图标', type: 'text', hint: '图标文件名或前缀图标；与缩写二选一，图标优先' },
    { k: 'href', label: '链接地址', type: 'text', hint: '书签目标 URL' },
    { k: 'description', label: '描述', type: 'text', hint: '鼠标悬停说明，默认显示主机名' }
  ],
  boolFields: [], selectFields: [], enableWidgets: false
};

function renderGroupTree(container, data, opts, itemLabel) {
  // data: [ { groupName: [ {itemName: fieldsObj}, ... ] }, ... ]
  const wrap = el('div', {});
  data.forEach((group, gi) => {
    const gName = Object.keys(group)[0];
    const items = Array.isArray(group[gName]) ? group[gName] : [];
    const card = el('div', { class: 'card group-card' });

    const nameInput = el('input', { class: 'group-name', value: gName });
    nameInput.addEventListener('input', () => {
      const newName = nameInput.value.trim();
      if (newName && newName !== gName) {
        const moved = { [newName]: group[gName] };
        data[gi] = moved;
      }
    });
    const head = el('div', { class: 'group-head' },
      nameInput,
      el('button', { class: 'btn small danger', onclick: () => { data.splice(gi, 1); renderEditor(); } }, '删除分组')
    );
    card.appendChild(el('div', { class: 'card-title' }, '📁 分组 ' + (gi + 1), el('span', { class: 'tag' }, items.length + ' 项')));
    card.appendChild(head);

    items.forEach((item, ii) => {
      const iName = Object.keys(item)[0];
      const fields = item[iName] && typeof item[iName] === 'object' ? item[iName] : {};
      card.appendChild(renderItemCard(item, iName, fields, opts, () => { renderEditor(); }, itemLabel));
    });

    card.appendChild(el('button', { class: 'btn small ghost', onclick: () => {
      items.push({ ['新' + itemLabel]: { href: '' } }); renderEditor();
    } }, '＋ 添加' + itemLabel));
    wrap.appendChild(card);
  });

  wrap.appendChild(el('button', { class: 'btn', onclick: () => {
    data.push({ '新分组': [{ ['新' + itemLabel]: { href: '' } }] }); renderEditor();
  } }, '＋ 添加分组'));

  container.appendChild(wrap);
}

function renderItemCard(item, iName, fields, opts, rerender, itemLabel) {
  const card = el('div', { class: 'service-item' });
  const nameInput = el('input', { class: 'svc-name', value: iName });
  nameInput.addEventListener('input', () => {
    const n = nameInput.value.trim();
    if (n && n !== iName) { const v = item[iName]; delete item[iName]; item[n] = v; }
  });
  const head = el('div', { class: 'service-head' },
    nameInput,
    el('button', { class: 'btn small danger', onclick: () => { deleteByName(item, iName); rerender(); } }, '删除')
  );
  card.appendChild(head);

  // 基础字段
  for (const f of opts.fields) {
    card.appendChild(renderField(fields, f.k, f));
  }
  for (const b of (opts.boolFields || [])) {
    card.appendChild(renderBool(fields, b.k, b.label));
  }
  for (const s of (opts.selectFields || [])) {
    card.appendChild(renderSelect(fields, s.k, s.label, s.options));
  }

  // 小部件（仅服务）
  if (opts.enableWidgets) {
    card.appendChild(renderWidgetsBlock(fields, rerender));
  }
  return card;
}

// 由于分组树渲染时 item 的父数组引用丢失，删除改用全局搜索
function deleteByName(targetItem, name) {
  // 在 state.data 中查找包含 targetItem 的分组并移除
  const data = ensureArray(state.data);
  for (const group of data) {
    const gName = Object.keys(group)[0];
    const items = group[gName];
    if (Array.isArray(items)) {
      const idx = items.findIndex(it => it === targetItem);
      if (idx >= 0) { items.splice(idx, 1); return; }
    }
  }
}

function renderField(obj, key, f) {
  const val = obj[key] != null ? obj[key] : '';
  const input = el('input', { type: f.type || 'text', value: val });
  input.addEventListener('input', () => {
    if (f.type === 'number') obj[key] = input.value === '' ? '' : Number(input.value);
    else obj[key] = input.value;
    if (input.value === '') delete obj[key];
  });
  return el('div', { class: 'field' },
    el('label', {}, f.label),
    input,
    f.hint ? el('div', { class: 'hint' }, f.hint) : null
  );
}

function renderBool(obj, key, label) {
  const wrap = el('label', { style: 'display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;cursor:pointer' });
  const cb = el('input', { type: 'checkbox' });
  cb.checked = obj[key] === true;
  cb.addEventListener('change', () => {
    if (cb.checked) obj[key] = true; else delete obj[key];
  });
  wrap.appendChild(cb);
  wrap.appendChild(document.createTextNode(label));
  return el('div', { class: 'field' }, wrap);
}

function renderSelect(obj, key, label, options) {
  const sel = el('select', {});
  for (const [v, t] of options) sel.appendChild(el('option', { value: v }, t));
  sel.value = obj[key] != null ? obj[key] : '';
  sel.addEventListener('change', () => {
    if (sel.value === '') delete obj[key]; else obj[key] = sel.value;
  });
  return el('div', { class: 'field' }, el('label', {}, label), sel);
}

/* ---- 小部件编辑 ---- */
function normalizeWidgets(fields) {
  // 统一为数组 widgets:[...]，便于编辑
  if (Array.isArray(fields.widgets)) return fields.widgets;
  if (fields.widget && typeof fields.widget === 'object') return [fields.widget];
  return [];
}

function renderWidgetsBlock(fields, rerender) {
  const block = el('div', {});
  block.appendChild(el('div', { class: 'sub-title' }, '🔌 关联小部件（显示服务状态/数据）'));
  const widgets = normalizeWidgets(fields);

  widgets.forEach((w, wi) => {
    const item = el('div', { class: 'widget-item' });
    const typeInput = el('input', { class: 'wtype', value: w.type || '', placeholder: '类型，如 plex / sonarr / ollama' });
    typeInput.addEventListener('input', () => { w.type = typeInput.value; });
    const head = el('div', { class: 'widget-head' },
      typeInput,
      el('button', { class: 'btn small danger', onclick: () => { widgets.splice(wi, 1); rebuildWidgets(fields, widgets); rerender(); } }, '删除')
    );
    item.appendChild(head);

    const common = [
      { k: 'url', label: '服务地址' },
      { k: 'key', label: 'API 密钥 / Key' },
      { k: 'username', label: '用户名' },
      { k: 'password', label: '密码' },
      { k: 'refreshInterval', label: '刷新间隔(秒)' }
    ];
    for (const c of common) {
      const v = w[c.k] != null ? w[c.k] : '';
      const inp = el('input', { type: 'text', value: v });
      inp.addEventListener('input', () => { if (inp.value === '') delete w[c.k]; else w[c.k] = inp.value; });
      item.appendChild(el('div', { class: 'field', style: 'margin-bottom:6px' }, el('label', { style: 'font-size:11px' }, c.label), inp));
    }

    // 其他自定义参数
    const extra = Object.keys(w).filter(k => !['type', 'url', 'key', 'username', 'password', 'refreshInterval'].includes(k));
    if (extra.length) {
      item.appendChild(el('div', { class: 'hint', style: 'margin:4px 0' }, '其他参数：'));
      extra.forEach(k => {
        const v = w[k] != null ? w[k] : '';
        const inp = el('input', { type: 'text', value: v });
        inp.addEventListener('input', () => { if (inp.value === '') delete w[k]; else w[k] = inp.value; });
        item.appendChild(el('div', { class: 'kv-row' },
          el('input', { class: 'k', value: k, readonly: 'readonly' }), inp));
      });
    }
    block.appendChild(item);
  });

  block.appendChild(el('button', { class: 'btn small ghost', onclick: () => {
    widgets.push({ type: '' }); rebuildWidgets(fields, widgets); rerender();
  } }, '＋ 添加小部件'));
  return block;
}

function rebuildWidgets(fields, widgets) {
  delete fields.widget;
  if (widgets.length === 1) fields.widget = widgets[0];
  else if (widgets.length > 1) fields.widgets = widgets;
  else delete fields.widgets;
}

/* ============ 设置表单 ============ */
const SETTINGS_FIELDS = [
  { k: 'title', label: '页面标题', type: 'text' },
  { k: 'description', label: '页面描述', type: 'text' },
  { k: 'favicon', label: '自定义图标 URL', type: 'text', hint: '留空使用默认' },
  { k: 'background', label: '背景图', type: 'text', hint: '图片 URL 或 /images/xxx.png；如需模糊/透明度等高级选项请用“原始 YAML”' },
  { k: 'cardBlur', label: '卡片模糊', type: 'text', hint: '如 xs / sm / md / xl' },
  { k: 'language', label: '界面语言', type: 'select', options: [['', '默认(英文)'], ['zh-Hans', '简体中文'], ['zh-Hant', '繁体中文'], ['en', 'English'], ['ja', '日本語']] },
  { k: 'theme', label: '主题', type: 'select', options: [['', '跟随系统'], ['dark', '深色'], ['light', '浅色']] },
  { k: 'color', label: '配色', type: 'select', options: [['', '默认'], ['slate','slate'],['gray','gray'],['zinc','zinc'],['neutral','neutral'],['stone','stone'],['amber','amber'],['yellow','yellow'],['lime','lime'],['green','green'],['emerald','emerald'],['teal','teal'],['cyan','cyan'],['sky','sky'],['blue','blue'],['indigo','indigo'],['violet','violet'],['purple','purple'],['fuchsia','fuchsia'],['pink','pink'],['rose','rose'],['red','red'],['white','white']] },
  { k: 'headerStyle', label: '页眉样式', type: 'select', options: [['', '默认(下划线)'], ['boxed', '方框'], ['clean', '简洁'], ['boxedWidgets', '方框+小部件']] },
  { k: 'statusStyle', label: '状态样式', type: 'select', options: [['', '默认'], ['dot', '圆点'], ['basic', '文字(UP/DOWN)']] },
  { k: 'bookmarksStyle', label: '书签样式', type: 'select', options: [['', '默认'], ['icons', '仅图标']] },
  { k: 'iconStyle', label: '图标风格', type: 'select', options: [['', '默认(渐变)'], ['gradient', '渐变'], ['theme', '主题色']] }
];
const SETTINGS_BOOL = [
  { k: 'showStats', label: '默认展开容器状态' },
  { k: 'hideVersion', label: '隐藏版本号' },
  { k: 'disableUpdateCheck', label: '禁用更新检查' },
  { k: 'disableCollapse', label: '禁用分组折叠' }
];

function renderSettings(container, data) {
  const known = new Set([...SETTINGS_FIELDS.map(f => f.k), ...SETTINGS_BOOL.map(b => b.k)]);
  const wrap = el('div', {});
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card-title' }, '⚙️ 全局设置'));

  // 字段两列布局
  const grid = el('div', { class: 'row', style: 'flex-wrap:wrap' });
  for (const f of SETTINGS_FIELDS) {
    const cell = el('div', { class: 'field', style: 'flex:1 1 45%;min-width:240px' });
    cell.appendChild(el('label', {}, f.label));
    if (f.type === 'select') {
      const sel = el('select', {});
      for (const [v, t] of f.options) sel.appendChild(el('option', { value: v }, t));
      sel.value = data[f.k] != null ? data[f.k] : '';
      sel.addEventListener('change', () => { if (sel.value === '') delete data[f.k]; else data[f.k] = sel.value; });
      cell.appendChild(sel);
    } else {
      const inp = el('input', { type: 'text', value: data[f.k] != null ? data[f.k] : '' });
      inp.addEventListener('input', () => { if (inp.value === '') delete data[f.k]; else data[f.k] = inp.value; });
      cell.appendChild(inp);
    }
    if (f.hint) cell.appendChild(el('div', { class: 'hint' }, f.hint));
    grid.appendChild(cell);
  }
  card.appendChild(grid);

  const boolWrap = el('div', { class: 'row', style: 'flex-wrap:wrap;margin-top:8px' });
  for (const b of SETTINGS_BOOL) {
    const lab = el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;cursor:pointer;margin-right:18px' });
    const cb = el('input', { type: 'checkbox' });
    cb.checked = data[b.k] === true;
    cb.addEventListener('change', () => { if (cb.checked) data[b.k] = true; else delete data[b.k]; });
    lab.appendChild(cb); lab.appendChild(document.createTextNode(b.label));
    boolWrap.appendChild(lab);
  }
  card.appendChild(boolWrap);
  wrap.appendChild(card);

  // 其他对象型配置（layout / providers / quicklaunch 等）
  const others = Object.keys(data).filter(k => !known.has(k) && typeof data[k] === 'object' && data[k] !== null);
  if (others.length) {
    const oc = el('div', { class: 'card' });
    oc.appendChild(el('div', { class: 'card-title' }, '🧩 高级对象配置（layout / providers / quicklaunch 等）'));
    oc.appendChild(el('div', { class: 'hint', style: 'margin-bottom:8px' }, '以下为结构较复杂的配置对象，可用原始 YAML 标签页更直观地编辑。'));
    for (const k of others) {
      oc.appendChild(el('div', { class: 'sub-title' }, k));
      oc.appendChild(renderNode(data[k], k, (nv) => { if (nv === undefined) delete data[k]; else data[k] = nv; }, null, 0));
    }
    wrap.appendChild(oc);
  }
  container.appendChild(wrap);
}

/* ============ 通用递归编辑器（widgets.yaml / docker.yaml / 未知文件） ============ */
function renderGeneric(container, data) {
  const wrap = el('div', {});
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card-title' }, '📦 结构编辑', el('span', { class: 'tag' }, '适用于小部件 / Docker / 自定义配置')));
  card.appendChild(el('div', { class: 'hint', style: 'margin-bottom:8px' }, '此文件以通用结构编辑器呈现；如需精确控制格式，请切换到“原始 YAML”标签。'));
  if (data === null || data === undefined) {
    card.appendChild(el('div', { class: 'muted' }, '文件为空。'));
  } else {
    card.appendChild(renderNode(data, '(根)', (nv) => { state.data = nv; }, null, 0));
  }
  wrap.appendChild(card);
  container.appendChild(wrap);
}

function renderNode(value, keyName, onChange, onRemove, depth) {
  const node = el('div', { class: 'node' });
  const isArr = Array.isArray(value);
  const isObj = value && typeof value === 'object' && !isArr;

  // 头部：键名 + 类型 + 删除
  const head = el('div', { class: 'node-key' });
  if (keyName && keyName !== '(根)') {
    const kInput = el('input', { value: keyName, style: 'font-weight:600' });
    kInput.addEventListener('change', () => { /* 键名修改需父级处理，简化：忽略重命名 */ });
    head.appendChild(kInput);
  }
  head.appendChild(el('span', { class: 'tag' }, isArr ? '数组' : isObj ? '对象' : typeof value));
  if (onRemove) {
    head.appendChild(el('button', { class: 'btn small danger', onclick: () => onRemove() }, '删除'));
  }
  node.appendChild(head);

  const children = el('div', { class: 'node-children' });

  if (isObj) {
    for (const k of Object.keys(value)) {
      children.appendChild(renderNode(value[k], k,
        (nv) => { if (nv === undefined) delete value[k]; else value[k] = nv; },
        null, depth + 1));
    }
    children.appendChild(el('button', { class: 'btn small ghost', onclick: () => {
      const nk = prompt('新字段名：'); if (!nk) return; value[nk] = ''; onChange(value); rerenderCurrent();
    } }, '＋ 添加字段'));
  } else if (isArr) {
    value.forEach((item, i) => {
      children.appendChild(renderNode(item, '[' + i + ']',
        (nv) => { if (nv === undefined) value.splice(i, 1); else value[i] = nv; },
        () => { value.splice(i, 1); onChange(value); rerenderCurrent(); }, depth + 1));
    });
    children.appendChild(el('button', { class: 'btn small ghost', onclick: () => {
      const t = prompt('新元素类型：1=对象 2=数组 3=文本', '1');
      if (t === '2') value.push([]); else if (t === '3') value.push(''); else value.push({});
      onChange(value); rerenderCurrent();
    } }, '＋ 添加元素'));
  } else {
    const inp = el('input', { type: 'text', value: value == null ? '' : value });
    inp.addEventListener('input', () => {
      const v = inp.value;
      if (v === 'true') value = true; else if (v === 'false') value = false;
      else if (v !== '' && !isNaN(Number(v))) value = Number(v);
      else value = v;
      onChange(value);
    });
    children.appendChild(inp);
  }

  node.appendChild(children);
  return node;
}

function rerenderCurrent() { renderEditor(); }

/* ============ 原始 YAML 编辑 ============ */
function renderRaw(body) {
  const ta = el('textarea', { spellcheck: 'false', style: 'min-height:520px;font-size:13px' });
  ta.value = state.raw;
  body.appendChild(el('div', { class: 'card' },
    el('div', { class: 'card-title' }, '📝 原始 YAML', el('span', { class: 'tag' }, state.current)),
    ta,
    el('div', { class: 'hint', style: 'margin-top:6px' }, '直接编辑 YAML 文本，保存时进行语法校验并自动备份。')
  ));
  state._rawTextarea = ta;
}

/* ============ 保存 ============ */
async function saveCurrent() {
  try {
    setStatus('保存中…');
    let body;
    if (state.tab === 'raw') {
      const content = state._rawTextarea.value;
      body = { content, mode: 'raw' };
    } else {
      body = { data: state.data, mode: 'structured' };
    }
    const r = await api('PUT', 'file/' + encodeURIComponent(state.current), body);
    if (state.tab === 'raw') state.raw = state._rawTextarea.value;
    setStatus('✓ 已保存（已自动备份）', true);
    toast('保存成功，已生成备份', 'ok');
  } catch (e) {
    setStatus('✗ 保存失败', false);
    toast('保存失败：' + e.message, 'err');
  }
}

/* ============ 备份 ============ */
async function showBackups() {
  try {
    const r = await api('GET', 'backups/' + encodeURIComponent(state.current));
    const editor = document.getElementById('editor');
    const list = el('ul', { class: 'backup-list' });
    if (r.backups.length === 0) list.appendChild(el('li', { class: 'muted' }, '暂无备份'));
    for (const b of r.backups) {
      list.appendChild(el('li', {},
        el('span', {}, b),
        el('button', { class: 'btn small ok', onclick: async () => {
          if (!confirm('确定恢复到备份：' + b + ' ？当前内容将被备份后再覆盖。')) return;
          try {
            await api('POST', 'restore/' + encodeURIComponent(state.current) + '/' + encodeURIComponent(b), {});
            toast('已恢复：' + b, 'ok');
            await openFile(state.current);
          } catch (e) { toast('恢复失败：' + e.message, 'err'); }
        } }, '恢复')
      ));
    }
    const modal = el('div', { class: 'card', style: 'position:fixed;top:80px;left:50%;transform:translateX(-50%);width:520px;max-height:70vh;overflow:auto;z-index:50' },
      el('div', { class: 'card-title' }, '🕑 历史备份 · ' + state.current, el('span', { class: 'tag' }, r.backups.length + ' 份')),
      list,
      el('div', { style: 'text-align:right;margin-top:10px' }, el('button', { class: 'btn small ghost', onclick: () => modal.remove() }, '关闭'))
    );
    document.body.appendChild(modal);
  } catch (e) {
    toast('读取备份失败：' + e.message, 'err');
  }
}

/* ============ 新建文件 ============ */
async function newFile() {
  const name = prompt('请输入配置文件名（以 .yaml 结尾，如 myconfig.yaml）：');
  if (!name) return;
  if (!/^[A-Za-z0-9._-]+\.ya?ml$/.test(name)) { toast('文件名不合法', 'err'); return; }
  try {
    await api('PUT', 'file/' + encodeURIComponent(name), { content: '# ' + name + '\n', mode: 'raw' });
    await loadFiles();
    await openFile(name);
    toast('已创建 ' + name, 'ok');
  } catch (e) { toast('创建失败：' + e.message, 'err'); }
}

window.addEventListener('DOMContentLoaded', init);
