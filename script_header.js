const navItems = document.querySelectorAll('.nav-item');
const pageContent = document.getElementById('pageContent');

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
        </div>`
  },
  settings: {
    content: `<div class="settings-page">
        <button class="btn-clear-cache" id="clearCacheBtn">清空缓存</button>
        <a class="project-link" href="https://github.com/Mizuki-OvO/maimai-bingo-web" target="_blank">项目地址</a>
      </div>`
  }
};

let formatDataList = [];
let cellData = new Array(25).fill(-1);
let mapData = new Array(25).fill(null);
let cellLocked = new Array(25).fill(false);
let editingIndex = -1;
let selectedCellIndex = -1;
let selectedSongDiffs = new Set();

const DIFF_NAMES = ['BAS', 'ADV', 'EXP', 'MAS', 'ReM'];
const COVER_BASE = 'music_data/maimai/pictures/';

function getMusicData() { return typeof MUSIC_DATA !== 'undefined' ? MUSIC_DATA : null; }
function safeFileName(title) {
  return title.replace("/", "／").replace("\\", "＼").replace(":", "：")
              .replace("*", "＊").replace("?", "？").replace('"', "＂")
              .replace("<", "＜").replace(">", "＞").replace("|", "｜");
}

const CACHE_KEY_FORMAT = 'maimai_bingo_format_list';
const CACHE_KEY_CELL = 'maimai_bingo_cell_data';
const CACHE_KEY_SONG_DIFFS = 'maimai_bingo_song_diffs';
const CACHE_KEY_MAP_DATA = 'maimai_bingo_map_data';
const CACHE_KEY_CELL_LOCKED = 'maimai_bingo_cell_locked';

function saveToCache() {
  try {
    localStorage.setItem(CACHE_KEY_FORMAT, JSON.stringify(formatDataList));
    localStorage.setItem(CACHE_KEY_CELL, JSON.stringify(cellData));
    localStorage.setItem(CACHE_KEY_SONG_DIFFS, JSON.stringify([...selectedSongDiffs]));
    localStorage.setItem(CACHE_KEY_MAP_DATA, JSON.stringify(mapData));
    localStorage.setItem(CACHE_KEY_CELL_LOCKED, JSON.stringify(cellLocked));
  } catch (e) {}
}

function loadFromCache() {
  try {
    const fmt = localStorage.getItem(CACHE_KEY_FORMAT);
    const cel = localStorage.getItem(CACHE_KEY_CELL);
    const sd = localStorage.getItem(CACHE_KEY_SONG_DIFFS);
    const md = localStorage.getItem(CACHE_KEY_MAP_DATA);
    const cl = localStorage.getItem(CACHE_KEY_CELL_LOCKED);
    if (fmt) formatDataList = JSON.parse(fmt);
    if (cel) cellData = JSON.parse(cel);
    if (md) mapData = JSON.parse(md);
    if (cl) cellLocked = JSON.parse(cl);
    if (sd) selectedSongDiffs = new Set(JSON.parse(sd));
  } catch (e) {}
}

function initAllSongDiffs() {
  const data = getMusicData();
  if (!data) return;
  for (const song of data) {
    for (let j = 0; j < DIFF_NAMES.length; j++) {
      if (song.level[j] && song.level[j] !== '-' && song.ds[j] !== undefined) {
        selectedSongDiffs.add(song.id + '_' + j);
      }
    }
  }
  saveToCache();
}

function clearCache() {
  localStorage.removeItem(CACHE_KEY_FORMAT);
  localStorage.removeItem(CACHE_KEY_CELL);
  localStorage.removeItem(CACHE_KEY_SONG_DIFFS);
  localStorage.removeItem(CACHE_KEY_MAP_DATA);
  localStorage.removeItem(CACHE_KEY_CELL_LOCKED);
  formatDataList = [];
  cellData = new Array(25).fill(-1);
  mapData = new Array(25).fill(null);
  cellLocked = new Array(25).fill(false);
  selectedSongDiffs = new Set();
  initAllSongDiffs();
  renderFormatList();
  applyCellDataToBoard();
}
loadFromCache();
