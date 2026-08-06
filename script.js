const navItems = document.querySelectorAll('.nav-item');
const pageContent = document.getElementById('pageContent');

// ========== 页面内容映射 ==========
const pageData = {
  game: {
    content: `<div class="game-layout">
          <div class="board-wrapper">
            <button class="btn-random-fill" id="randomFillBtn">随机填入</button>
            <button class="btn-clear-board" id="clearBoardBtn">重置棋盘</button>
            <button class="btn-gen-map" id="genMapBtn">生成地图</button>
            <div class="board">${'<div class="cell"></div>'.repeat(25)}</div>
          </div>
          <aside class="cell-settings-panel">
            <div class="panel-header">
              <h3>单元格设置</h3>
              <button class="btn-add-format">添加格式</button>
            </div>
            <div id="formatList" class="format-list"></div>
          </aside>
          <div id="mp-team-panel" class="mp-team-panel"></div>
        </div>`
  },
  music: {
    content: `<div class="music-page">
        <div class="music-search-bar">
          <input type="text" id="musicSearchInput" placeholder="搜索曲目名称..." />
          <button class="btn-save-preset" id="savePresetBtn">保存</button>
          <div class="preset-dropdown-wrapper">
            <button class="preset-trigger" id="presetTrigger">预设 ▾</button>
            <div id="presetDropdown" class="preset-dropdown-menu"></div>
          </div>
          <button class="btn-filter-toggle" id="filterToggleBtn" title="筛选">⚙ 筛选</button>
          <div id="filterDropdown" class="filter-dropdown">
            <div class="filter-section">
              <div class="filter-label">定数筛选
                <label class="filter-enable"><input type="checkbox" id="filterLevelEnable" /> 启用</label>
              </div>
              <div class="level-range">
                <select id="filterLevelFrom"></select>
                <span class="level-separator">~</span>
                <select id="filterLevelTo"></select>
              </div>
            </div>
            <div class="filter-section">
              <div class="filter-label">难度筛选</div>
              <div class="filter-checkboxes" id="filterDiffCheckboxes"></div>
            </div>
          </div>
        </div>
        <div class="music-meta-bar">
          <div class="bulk-checks-group" id="bulkChecksGroup"></div>
          <div id="musicPagination" class="music-pagination"></div>
        </div>
        <div id="musicList" class="music-list"></div>
        <span id="musicCount" class="music-count"></span>
      </div>`
  },
  settings: {
    content: `<div class="settings-page">
        <div class="settings-section">
          <label class="settings-label">曲库选择</label>
          <select id="librarySelect" class="settings-select">
            <option value="maimai">maimai (舞萌)</option>
            <option value="arcaea">Arcaea (韵律源点)</option>
          </select>
        </div>
        <button class="btn-clear-cache" id="clearCacheBtn">清空缓存</button>
        <a class="project-link" href="https://github.com/Mizuki-OvO/maimai-bingo-web" target="_blank">项目地址</a>
      </div>`
      },
      multiplayer: {
        content: `<div class="mp-page"><div id="mp-container"></div></div><input type="text" id="mp-room-code-hidden" style="display:none;">`
      }
};

// ========== 数据存储 ==========
let formatDataList = [];
let cellData = new Array(25).fill(-1);
let mapData = new Array(25).fill(null);
let cellLocked = new Array(25).fill(false);
let editingIndex = -1;
let selectedCellIndex = -1;

const LIBRARY_CONFIG = {
  maimai: { coverBase: 'music_data/maimai/pictures/', diffNames: ['BAS', 'ADV', 'EXP', 'MAS', 'ReM'], dataVar: 'MAIMAI_MUSIC_DATA' },
  arcaea: { coverBase: 'music_data/arcaea/pictures/', diffNames: ['PST', 'PRS', 'FTR', 'BYD', 'ETR'], dataVar: 'ARC_MUSIC_DATA' }
};
let currentLibrary = localStorage.getItem('maimai_bingo_library') || 'maimai';
let COVER_BASE = LIBRARY_CONFIG[currentLibrary].coverBase;
let DIFF_NAMES = LIBRARY_CONFIG[currentLibrary].diffNames;

const CACHE_KEY_FORMAT     = 'maimai_bingo_format_list';
const CACHE_KEY_CELL       = 'maimai_bingo_cell_data';
const CACHE_KEY_MAP_DATA   = 'maimai_bingo_map_data';
const CACHE_KEY_CELL_LOCKED = 'maimai_bingo_cell_locked';

function getMusicData() { const cfg = LIBRARY_CONFIG[currentLibrary]; return cfg ? window[cfg.dataVar] : null; }

function safeFileName(title) {
  return title.replace("/", "／").replace("\\", "＼").replace(":", "：")
              .replace("*", "＊").replace("?", "？").replace('"', "＂")
              .replace("<", "＜").replace(">", "＞").replace("|", "｜");
}

function saveToCache() {
  try {
    localStorage.setItem(CACHE_KEY_FORMAT, JSON.stringify(formatDataList));
    localStorage.setItem(CACHE_KEY_CELL,   JSON.stringify(cellData));
    localStorage.setItem(CACHE_KEY_MAP_DATA, JSON.stringify(mapData));
    localStorage.setItem(CACHE_KEY_CELL_LOCKED, JSON.stringify(cellLocked));
    localStorage.setItem('maimai_bingo_song_diffs', JSON.stringify([...selectedSongDiffs]));
    localStorage.setItem('maimai_bingo_bulk_checks', JSON.stringify(bulkCheckStates));
  } catch (e) {}
}

/**
 * 联机模式：房主将当前完整状态广播到房间
 */
function emitStateToRoom() {
  if (typeof window.emitCurrentState === 'function') {
    window.emitCurrentState();
  }
}

function loadFromCache() {
  try {
    const fmt = localStorage.getItem(CACHE_KEY_FORMAT);
    const cel = localStorage.getItem(CACHE_KEY_CELL);
    const md  = localStorage.getItem(CACHE_KEY_MAP_DATA);
    const cl  = localStorage.getItem(CACHE_KEY_CELL_LOCKED);
    const sd  = localStorage.getItem('maimai_bingo_song_diffs');
    const bc  = localStorage.getItem('maimai_bingo_bulk_checks');
    if (fmt) formatDataList = JSON.parse(fmt);
    if (cel) cellData = JSON.parse(cel);
    if (md)  mapData = JSON.parse(md);
    if (cl)  cellLocked = JSON.parse(cl);
    if (sd)  selectedSongDiffs = new Set(JSON.parse(sd));
    if (bc)  bulkCheckStates = JSON.parse(bc);
  } catch (e) {}
}

// ========== 曲库渲染 (精简版) ==========
let musicIndex = null;

function syncBulkCheckState() {
  const bulkAll = document.getElementById('bulkSelectAll');
  if (!bulkAll) return;
  const allDiffChecks = document.querySelectorAll('.bulk-diff-check');
  const arr = Array.from(allDiffChecks);
  bulkAll.checked = arr.every(cb => cb.checked);
  bulkAll.indeterminate = !bulkAll.checked && arr.some(cb => cb.checked);
}

function saveBulkCheckStates() {
  const diffChecks = document.querySelectorAll('.bulk-diff-check');
  const states = new Array(bulkCheckStates.length).fill(true);
  diffChecks.forEach(cb => {
    const idx = parseInt(cb.value);
    if (idx >= 0 && idx < states.length) states[idx] = cb.checked;
  });
  bulkCheckStates = states;
  localStorage.setItem('maimai_bingo_bulk_checks', JSON.stringify(states));
}

// load bulk states from cache
(function() {
  const cached = localStorage.getItem('maimai_bingo_bulk_checks');
  if (cached) {
    try { bulkCheckStates = JSON.parse(cached); } catch(e) {}
  }
})();

function buildMusicIndex() {
  const data = getMusicData();
  if (!data) { musicIndex = null; return; }
  const dns = LIBRARY_CONFIG[currentLibrary].diffNames;
  musicIndex = data.map(song => {
    const titleLower = song.title.toLowerCase();
    const validDiffs = [];
    for (let i = 0; i < dns.length; i++) {
      if (song.level[i] && song.level[i] !== '-' && song.ds[i] !== undefined) {
        validDiffs.push({ idx: i, ds: song.ds[i], level: song.level[i] });
      }
    }
    return { song, titleLower, validDiffs };
  });
}

function clearCache() {
  switchLibrary('maimai');
  localStorage.removeItem(CACHE_KEY_FORMAT);
  localStorage.removeItem(CACHE_KEY_CELL);
  localStorage.removeItem(CACHE_KEY_MAP_DATA);
  localStorage.removeItem(CACHE_KEY_CELL_LOCKED);
  formatDataList = [];
  cellData = new Array(25).fill(-1);
  mapData = new Array(25).fill(null);
  cellLocked = new Array(25).fill(false);
  musicIndex = null;
  buildMusicIndex();
  initAllSongDiffsOnCache();
  renderFormatList();
  applyCellDataToBoard();
  emitStateToRoom();
}
loadFromCache();

let selectedSongDiffs = new Set();
let bulkCheckStates = [true, true, true, true, true];
initAllSongDiffsOnCache();

function initAllSongDiffsOnCache() {
  if (selectedSongDiffs.size > 0) return;
  if (!musicIndex) return;
  for (const m of musicIndex) {
    for (const d of m.validDiffs) {
      selectedSongDiffs.add(m.song.id + '_' + d.idx);
    }
  }
}
buildMusicIndex();

// ========== 预设管理 ==========
let presetData = {};
let currentPresetName = '';
(function loadPresets() {
  try {
    const raw = localStorage.getItem('maimai_bingo_presets');
    if (raw) presetData = JSON.parse(raw);
  } catch(e) {}
})();

function savePresets() {
  localStorage.setItem('maimai_bingo_presets', JSON.stringify(presetData));
}
function refreshPresetDropdown() {
  const dd = document.getElementById('presetDropdown');
  if (!dd) return;
  const names = ['默认', ...Object.keys(presetData).filter(n => n !== '默认')];
  dd.innerHTML = names.length === 1 ? '<div class="preset-item preset-empty">暂无预设</div>' :
    names.map(n => `<div class="preset-item" data-preset-name="${n}">
      <span class="preset-name-text">${n}</span>
      ${n === '默认' ? '' : '<button class="preset-delete-btn" data-preset-name="' + n + '" title="删除预设">×</button>'}
    </div>`).join('');
}
function applyPreset(name) {
  if (name === '默认') { initAllSongDiffsOnCache(); bulkCheckStates = [true, true, true, true, true]; }
  else if (presetData[name]) {
    selectedSongDiffs = new Set(presetData[name].diffs);
    bulkCheckStates = presetData[name].bulkChecks || [true, true, true, true, true];
  } else return;
  currentPresetName = name;
  document.getElementById('presetTrigger').textContent = name + ' ▾';
  document.getElementById('presetDropdown').classList.remove('show');
  initBulkChecks();
  doRenderMusicList(musicLastFilterText);
}
function deletePreset(name) {
  if (name === '默认') return;
  delete presetData[name];
  savePresets();
  if (currentPresetName === name) applyPreset('默认');
  refreshPresetDropdown();
}

const MUSIC_PAGE_SIZE = 10;
let musicPage = 0;
let musicLastFilterText = '';

// 批量复选框状态初始化
function initBulkChecks() {
  const container = document.getElementById('bulkChecksGroup');
  if (!container) return;
  const dns = LIBRARY_CONFIG[currentLibrary].diffNames;
  container.innerHTML = `<label class="bulk-check"><input type="checkbox" id="bulkSelectAll" checked /> 全选</label>` +
    dns.map((n, i) => `<label class="bulk-check"><input type="checkbox" class="bulk-diff-check" value="${i}" checked /> ${n}</label>`).join('');
  document.querySelectorAll('.bulk-diff-check').forEach(cb => {
    const idx = parseInt(cb.value);
    cb.checked = bulkCheckStates && idx < bulkCheckStates.length ? bulkCheckStates[idx] : true;
  });
  syncBulkCheckState();
}

function doRenderMusicList(filterText) {
  if (filterText === undefined) filterText = musicLastFilterText || '';
  const listEl = document.getElementById('musicList');
  if (!listEl) return;
  if (!musicIndex) { buildMusicIndex(); if (!musicIndex) { listEl.innerHTML = '<p class="music-empty">曲库数据未加载。</p>'; return; } }

  const levelEnable = document.getElementById('filterLevelEnable')?.checked ?? false;
  const levelFrom = parseFloat(document.getElementById('filterLevelFrom')?.value) || 0;
  const levelTo   = parseFloat(document.getElementById('filterLevelTo')?.value)   || 20;
  const diffChecks = document.querySelectorAll('.filter-check input[type="checkbox"]');
  const enabledDiffs = [];
  diffChecks.forEach(cb => { if (cb.checked) enabledDiffs.push(parseInt(cb.value)); });
  const diffSet = new Set(enabledDiffs);

  const filter = filterText.trim().toLowerCase();
  const results = [];
  for (const m of musicIndex) {
    if (filter && m.titleLower.indexOf(filter) === -1) continue;
    let match = false;
    for (const d of m.validDiffs) {
      if (!diffSet.has(d.idx)) continue;
      if (!levelEnable || (d.ds >= levelFrom && d.ds <= levelTo)) { match = true; break; }
    }
    if (!match) continue;
    results.push(m);
  }

  const totalCount = results.length;
  const totalPages = Math.ceil(totalCount / MUSIC_PAGE_SIZE);
  if (musicPage >= totalPages && totalPages > 0) musicPage = totalPages - 1;
  if (musicPage < 0) musicPage = 0;
  const pageResults = results.slice(musicPage * MUSIC_PAGE_SIZE, (musicPage + 1) * MUSIC_PAGE_SIZE);

  const countEl = document.getElementById('musicCount');
  if (countEl) countEl.textContent = `共 ${totalCount} 首曲目 (第 ${musicPage + 1}/${totalPages} 页)`;

  if (pageResults.length === 0) { listEl.innerHTML = '<p class="music-empty">无匹配曲目。</p>'; renderPagination(totalPages); return; }

  const fragParts = [];
  for (const m of pageResults) {
    const song = m.song;
    const imgName = safeFileName(song.title);
    let diffHtml = '';
    const dns = LIBRARY_CONFIG[currentLibrary].diffNames;
    const cb = LIBRARY_CONFIG[currentLibrary].coverBase;
    let totalDiffs = 0, checkedDiffs = 0;
    for (let j = 0; j < song.level.length && j < dns.length; j++) {
      if (!song.level[j] || song.level[j] === '-' || song.ds[j] === undefined) continue;
      if (!diffSet.has(j)) continue;
      if (levelEnable && (song.ds[j] < levelFrom || song.ds[j] > levelTo)) continue;
      totalDiffs++;
      const key = song.id + '_' + j;
      const checked = selectedSongDiffs.has(key);
      if (checked) checkedDiffs++;
      diffHtml += '<label class="diff-badge diff-check-label diff-' + dns[j].toLowerCase() + '"><input type="checkbox" class="song-diff-check" data-song-id="' + song.id + '" data-diff-idx="' + j + '"' + (checked?' checked':'') + ' />' + dns[j] + ' <strong>' + song.ds[j].toFixed(1) + '</strong></label>';
    }
    const rowChecked = checkedDiffs === totalDiffs && totalDiffs > 0 ? ' checked' : '';
    const rowIndet = checkedDiffs > 0 && checkedDiffs < totalDiffs ? ' data-indeterminate="1"' : '';
    fragParts.push('<div class="music-row"><label class="row-check-wrapper"><input type="checkbox" class="row-song-check" data-song-id="' + song.id + '"' + rowChecked + rowIndet + ' /></label><img class="music-cover" src="' + cb + imgName + '.png" alt="' + song.title + '" onerror="this.src=\'\'" /><div class="music-title">' + song.title + '</div><div class="music-diffs">' + diffHtml + '</div></div>');
  }
  requestAnimationFrame(() => {
    listEl.innerHTML = fragParts.join('');
    listEl.querySelectorAll('.row-song-check[data-indeterminate="1"]').forEach(c => c.indeterminate = true);
  });
  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const pgEl = document.getElementById('musicPagination');
  if (!pgEl) return;
  if (totalPages <= 1) { pgEl.innerHTML = ''; return; }
  const sp = Math.max(0, Math.min(musicPage - 2, totalPages - 4)), ep = Math.min(totalPages, sp + 4);
  let html = '<button class="pg-btn pg-first"' + (musicPage === 0 ? ' disabled' : '') + '>首页</button>';
  html += '<button class="pg-btn pg-prev"' + (musicPage === 0 ? ' disabled' : '') + '>上一页</button>';
  for (let p = sp; p < ep; p++) html += '<button class="pg-btn pg-num' + (p === musicPage ? ' pg-active' : '') + '" data-page="' + p + '">' + (p + 1) + '</button>';
  html += '<button class="pg-btn pg-next"' + (musicPage >= totalPages - 1 ? ' disabled' : '') + '>下一页</button>';
  html += '<button class="pg-btn pg-last"' + (musicPage >= totalPages - 1 ? ' disabled' : '') + '>尾页</button>';
  pgEl.innerHTML = html;
}

// ========== 导航切换 ==========
navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const page = item.dataset.page;
    if (pageData[page]) {
      pageContent.innerHTML = pageData[page].content;
      if (page === 'game') { applyCellDataToBoard(); renderFormatList(); if (typeof window.setBoardButtonsEnabled === 'function') { window.setBoardButtonsEnabled(window.isMultiplayerHost || !window.mpRoomCode); } if (typeof renderTeamPanel === 'function') { renderTeamPanel(); } }
      if (page === 'music') { musicPage = 0; doRenderMusicList(''); }
    }
  });
});

// ========== 搜索 & 分页事件 ==========
document.addEventListener('input', (e) => {
  if (e.target.id === 'musicSearchInput') {
    musicLastFilterText = e.target.value;
    musicPage = 0;
    doRenderMusicList(e.target.value);
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'librarySelect') {
    switchLibrary(e.target.value);
  }
});
document.addEventListener('click', (e) => {
  // ── 复选框事件（最优先） ──
  if (e.target.id === 'bulkSelectAll') {
    const checkAll = e.target.checked;
    document.querySelectorAll('.bulk-diff-check').forEach(cb => cb.checked = checkAll);
    document.querySelectorAll('.song-diff-check').forEach(cb => cb.checked = checkAll);
    document.querySelectorAll('.row-song-check').forEach(cb => { cb.checked = checkAll; cb.indeterminate = false; });
    if (checkAll) { for (const m of musicIndex) for (const d of m.validDiffs) selectedSongDiffs.add(m.song.id + '_' + d.idx); }
    else selectedSongDiffs.clear();
    syncBulkCheckState(); saveBulkCheckStates();
    return;
  }
  if (e.target.classList.contains('bulk-diff-check')) {
    const diffIdx = parseInt(e.target.value);
    const checkAll = e.target.checked;
    document.querySelectorAll('.song-diff-check[data-diff-idx="' + diffIdx + '"]').forEach(cb => cb.checked = checkAll);
    if (checkAll) { for (const m of musicIndex) for (const d of m.validDiffs) if (d.idx === diffIdx) selectedSongDiffs.add(m.song.id + '_' + d.idx); }
    else { for (const m of musicIndex) for (const d of m.validDiffs) if (d.idx === diffIdx) selectedSongDiffs.delete(m.song.id + '_' + d.idx); }
    document.querySelectorAll('.music-row').forEach(row => {
      const rowCb = row.querySelector('.row-song-check'); if (!rowCb) return;
      const diffs = row.querySelectorAll('.song-diff-check'); let t = 0, c = 0;
      diffs.forEach(cb => { t++; if (cb.checked) c++; });
      rowCb.checked = c === t && t > 0; rowCb.indeterminate = c > 0 && c < t;
    });
    syncBulkCheckState(); saveBulkCheckStates();
    return;
  }
  if (e.target.classList.contains('row-song-check')) {
    const songId = e.target.dataset.songId;
    const checkAll = e.target.checked;
    const row = e.target.closest('.music-row');
    if (row) row.querySelectorAll('.song-diff-check').forEach(cb => {
      cb.checked = checkAll;
      const key = songId + '_' + cb.dataset.diffIdx;
      if (checkAll) selectedSongDiffs.add(key); else selectedSongDiffs.delete(key);
    });
    e.target.indeterminate = false;
    syncBulkCheckState(); saveBulkCheckStates();
    return;
  }
  if (e.target.classList.contains('song-diff-check')) {
    const key = e.target.dataset.songId + '_' + e.target.dataset.diffIdx;
    if (e.target.checked) selectedSongDiffs.add(key); else selectedSongDiffs.delete(key);
    const row = e.target.closest('.music-row');
    if (row) {
      const rowCb = row.querySelector('.row-song-check');
      if (rowCb) {
        const diffs = row.querySelectorAll('.song-diff-check'); let t = 0, c = 0;
        diffs.forEach(cb => { t++; if (cb.checked) c++; });
        rowCb.checked = c === t && t > 0; rowCb.indeterminate = c > 0 && c < t;
      }
    }
    syncBulkCheckState(); saveBulkCheckStates();
    return;
  }
  // ── 预设按钮 ↓ 点击 → 切换下拉 ──
  if (e.target.id === 'presetTrigger' || e.target.closest('#presetTrigger')) {
    document.getElementById('presetDropdown').classList.toggle('show');
    e.stopPropagation(); return;
  }
  // ── 选择预设 ──
  if (e.target.closest('.preset-name-text')) {
    const name = e.target.closest('.preset-item').dataset.presetName;
    if (name) applyPreset(name);
    return;
  }
  // ── 删除预设 ──
  if (e.target.classList.contains('preset-delete-btn')) {
    deletePreset(e.target.dataset.presetName);
    e.stopPropagation(); return;
  }
  // ── 保存预设 ──
  if (e.target.id === 'savePresetBtn') {
    document.getElementById('presetNameInput').value = '';
    document.getElementById('presetModal').classList.add('show');
    return;
  }
  // 点击外部关闭预设浮窗
  const pdd = document.getElementById('presetDropdown');
  if (pdd && pdd.classList.contains('show') && !e.target.closest('.preset-dropdown-wrapper')) pdd.classList.remove('show');
  // ── 筛选按钮 ──
  if (e.target.id === 'filterToggleBtn' || e.target.closest('#filterToggleBtn')) {
    document.getElementById('filterDropdown').classList.toggle('show');
    e.stopPropagation(); return;
  }
  // ── 筛选下拉变化 ──
  if (e.target.closest('.filter-dropdown input') || e.target.closest('.filter-dropdown select')) {
    setTimeout(() => { musicPage = 0; doRenderMusicList(musicLastFilterText); }, 50);
  }
  // ── 点击外部关闭筛选浮窗 ──
  const fdd = document.getElementById('filterDropdown');
  if (fdd && fdd.classList.contains('show') && !e.target.closest('.filter-dropdown')) fdd.classList.remove('show');
  // ── 分页按钮 ──
  if (/pg-(first|last|next|prev|num)/.test(e.target.className)) {
    const cm = document.getElementById('musicCount');
    const tc = cm ? parseInt((cm.textContent.match(/共 (\d+)/) || ['0', '0'])[1]) || 0 : 0;
    const tp = Math.ceil(tc / MUSIC_PAGE_SIZE) || 1;
    if (e.target.classList.contains('pg-first') && !e.target.disabled) { musicPage = 0; doRenderMusicList(); }
    else if (e.target.classList.contains('pg-last') && !e.target.disabled) { musicPage = tp - 1; doRenderMusicList(); }
    else if (e.target.classList.contains('pg-next') && !e.target.disabled) { if (musicPage < tp - 1) { musicPage++; doRenderMusicList(); } }
    else if (e.target.classList.contains('pg-prev') && !e.target.disabled) { if (musicPage > 0) { musicPage--; doRenderMusicList(); } }
    else if (e.target.classList.contains('pg-num')) { musicPage = parseInt(e.target.dataset.page); doRenderMusicList(); }
  }
});

// ========== 将 cellData 应用到棋盘 DOM ==========
function applyCellDataToBoard() {
  const cells = document.querySelectorAll('.board .cell');
  cellData.forEach((fmtIdx, i) => {
    const cell = cells[i];
    if (!cell) return;
    // 清除状态
    cell.classList.remove('cell-filled', 'cell-selected', 'cell-map');
    cell.style.backgroundColor = '';
    cell.style.color = '';
    cell.style.backgroundImage = '';
    cell.style.backgroundSize = '';
    cell.style.backgroundPosition = '';
    cell.innerHTML = '';

    // 优先显示地图数据
    if (mapData[i] && mapData[i].title) {
      const m = mapData[i];
      const imgName = safeFileName(m.title);
      cell.classList.add('cell-map');
      if (cellLocked[i]) cell.classList.add('cell-map-locked');
      cell.style.backgroundImage = '';
      cell.innerHTML = `<img class="cell-map-cover" src="${LIBRARY_CONFIG[currentLibrary].coverBase}${imgName}.png" alt="${m.title}" />
        <div class="cell-map-info">
          <div class="cell-map-title">${m.title}</div>
          <div class="cell-map-diff">${m.diffName} ${m.ds.toFixed(1)}</div>
        </div>
        ${cellLocked[i] ? '<div class="cell-lock-overlay"><span>✕</span></div>' : ''}`;
      return;
    }

    // 否则显示格式数据
    if (fmtIdx >= 0 && formatDataList[fmtIdx]) {
      const fmt = formatDataList[fmtIdx];
      cell.style.backgroundColor = fmt.color;
      cell.classList.add('cell-filled');
      cell.textContent = `${fmt.levelFrom}~${fmt.levelTo}`;
    }
  });
  selectedCellIndex = -1;
}

// ========== 渲染格式列表到面板 ==========
function renderFormatList() {
  const listEl = document.getElementById('formatList');
  if (!listEl) return;
  if (formatDataList.length === 0) {
    listEl.innerHTML = '<p class="format-empty">暂无格式，点击"添加格式"新建。</p>';
    return;
  }
  listEl.innerHTML = formatDataList.map((item, i) => `
    <div class="format-card" style="background:${item.color}20; border-left-color:${item.color}">
      <div class="format-card-info">
        <span class="format-color-dot" style="background:${item.color}"></span>
        <span class="format-level">${item.levelFrom} ~ ${item.levelTo}</span>
      </div>
      <div class="format-card-actions">
        <button class="btn-edit-format" data-index="${i}">编辑</button>
        <button class="btn-delete-format" data-index="${i}">删除</button>
      </div>
    </div>
  `).join('');
}

// ========== 渲染格式选择器列表（弹窗内） ==========
function renderFormatPicker() {
  const listEl = document.getElementById('formatPickerList');
  if (!listEl) return;
  if (formatDataList.length === 0) {
    listEl.innerHTML = '<p class="format-empty">暂无可用格式，请先在右侧面板"添加格式"。</p>';
    return;
  }
  listEl.innerHTML = formatDataList.map((item, i) => `
    <div class="format-picker-item" data-fmt-index="${i}">
      <span class="format-picker-dot" style="background:${item.color}"></span>
      <span class="format-picker-level">${item.levelFrom} ~ ${item.levelTo}</span>
    </div>
  `).join('');
}

// ========== 导航切换 ==========
let currentPage = '';
navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const page = item.dataset.page;
    if (pageData[page]) {
      if (currentPage === 'multiplayer' && typeof window.destroyMultiplayerPage === 'function') { window.destroyMultiplayerPage(); }
      pageContent.innerHTML = pageData[page].content;
      currentPage = page;
      if (page === 'game') { applyCellDataToBoard(); renderFormatList(); if (typeof window.setBoardButtonsEnabled === 'function') { window.setBoardButtonsEnabled(window.isMultiplayerHost || !window.mpRoomCode); } if (typeof renderTeamPanel === 'function') { renderTeamPanel(); } }
      if (page === 'settings') {
        const sel = document.getElementById('librarySelect');
        if (sel) sel.value = currentLibrary;
      }
      if (page === 'music') { initFilterCheckboxes(); populateFilterLevels(); refreshPresetDropdown(); initBulkChecks(); musicPage = 0; if (!currentPresetName) applyPreset('默认'); else doRenderMusicList(''); }
      if (page === 'multiplayer' && typeof window.initMultiplayerPage === 'function') { window.initMultiplayerPage(); }
    }
  });
});

function initFilterCheckboxes() {
  const container = document.getElementById('filterDiffCheckboxes');
  if (!container) return;
  const dns = LIBRARY_CONFIG[currentLibrary].diffNames;
  container.innerHTML = dns.map((n, i) => `<label class="filter-check"><input type="checkbox" value="${i}" checked /> ${n}</label>`).join('');
}

function populateFilterLevels() {
  const fromEl = document.getElementById('filterLevelFrom');
  const toEl = document.getElementById('filterLevelTo');
  if (!fromEl || !toEl || fromEl.children.length > 0) return;
  const consts = getUniqueConstants();
  const opts = consts.map(v => `<option value="${v.toFixed(1)}">${v.toFixed(1)}</option>`).join('');
  fromEl.innerHTML = opts;
  toEl.innerHTML = opts;
  fromEl.value = '1.0';
  toEl.value = '15.0';
}

function getUniqueConstants() {
  const constSet = new Set();
  const data = getMusicData();
  if (!data) return [1.0, 15.0];
  for (const song of data) for (const c of song.ds) if (c != null) constSet.add(parseFloat(c.toFixed(1)));
  return [...constSet].sort((a, b) => a - b);
}

function switchLibrary(lib) {
  if (!LIBRARY_CONFIG[lib]) return;
  currentLibrary = lib;
  COVER_BASE = LIBRARY_CONFIG[lib].coverBase;
  DIFF_NAMES = LIBRARY_CONFIG[lib].diffNames;
  musicIndex = null;
  buildMusicIndex();
  localStorage.setItem('maimai_bingo_library', lib);
  if (document.querySelector('.music-page')) {
    initFilterCheckboxes();
    populateFilterLevels();
    musicPage = 0;
    doRenderMusicList('');
  }
  populateLevelSelects();
}

// ========== 格式编辑弹窗 ==========
const formatModal = document.getElementById('formatModal');
const closeFormatModal = document.getElementById('closeFormatModal');
const saveFormat = document.getElementById('saveFormat');
const formatColor = document.getElementById('formatColor');
const formatLevelFrom = document.getElementById('formatLevelFrom');
const formatLevelTo = document.getElementById('formatLevelTo');

function populateLevelSelects() {
  const consts = getUniqueConstants();
  const opts = consts.map(v => `<option value="${v.toFixed(1)}">${v.toFixed(1)}</option>`).join('');
  formatLevelFrom.innerHTML = opts;
  formatLevelTo.innerHTML = opts;
}
populateLevelSelects();

function closeFormatEditModal() {
  formatModal.classList.remove('show');
}
closeFormatModal.addEventListener('click', closeFormatEditModal);
formatModal.addEventListener('click', (e) => {
  if (e.target === formatModal) closeFormatEditModal();
});

// ========== 保存预设弹窗 ==========
const presetModal = document.getElementById('presetModal');
const savePresetConfirm = document.getElementById('savePresetConfirm');
const closePresetModal = document.getElementById('closePresetModal');
if (presetModal) {
  closePresetModal.addEventListener('click', () => presetModal.classList.remove('show'));
  presetModal.addEventListener('click', (e) => { if (e.target === presetModal) presetModal.classList.remove('show'); });
  savePresetConfirm.addEventListener('click', () => {
    const name = document.getElementById('presetNameInput').value.trim();
    if (!name) { showToast('请输入预设名称', 'error'); return; }
    presetData[name] = { diffs: [...selectedSongDiffs], bulkChecks: [...bulkCheckStates] };
    savePresets();
    refreshPresetDropdown();
    currentPresetName = name;
    document.getElementById('presetTrigger').textContent = name + ' ▾';
    presetModal.classList.remove('show');
    showToast('预设已保存', 'success');
  });
}

// ========== 单元格选择格式弹窗 ==========
const cellFormatModal = document.getElementById('cellFormatModal');
const closeCellFormatModal = document.getElementById('closeCellFormatModal');

function closeCellModal() {
  cellFormatModal.classList.remove('show');
}
closeCellFormatModal.addEventListener('click', closeCellModal);
cellFormatModal.addEventListener('click', (e) => {
  if (e.target === cellFormatModal) closeCellModal();
});

// ========== 单元格操作弹窗（锁定/Reroll） ==========
const cellActionModal = document.getElementById('cellActionModal');
const closeCellActionModal = document.getElementById('closeCellActionModal');
const lockCellBtn = document.getElementById('lockCellBtn');
const rerollCellBtn = document.getElementById('rerollCellBtn');

closeCellActionModal.addEventListener('click', () => cellActionModal.classList.remove('show'));
cellActionModal.addEventListener('click', (e) => { if (e.target === cellActionModal) cellActionModal.classList.remove('show'); });

lockCellBtn.addEventListener('click', () => {
  if (selectedCellIndex < 0) return;
  cellLocked[selectedCellIndex] = !cellLocked[selectedCellIndex];
  applyCellDataToBoard();
  saveToCache();
  emitStateToRoom();
  cellActionModal.classList.remove('show');
});

rerollCellBtn.addEventListener('click', () => {
  if (selectedCellIndex < 0 || !mapData[selectedCellIndex]) return;
  const i = selectedCellIndex;
  const fmt = formatDataList[cellData[i]];
  if (!fmt) return;
  const levelFrom = parseFloat(fmt.levelFrom);
  const levelTo   = parseFloat(fmt.levelTo);
  // 收集已被其他格占用的歌曲
  const usedSongs = new Set();
  for (let j = 0; j < 25; j++) {
    if (j !== i && mapData[j] && mapData[j].songId) usedSongs.add(String(mapData[j].songId));
  }
  const candidates = [];
  const allSongs4 = getMusicData();
  if (!allSongs4) return;
  for (const song of allSongs4) {
    if (usedSongs.has(String(song.id))) continue;
    const maxD = song.level.length;
    for (let j = 0; j < maxD; j++) {
      if (!song.level[j] || song.level[j] === '-' || song.ds[j] === undefined) continue;
      if (song.ds[j] >= levelFrom && song.ds[j] <= levelTo) {
        candidates.push({ song, diffIdx: j });
        break;
      }
    }
  }
  if (candidates.length === 0) {
    showToast('无可选曲目', 'error');
    return;
  }
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const s = pick.song;
  const d = pick.diffIdx;
  mapData[i] = {
    title: s.title,
    songId: s.id,
    diffIdx: d,
    ds: s.ds[d],
    level: s.level[d],
    diffName: LIBRARY_CONFIG[currentLibrary].diffNames[d] || '?'
  };
  applyCellDataToBoard();
  saveToCache();
  emitStateToRoom();
  cellActionModal.classList.remove('show');
});

// ========== 全局事件委托 ==========
document.addEventListener('click', (e) => {
  // 随机颜色按钮
  if (e.target.id === 'randomColorBtn') {
    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    formatColor.value = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    return;
  }

  // 添加格式按钮
  if (e.target.classList.contains('btn-add-format')) {
    editingIndex = -1;
    formatColor.value = '#75dfff';
    formatLevelFrom.value = '10.0';
    formatLevelTo.value = '15.0';
    formatModal.classList.add('show');
    return;
  }

  // 编辑格式按钮
  if (e.target.classList.contains('btn-edit-format')) {
    const idx = parseInt(e.target.dataset.index);
    if (!isNaN(idx) && formatDataList[idx]) {
      editingIndex = idx;
      formatColor.value = formatDataList[idx].color;
      formatLevelFrom.value = formatDataList[idx].levelFrom;
      formatLevelTo.value = formatDataList[idx].levelTo;
      formatModal.classList.add('show');
    }
    return;
  }

  // 删除格式按钮
  if (e.target.classList.contains('btn-delete-format')) {
    const idx = parseInt(e.target.dataset.index);
    if (!isNaN(idx) && formatDataList[idx]) {
      formatDataList.splice(idx, 1);
      cellData = cellData.map(c => c === idx ? -1 : (c > idx ? c - 1 : c));
      renderFormatList();
      applyCellDataToBoard();
      saveToCache();
      emitStateToRoom();
    }
    return;
  }

  // 随机填入按钮
  if (e.target.classList.contains('btn-random-fill') || e.target.id === 'randomFillBtn') {
    if (formatDataList.length === 0) {
      showToast('请先在右侧面板添加格式', 'error');
      return;
    }
    mapData = new Array(25).fill(null); // 清除地图
    cellLocked = new Array(25).fill(false);
    for (let i = 0; i < 25; i++) {
      cellData[i] = Math.floor(Math.random() * formatDataList.length);
    }
    applyCellDataToBoard();
    saveToCache();
    emitStateToRoom();
    return;
  }

  // 生成地图按钮
  if (e.target.classList.contains('btn-gen-map') || e.target.id === 'genMapBtn') {
    generateMap();
    emitStateToRoom();
    return;
  }

  // 清空棋盘按钮
  if (e.target.classList.contains('btn-clear-board') || e.target.id === 'clearBoardBtn') {
    cellData = new Array(25).fill(-1);
    mapData = new Array(25).fill(null);
    cellLocked = new Array(25).fill(false);
    applyCellDataToBoard();
    saveToCache();
    emitStateToRoom();
    return;
  }

  // 清空缓存按钮（双击确认）
  if (e.target.classList.contains('btn-clear-cache') || e.target.id === 'clearCacheBtn') {
    const btn = document.getElementById('clearCacheBtn');
    if (btn && btn.dataset.confirming === '1') {
      // 确认清空
      btn.dataset.confirming = '0';
      btn.textContent = '清空缓存';
      clearCache();
      location.reload();
      return;
    }
    // 首次点击：提示再次确认
    btn.dataset.confirming = '1';
    btn.textContent = '再次点击确认';
    showToast('请再次点击按钮确认清空所有缓存', '');
    // 3秒后自动取消
    clearTimeout(btn._confirmTimer);
    btn._confirmTimer = setTimeout(() => {
      btn.dataset.confirming = '0';
      btn.textContent = '清空缓存';
    }, 3000);
    return;
  }

  // 曲库切换在下方 change 事件中处理


  // 保存预设按钮
  if (e.target.classList.contains('btn-save-preset') || e.target.id === 'savePresetBtn') {
    document.getElementById('presetNameInput').value = '';
    document.getElementById('presetModal').classList.add('show');
    return;
  }

  // 预设下拉切换 - 点击预设项名称
  if (e.target.closest('.preset-name-text')) {
    const item = e.target.closest('.preset-item');
    const name = item?.dataset.presetName;
    if (name) applyPreset(name);
    return;
  }

  // 删除预设
  if (e.target.classList.contains('preset-delete-btn')) {
    const name = e.target.dataset.presetName;
    if (name) deletePreset(name);
    e.stopPropagation();
    return;
  }

  // 点击棋盘单元格 → 第一次选中，第二次同一格弹出格式选择器
  if (e.target.classList.contains('cell') || e.target.closest('.cell')) {
    // 地图模式单元格双击 → 弹出操作弹窗
    const cellEl = e.target.classList.contains('cell') ? e.target : e.target.closest('.cell');
    if (cellEl.classList.contains('cell-map')) {
      const cells = document.querySelectorAll('.board .cell');
      const index = Array.from(cells).indexOf(cellEl);
      if (index < 0) return;
      if (!mapData[index] || !mapData[index].title) return;
      // 打开单元格操作弹窗
      selectedCellIndex = index;
      document.getElementById('cellActionInfo').textContent = mapData[index].title + ' ' + mapData[index].diffName + ' ' + mapData[index].ds.toFixed(1);
      document.getElementById('lockCellBtn').textContent = cellLocked[index] ? '解锁' : '锁定';
      document.getElementById('rerollCellBtn').disabled = cellLocked[index];
      document.getElementById('rerollCellBtn').style.opacity = cellLocked[index] ? '0.5' : '1';
      document.getElementById('cellActionModal').classList.add('show');
      return;
    }

    // 非地图模式：正常选中/编辑

    const cells = document.querySelectorAll('.board .cell');
    const index = Array.from(cells).indexOf(e.target);
    if (index < 0) return;

    // 如果点击的是已选中的单元格 → 弹出格式选择器
    if (selectedCellIndex === index && e.target.classList.contains('cell-selected')) {
      renderFormatPicker();
      const row = Math.floor(index / 5) + 1;
      const col = (index % 5) + 1;
      const info = document.getElementById('cellInfo');
      if (info) info.textContent = `当前单元格：第 ${row} 行 第 ${col} 列`;
      cellFormatModal.classList.add('show');
      return;
    }

    // 否则：取消所有选中，选中当前格
    cells.forEach(c => c.classList.remove('cell-selected'));
    e.target.classList.add('cell-selected');
    selectedCellIndex = index;
    return;
  }

  // 格式选择器中点击一个格式 → 应用到单元格
  if (e.target.closest('.format-picker-item')) {
    const item = e.target.closest('.format-picker-item');
    const fmtIdx = parseInt(item.dataset.fmtIndex);
    if (!isNaN(fmtIdx) && selectedCellIndex >= 0 && formatDataList[fmtIdx]) {
      cellData[selectedCellIndex] = fmtIdx;
      mapData[selectedCellIndex] = null; // 清除该格地图
      cellLocked[selectedCellIndex] = false; // 清除锁定
      applyCellDataToBoard();
      saveToCache();
      emitStateToRoom();
    }
    closeCellModal();
    return;
  }
});

// ========== 生成地图 ==========
function generateMap() {
  const allSongsG = getMusicData();
  if (!allSongsG) {
    showToast('曲库数据未加载', 'error');
    return;
  }

  // Step 1: 检查每个格子是否有格式（跳过已锁定的格子）
  const cells = [];
  const usedSongs = new Set();
  for (let i = 0; i < 25; i++) {
    if (cellData[i] >= 0 && formatDataList[cellData[i]]) {
      // 锁定格保留当前歌曲（不重新选）
      if (cellLocked[i] && mapData[i] && mapData[i].songId) {
        usedSongs.add(String(mapData[i].songId));
      } else {
        cells.push(i);
      }
    }
  }
  if (cells.length === 0 && usedSongs.size === 0) {
    showToast('请先为棋盘格子绑定格式', 'error');
    return;
  }

  // Step 2: 为每个未锁定格子的定数范围构建可选歌曲池，不可重复
  // 先清除非锁定格的地图数据
  for (let i = 0; i < 25; i++) {
    if (!cellLocked[i]) mapData[i] = null;
  }
  for (const cellIdx of cells) {
    const fmt = formatDataList[cellData[cellIdx]];
    const levelFrom = parseFloat(fmt.levelFrom);
    const levelTo   = parseFloat(fmt.levelTo);

    const candidates = [];
    for (const song of allSongsG) {
      if (usedSongs.has(String(song.id))) continue;
      const maxD2 = song.level.length;
      for (let j = 0; j < maxD2; j++) {
        if (!song.level[j] || song.level[j] === '-' || song.ds[j] === undefined) continue;
        if (song.ds[j] >= levelFrom && song.ds[j] <= levelTo) {
          candidates.push({ song, diffIdx: j });
          break;
        }
      }
    }

    if (candidates.length === 0) continue;

    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const s = pick.song;
    const d = pick.diffIdx;
    usedSongs.add(String(s.id));
    mapData[cellIdx] = {
      title: s.title,
      songId: s.id,
      diffIdx: d,
      ds: s.ds[d],
      level: s.level[d],
      diffName: LIBRARY_CONFIG[currentLibrary].diffNames[d] || '?'
    };
  }

  applyCellDataToBoard();
  saveToCache();
}

// ========== 保存格式 ==========
saveFormat.addEventListener('click', () => {
  const fromVal = parseFloat(formatLevelFrom.value);
  const toVal   = parseFloat(formatLevelTo.value);
  if (fromVal > toVal) {
    showToast('区间不合法，请重新输入', 'error');
    return;
  }
  const data = {
    color: formatColor.value,
    levelFrom: formatLevelFrom.value,
    levelTo: formatLevelTo.value
  };
  if (editingIndex >= 0) {
    formatDataList[editingIndex] = data;
  } else {
    formatDataList.push(data);
  }
  editingIndex = -1;
  // 清理失效单元格索引并刷新
  cellData = cellData.map(idx => (idx < formatDataList.length ? idx : -1));
  renderFormatList();
  applyCellDataToBoard();
  saveToCache();
  emitStateToRoom();
  closeFormatEditModal();
});

// ========== Toast 提示 ==========
function showToast(msg, type = 'error') {
  const el = document.getElementById('toastMsg');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast-msg show ' + type;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2000);
}

// ========== 页面加载时恢复缓存数据 ==========
renderFormatList();
applyCellDataToBoard();
