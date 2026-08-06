// ============================================================
// multiplayer.js — 联机协同模块
// 依赖: Socket.IO v4.x CDN, script.js (showToast, pageData, etc.)
// ============================================================

// ---------- 配置 ----------
const MULTIPLAYER_CONFIG = {
    serverUrl: 'https://maimai-bingo-web.onrender.com',
    reconnectAttempts: 5,
    reconnectDelay: 2000,
};

const TEAM_DEFAULTS = {
    colors: ['#e74c3c', '#3498db', '#27ae60'],
    names: ['🔴 红队', '🔵 蓝队', '🟢 绿队'],
};

// ---------- 状态 ----------
let socket = null;
let roomState = {
    code: null,             // 当前房间号
    players: [],            // [{ id, name, isHost, team, isCaptain }]
    isHost: false,          // 我是否房主
    connected: false,       // Socket 是否连接中
    myTeam: 0,              // 我的队伍 (0/1/2)
    teamColors: [...TEAM_DEFAULTS.colors],  // 队伍颜色
    teamCaptains: {},       // { 0: socketId, 1: socketId, 2: socketId }
};

// ---------- 全局导出 (供 script.js 使用) ----------
window.isMultiplayerHost = false;
window.mpRoomCode = null;

/**
 * 向房间内其他玩家广播当前游戏状态
 * @param {Object} data - 包含 cellData, mapData, cellLocked 等
 */
window.emitMultiplayerState = function(data) {
    if (!socket || !roomState.code || !roomState.isHost) return;
    socket.emit('sync-state', {
        roomCode: roomState.code,
        data: data,
    });
};

/**
 * 检查当前是否处于联机模式且用户是房主
 */
window.isMultiplayerSession = function() {
    return socket !== null && roomState.connected && roomState.code !== null;
};

// ---------- 初始化 ----------
function connectSocket() {
    if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
    }

    socket = io(MULTIPLAYER_CONFIG.serverUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: MULTIPLAYER_CONFIG.reconnectAttempts,
        reconnectionDelay: MULTIPLAYER_CONFIG.reconnectDelay,
    });

    // --- 连接事件 ---
    socket.on('connect', () => {
        roomState.connected = true;
        console.log('[MP] 已连接到服务器:', socket.id);
        updateConnectionUI();
    });

    socket.on('disconnect', (reason) => {
        roomState.connected = false;
        window.isMultiplayerHost = false;
        console.warn('[MP] 断开连接:', reason);
        updateConnectionUI();
        if (reason === 'io server disconnect') {
            showToast('被服务器断开连接', 'error');
        } else {
            showToast('与服务器断开连接，正在重连...', 'warning');
        }
    });

    socket.on('connect_error', (err) => {
        roomState.connected = false;
        console.error('[MP] 连接错误:', err.message);
        updateConnectionUI();
        showToast('无法连接到服务器: ' + err.message, 'error');
    });

    // --- 房间事件 ---
    socket.on('room-created', (data) => {
        roomState.code = data.code;
        roomState.players = data.players;
        roomState.isHost = true;
        roomState.myTeam = 0;
        roomState.teamColors = data.teamColors || [...TEAM_DEFAULTS.colors];
        roomState.teamCaptains = data.teamCaptains || {};
        window.isMultiplayerHost = true;
        window.mpRoomCode = data.code;
        showToast('房间已创建: ' + data.code, 'success');
        renderLobbyUI();
        updateConnectionUI();
        renderTeamPanel();
    });

    socket.on('room-joined', (data) => {
        roomState.code = data.code;
        roomState.players = data.players;
        roomState.isHost = false;
        roomState.teamColors = data.teamColors || [...TEAM_DEFAULTS.colors];
        roomState.teamCaptains = data.teamCaptains || {};
        // 从玩家列表中找到自己
        const me = data.players.find(p => p.id === socket.id);
        roomState.myTeam = me ? me.team : 0;
        window.isMultiplayerHost = false;
        window.mpRoomCode = data.code;
        // 应用房主同步的棋盘与格式状态
        if (data.state) {
            applyIncomingState(data.state);
        }
        // 非房主成员禁用棋盘上方三个按钮
        setBoardButtonsEnabled(false);
        showToast('已加入房间: ' + data.code, 'success');
        renderLobbyUI();
        updateConnectionUI();
        renderTeamPanel();
    });

    socket.on('player-joined', (data) => {
        roomState.players = data.players;
        if (data.teamCaptains) roomState.teamCaptains = data.teamCaptains;
        showToast('有玩家加入了房间', 'info');
        renderPlayerList();
        renderTeamPanel();
        // 房主在新成员加入时自动发射当前状态进行同步
        if (roomState.isHost) {
            emitCurrentState();
        }
    });

    socket.on('player-left', (data) => {
        roomState.players = data.players;
        if (data.teamCaptains) roomState.teamCaptains = data.teamCaptains;
        // 检测自己是否新房主
        const me = data.players.find(p => p.id === socket.id);
        if (me && me.isHost && !roomState.isHost) {
            roomState.isHost = true;
            window.isMultiplayerHost = true;
            showToast('你已成为新房主', 'info');
        }
        renderPlayerList();
        renderTeamPanel();
    });

    socket.on('host-changed', (data) => {
        const me = roomState.players.find(p => p.id === socket.id);
        if (me && me.isHost) {
            roomState.isHost = true;
            window.isMultiplayerHost = true;
            showToast('你已成为新房主', 'info');
        }
        renderPlayerList();
    });

    // --- 状态同步事件 (接收) ---
    socket.on('state-updated', (data) => {
        if (roomState.isHost) return; // 房主不需要接收自己的状态
        console.log('[MP] 收到状态同步');
        applyIncomingState(data);
    });

    socket.on('cell-updated', (data) => {
        if (roomState.isHost) return;
        if (window.cellData && data.index !== undefined) {
            window.cellData[data.index] = data.value;
            if (typeof window.applyCellDataToBoard === 'function') {
                window.applyCellDataToBoard();
            }
            if (typeof window.saveToCache === 'function') {
                window.saveToCache();
            }
        }
    });

    socket.on('map-updated', (data) => {
        if (roomState.isHost) return;
        if (window.mapData && data.index !== undefined) {
            window.mapData[data.index] = data.value;
            if (typeof window.applyCellDataToBoard === 'function') {
                window.applyCellDataToBoard();
            }
            if (typeof window.saveToCache === 'function') {
                window.saveToCache();
            }
        }
    });

    socket.on('locks-updated', (data) => {
        if (roomState.isHost) return;
        if (window.cellLocked && data.index !== undefined) {
            window.cellLocked[data.index] = data.value;
            if (typeof window.applyCellDataToBoard === 'function') {
                window.applyCellDataToBoard();
            }
        }
    });

    socket.on('format-updated', (data) => {
        if (roomState.isHost) return;
        if (window.formatDataList && data.formatDataList) {
            window.formatDataList = data.formatDataList;
            if (typeof window.renderFormatList === 'function') {
                window.renderFormatList();
            }
            if (typeof window.saveToCache === 'function') {
                window.saveToCache();
            }
        }
    });

    socket.on('map-generated', (data) => {
        if (roomState.isHost) return;
        console.log('[MP] 收到地图生成事件');
        if (data.cellData) window.cellData = data.cellData;
        if (data.mapData) window.mapData = data.mapData;
        if (typeof window.applyCellDataToBoard === 'function') {
            window.applyCellDataToBoard();
        }
        if (typeof window.saveToCache === 'function') {
            window.saveToCache();
        }
        showToast('房主已重新生成地图', 'info');
    });

    socket.on('board-cleared', () => {
        if (roomState.isHost) return;
        console.log('[MP] 收到清空面板事件');
        if (window.cellData) {
            for (let i = 0; i < window.cellData.length; i++) {
                window.cellData[i] = null;
            }
        }
        if (window.mapData) {
            for (let i = 0; i < window.mapData.length; i++) {
                window.mapData[i] = null;
            }
        }
        if (window.cellLocked) {
            for (let i = 0; i < window.cellLocked.length; i++) {
                window.cellLocked[i] = false;
            }
        }
        if (typeof window.applyCellDataToBoard === 'function') {
            window.applyCellDataToBoard();
        }
        if (typeof window.saveToCache === 'function') {
            window.saveToCache();
        }
        showToast('房主已清空面板', 'info');
    });

    socket.on('library-switched', (data) => {
        if (roomState.isHost) return;
        if (window.currentLibrary !== data.library) {
            if (typeof window.switchLibrary === 'function') {
                window.switchLibrary(data.library, true);
            }
            showToast('房主已切换曲库: ' + data.library, 'info');
        }
    });

    socket.on('room-closed', () => {
        showToast('房间已被关闭', 'warning');
        leaveRoom(true);
    });

    // --- 队伍事件 ---
    socket.on('team-updated', (data) => {
        roomState.players = data.players || roomState.players;
        if (data.teamCaptains) roomState.teamCaptains = data.teamCaptains;
        // 更新自己的队伍（如果被服务端更改）
        const me = (data.players || roomState.players).find(p => p.id === socket.id);
        if (me) roomState.myTeam = me.team;
        renderPlayerList();
        renderTeamPanel();
    });

    socket.on('team-colors-updated', (data) => {
        roomState.teamColors = data.colors || [...TEAM_DEFAULTS.colors];
        // 更新大厅中颜色拾取器的值
        document.querySelectorAll('#mp-color-customize .mp-color-picker').forEach(picker => {
            const t = parseInt(picker.dataset.team);
            if (!isNaN(t)) picker.value = roomState.teamColors[t] || TEAM_DEFAULTS.colors[t];
        });
        // 更新队伍切换中的色块
        document.querySelectorAll('#mp-team-switch .mp-team-swatch').forEach(swatch => {
            const opt = swatch.closest('.mp-team-option');
            if (opt) {
                const t = parseInt(opt.dataset.team);
                if (!isNaN(t)) swatch.style.background = roomState.teamColors[t] || TEAM_DEFAULTS.colors[t];
            }
        });
        // 更新颜色标签
        document.querySelectorAll('#mp-color-customize .mp-color-label').forEach((label, i) => {
            label.style.color = roomState.teamColors[i] || TEAM_DEFAULTS.colors[i];
        });
        // 更新自己的队伍徽章
        const badge = document.querySelector('.mp-my-team-badge');
        if (badge) {
            const myColor = roomState.teamColors[roomState.myTeam] || TEAM_DEFAULTS.colors[roomState.myTeam];
            badge.style.background = myColor;
        }
        renderPlayerList();
    });

    // --- 队长转让事件 ---
    socket.on('captain-changed', (data) => {
        roomState.teamCaptains = data.teamCaptains || roomState.teamCaptains;
        renderPlayerList();
        renderTeamPanel();  // 更新游戏页队伍面板
    });

    // --- 错误事件 ---
    socket.on('error-message', (data) => {
        showToast(data.message || '发生未知错误', 'error');
    });
}

// ---------- 房间操作 ----------
function createRoom(playerName) {
    if (!socket || !roomState.connected) {
        showToast('未连接到服务器', 'error');
        return;
    }
    const name = playerName || localStorage.getItem('mp_player_name') || '玩家' + Math.floor(Math.random() * 1000);
    localStorage.setItem('mp_player_name', name);
    socket.emit('create-room', { playerName: name, team: roomState.myTeam });
}

async function joinRoom(code, playerName) {
    if (!socket || !roomState.connected) {
        showToast('未连接到服务器', 'error');
        return;
    }
    if (!code || code.trim().length === 0) {
        showToast('请输入房间号', 'warning');
        return;
    }

    // 弹出队伍选择窗口
    const selectedTeam = await showTeamSelectPopup('join');
    roomState.myTeam = selectedTeam;

    const name = playerName || localStorage.getItem('mp_player_name') || '玩家' + Math.floor(Math.random() * 1000);
    localStorage.setItem('mp_player_name', name);
    socket.emit('join-room', { roomCode: code.trim(), playerName: name, team: selectedTeam });
}

function leaveRoom(silent) {
    if (roomState.code && socket) {
        socket.emit('leave-room', { roomCode: roomState.code });
    }
    roomState.code = null;
    roomState.players = [];
    roomState.isHost = false;
    roomState.myTeam = 0;
    roomState.teamColors = [...TEAM_DEFAULTS.colors];
    roomState.teamCaptains = {};
    window.isMultiplayerHost = false;
    window.mpRoomCode = null;
    // 离开房间后重新启用棋盘按钮
    setBoardButtonsEnabled(true);
    if (!silent) {
        renderMainMenuUI();
    }
    updateConnectionUI();
}

function copyRoomCode() {
    if (!roomState.code) return;
    navigator.clipboard.writeText(roomState.code).then(() => {
        showToast('房间号已复制: ' + roomState.code, 'success');
    }).catch(() => {
        // 降级方案
        const input = document.getElementById('mp-room-code-hidden');
        if (input) {
            input.select();
            document.execCommand('copy');
            showToast('房间号已复制: ' + roomState.code, 'success');
        }
    });
}

function changeTeam(newTeam) {
    if (!socket || !roomState.code) return;
    roomState.myTeam = newTeam;
    socket.emit('update-team', { team: newTeam });
}

function updateTeamColors(colors) {
    if (!socket || !roomState.code) return;
    roomState.teamColors = colors;
    socket.emit('update-team-colors', { colors });
}

// ---------- 房主状态同步 ----------
/**
 * 房主发出当前完整游戏状态到房间
 */
function emitCurrentState() {
    if (!roomState.isHost || !socket || !roomState.code) return;
    const state = {
        cellData: window.cellData || [],
        mapData: window.mapData || [],
        cellLocked: window.cellLocked || [],
        formatDataList: window.formatDataList || [],
        currentLibrary: window.currentLibrary || 'maimai'
    };
    socket.emit('sync-state', { roomCode: roomState.code, data: state });
}

// ---------- 按钮状态控制 ----------
/**
 * 启用/禁用棋盘上方的三个操作按钮（仅对非房主成员生效）
 * @param {boolean} enabled - true 启用, false 禁用
 */
function setBoardButtonsEnabled(enabled) {
    const btnIds = ['randomFillBtn', 'clearBoardBtn', 'genMapBtn'];
    btnIds.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            if (enabled) {
                btn.removeAttribute('disabled');
                btn.style.opacity = '';
                btn.style.cursor = '';
                btn.title = '';
            } else {
                btn.setAttribute('disabled', 'disabled');
                btn.style.opacity = '0.4';
                btn.style.cursor = 'not-allowed';
                btn.title = '仅房主可操作';
            }
        }
    });
}

// 导出到全局，供 script.js 调用
window.setBoardButtonsEnabled = setBoardButtonsEnabled;
window.emitCurrentState = emitCurrentState;

// ---------- 状态应用 ----------
function applyIncomingState(data) {
    if (!data) return;
    if (data.cellData !== undefined && window.cellData) {
        window.cellData = data.cellData;
    }
    if (data.mapData !== undefined && window.mapData) {
        window.mapData = data.mapData;
    }
    if (data.cellLocked !== undefined && window.cellLocked) {
        window.cellLocked = data.cellLocked;
    }
    if (data.formatDataList !== undefined && window.formatDataList) {
        window.formatDataList = data.formatDataList;
    }
    // 同步曲库
    if (data.currentLibrary !== undefined && window.currentLibrary !== data.currentLibrary) {
        if (typeof window.switchLibrary === 'function') {
            window.switchLibrary(data.currentLibrary, true);
        }
    }
    if (typeof window.applyCellDataToBoard === 'function') {
        window.applyCellDataToBoard();
    }
    if (typeof window.renderFormatList === 'function') {
        window.renderFormatList();
    }
    if (typeof window.saveToCache === 'function') {
        window.saveToCache();
    }
}

// ---------- UI 渲染 ----------
function getMultiplayerContainer() {
    return document.getElementById('mp-container');
}

function updateConnectionUI() {
    const statusEl = document.getElementById('mp-connection-status');
    if (!statusEl) return;
    if (roomState.connected) {
        statusEl.innerHTML = '<span class="mp-status-dot connected"></span> 已连接';
        statusEl.className = 'mp-connection-status connected';
    } else {
        statusEl.innerHTML = '<span class="mp-status-dot disconnected"></span> 未连接';
        statusEl.className = 'mp-connection-status disconnected';
    }
}

function renderMainMenuUI() {
    const container = getMultiplayerContainer();
    if (!container) return;

    const savedName = localStorage.getItem('mp_player_name') || '';

    container.innerHTML = `
        <div class="mp-page">
            <div class="mp-header">
                <h2 class="mp-title">🌐 联机协同</h2>
                <div id="mp-connection-status" class="mp-connection-status ${roomState.connected ? 'connected' : 'disconnected'}">
                    <span class="mp-status-dot ${roomState.connected ? 'connected' : 'disconnected'}"></span>
                    ${roomState.connected ? '已连接' : '未连接'}
                </div>
            </div>

            <div class="mp-section">
                <h3 class="mp-section-title">� 选择队伍</h3>
                <p class="mp-section-desc">选择你要加入的队伍（进入房间后可随时切换）</p>
                <div class="mp-team-selector" id="mp-team-selector">
                    ${TEAM_DEFAULTS.colors.map((color, i) => `
                        <div class="mp-team-option ${roomState.myTeam === i ? 'selected' : ''}" data-team="${i}" style="--team-color: ${color}">
                            <div class="mp-team-swatch" style="background: ${color}"></div>
                            <span class="mp-team-label">${TEAM_DEFAULTS.names[i]}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="mp-section">
                <h3 class="mp-section-title">�🎮 创建房间</h3>
                <p class="mp-section-desc">创建一个新房间，邀请朋友加入一起协同编辑</p>
                <div class="mp-input-row">
                    <input type="text" id="mp-create-name" class="mp-input" value="${escapeHtml(savedName)}" placeholder="你的昵称" maxlength="20">
                    <button class="mp-btn mp-btn-primary" id="mp-create-btn">创建房间</button>
                </div>
            </div>

            <div class="mp-divider">
                <span>或</span>
            </div>

            <div class="mp-section">
                <h3 class="mp-section-title">🔗 加入房间</h3>
                <p class="mp-section-desc">输入房间号加入已有的协同会话</p>
                <div class="mp-input-row">
                    <input type="text" id="mp-join-code" class="mp-input mp-code-input" placeholder="6位房间号" maxlength="6" pattern="[0-9]{6}" inputmode="numeric">
                </div>
                <div class="mp-input-row" style="margin-top: 8px;">
                    <input type="text" id="mp-join-name" class="mp-input" value="${escapeHtml(savedName)}" placeholder="你的昵称" maxlength="20">
                    <button class="mp-btn mp-btn-primary" id="mp-join-btn">加入房间</button>
                </div>
            </div>
        </div>
    `;

    bindMainMenuEvents();
    updateConnectionUI();
}

function renderLobbyUI() {
    const container = getMultiplayerContainer();
    if (!container) return;

    const myTeamColor = roomState.teamColors[roomState.myTeam] || TEAM_DEFAULTS.colors[roomState.myTeam];

    container.innerHTML = `
        <div class="mp-page">
            <div class="mp-header">
                <h2 class="mp-title">🌐 联机协同</h2>
                <div id="mp-connection-status" class="mp-connection-status ${roomState.connected ? 'connected' : 'disconnected'}">
                    <span class="mp-status-dot ${roomState.connected ? 'connected' : 'disconnected'}"></span>
                    ${roomState.connected ? '已连接' : '未连接'}
                </div>
            </div>

            <div class="mp-room-info">
                <div class="mp-room-code-section">
                    <span class="mp-room-label">房间号</span>
                    <span class="mp-room-code">${escapeHtml(roomState.code)}</span>
                    <button class="mp-btn mp-btn-sm" id="mp-copy-code">📋 复制</button>
                    <input type="text" id="mp-room-code-hidden" value="${escapeHtml(roomState.code)}" style="position:absolute;opacity:0;pointer-events:none;" readonly>
                </div>
                <div class="mp-room-role">
                    <span class="mp-my-team-badge" style="background: ${myTeamColor}">${TEAM_DEFAULTS.names[roomState.myTeam]}</span>
                    ${roomState.isHost ? '<span class="mp-badge mp-badge-host">👑 房主</span>' : '<span class="mp-badge mp-badge-guest">👤 成员</span>'}
                </div>
            </div>

            <div class="mp-section">
                <h3 class="mp-section-title">👥 在线玩家 (${roomState.players.length})</h3>
                <div id="mp-player-list" class="mp-player-list">
                    ${renderPlayerListHTML()}
                </div>
            </div>

            <div class="mp-section">
                <h3 class="mp-section-title">🔄 切换队伍</h3>
                <div class="mp-team-switch" id="mp-team-switch">
                    ${TEAM_DEFAULTS.colors.map((color, i) => `
                        <div class="mp-team-option ${roomState.myTeam === i ? 'selected' : ''}" data-team="${i}" style="--team-color: ${color}">
                            <div class="mp-team-swatch" style="background: ${color}"></div>
                            <span class="mp-team-label">${TEAM_DEFAULTS.names[i]}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="mp-section">
                <h3 class="mp-section-title">🎨 自定义队伍颜色</h3>
                <p class="mp-section-desc">修改颜色后将同步到房间内所有玩家</p>
                <div class="mp-color-customize" id="mp-color-customize">
                    ${TEAM_DEFAULTS.colors.map((color, i) => `
                        <div class="mp-color-row">
                            <span class="mp-color-label" style="color: ${roomState.teamColors[i] || color}">${TEAM_DEFAULTS.names[i]}</span>
                            <input type="color" class="mp-color-picker" data-team="${i}" value="${roomState.teamColors[i] || color}">
                        </div>
                    `).join('')}
                </div>
            </div>

            ${roomState.isHost ? `
            <div class="mp-section">
                <h3 class="mp-section-title">⚙️ 房主控制</h3>
                <p class="mp-section-desc">你所有的编辑操作都会实时同步给其他玩家</p>
            </div>
            ` : `
            <div class="mp-section">
                <h3 class="mp-section-title">📡 同步状态</h3>
                <p class="mp-section-desc">正在接收房主的实时编辑同步，你的编辑不会影响他人</p>
            </div>
            `}

            <div class="mp-actions">
                <button class="mp-btn mp-btn-danger" id="mp-leave-btn">离开房间</button>
            </div>
        </div>
    `;

    bindLobbyEvents();
    updateConnectionUI();
}

function renderPlayerListHTML() {
    return roomState.players.map(p => {
        const teamColor = roomState.teamColors[p.team] || TEAM_DEFAULTS.colors[p.team] || TEAM_DEFAULTS.colors[0];
        const isMe = p.id === (socket ? socket.id : '');
        const isCaptain = p.isCaptain || (roomState.teamCaptains && roomState.teamCaptains[p.team] === p.id);
        return `
        <div class="mp-player-item" data-player-id="${escapeHtml(p.id)}" data-player-team="${p.team}">
            <span class="mp-team-dot" style="background: ${teamColor}" title="${TEAM_DEFAULTS.names[p.team] || (typeof p.team === 'number' ? '队伍 ' + (p.team + 1) : '未分配队伍')}"></span>
            <span class="mp-player-avatar">${p.isHost ? '👑' : (isCaptain ? '⭐' : '🎵')}</span>
            <span class="mp-player-name">${escapeHtml(p.name)}</span>
            ${p.isHost ? '<span class="mp-badge mp-badge-host-sm">房主</span>' : ''}
            ${isCaptain && !p.isHost ? '<span class="mp-badge mp-badge-captain">队长</span>' : ''}
            ${isMe ? '<span class="mp-badge mp-badge-me">你</span>' : ''}
        </div>
    `}).join('');
}

function renderPlayerList() {
    const listEl = document.getElementById('mp-player-list');
    if (!listEl) return;
    listEl.innerHTML = renderPlayerListHTML();

    // 绑定右键菜单（队长转让）
    bindPlayerContextMenu(listEl);

    // 更新人数
    const titleEl = listEl.closest('.mp-section')?.querySelector('.mp-section-title');
    if (titleEl) {
        titleEl.textContent = `👥 在线玩家 (${roomState.players.length})`;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ---------- 右键菜单（队长转让） ----------
let contextMenuEl = null;

function removeContextMenu() {
    if (contextMenuEl) {
        contextMenuEl.remove();
        contextMenuEl = null;
    }
}

function showContextMenu(x, y, playerId, playerName, playerTeam) {
    removeContextMenu();

    const menu = document.createElement('div');
    menu.className = 'mp-context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.innerHTML = `
        <div class="mp-context-item" data-action="transfer-captain">
            👑 转让队长给 ${escapeHtml(playerName)}
        </div>
        <div class="mp-context-item mp-context-cancel" data-action="cancel">取消</div>
    `;

    menu.addEventListener('click', (e) => {
        const item = e.target.closest('.mp-context-item');
        if (!item) { removeContextMenu(); return; }
        const action = item.dataset.action;
        if (action === 'transfer-captain') {
            transferCaptain(playerId, playerTeam);
        }
        removeContextMenu();
    });

    // 点击其他地方关闭
    setTimeout(() => {
        document.addEventListener('click', removeContextMenu, { once: true });
    }, 0);

    document.body.appendChild(menu);
    contextMenuEl = menu;
}

function bindPlayerContextMenu(listEl) {
    listEl.querySelectorAll('.mp-player-item').forEach(item => {
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const playerId = item.dataset.playerId;
            const playerTeam = parseInt(item.dataset.playerTeam);
            const playerName = item.querySelector('.mp-player-name')?.textContent || '';

            // 检查我是否是该队的队长
            const isMyTeam = playerTeam === roomState.myTeam;
            const isMeCaptain = roomState.teamCaptains && roomState.teamCaptains[playerTeam] === (socket ? socket.id : '');
            const isTargetMe = playerId === (socket ? socket.id : '');
            const isTargetCaptain = roomState.teamCaptains && roomState.teamCaptains[playerTeam] === playerId;

            if (!isMyTeam || !isMeCaptain || isTargetMe) return;

            showContextMenu(e.pageX, e.pageY, playerId, playerName, playerTeam);
        });
    });
}

function transferCaptain(targetId, team) {
    if (!socket || !roomState.code) return;
    socket.emit('transfer-captain', {
        roomCode: roomState.code,
        targetId: targetId,
        team: team,
    });
    showToast('已请求转让队长', 'info');
}

// ---------- 游戏页队伍面板 ----------
/**
 * 在游戏页面右下方渲染三个队伍列表面板
 */
function renderTeamPanel() {
    let panel = document.getElementById('mp-team-panel');
    if (!panel) return;

    const teams = [0, 1, 2];
    panel.innerHTML = teams.map(team => {
        const color = roomState.teamColors[team] || TEAM_DEFAULTS.colors[team];
        const teamPlayers = roomState.players.filter(p => p.team === team);
        const captainId = roomState.teamCaptains && roomState.teamCaptains[team];
        return `
        <div class="mp-team-card" style="--team-color: ${color}">
            <div class="mp-team-card-header" style="background: ${color}">
                <span class="mp-team-card-name">${TEAM_DEFAULTS.names[team]}</span>
                <span class="mp-team-card-count">${teamPlayers.length}人</span>
            </div>
            <div class="mp-team-card-body">
                ${teamPlayers.length === 0
                    ? '<div class="mp-team-card-empty">暂无成员</div>'
                    : teamPlayers.map(p => {
                        const isCaptain = captainId === p.id;
                        const isMe = p.id === (socket ? socket.id : '');
                        return `
                        <div class="mp-team-card-player ${isCaptain ? 'is-captain' : ''} ${isMe ? 'is-me' : ''}">
                            <span class="mp-team-card-avatar">${isCaptain ? '⭐' : '🎵'}</span>
                            <span class="mp-team-card-pname">${escapeHtml(p.name)}</span>
                            ${isCaptain ? '<span class="mp-team-card-captain-badge">队长</span>' : ''}
                            ${isMe ? '<span class="mp-team-card-me-badge">我</span>' : ''}
                        </div>`;
                    }).join('')}
            </div>
        </div>`;
    }).join('');

    // 同时更新全局导出
    window.renderTeamPanel = renderTeamPanel;
}

/** 初始化队伍面板容器（在游戏页加载时调用） */
function initTeamPanel() {
    let panel = document.getElementById('mp-team-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'mp-team-panel';
        panel.className = 'mp-team-panel';
        const gameArea = document.querySelector('.game-container') || document.getElementById('game-page') || document.body;
        gameArea.appendChild(panel);
    }
    renderTeamPanel();
}

// 导出到全局
window.renderTeamPanel = renderTeamPanel;
window.initTeamPanel = initTeamPanel;

// ---------- 队伍选择弹窗 ----------
/**
 * 显示队伍选择弹窗，返回 Promise<teamIndex>
 */
function showTeamSelectPopup(purpose) {
    return new Promise((resolve) => {
        // 移除已有弹窗
        const existing = document.querySelector('.mp-team-popup-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'mp-team-popup-overlay';

        const popup = document.createElement('div');
        popup.className = 'mp-team-popup';
        popup.innerHTML = `
            <div class="mp-team-popup-header">${purpose === 'join' ? '选择队伍加入房间' : '选择队伍'}</div>
            <div class="mp-team-popup-subtitle">选择你要加入的队伍，第一个进入队伍的成员将成为队长</div>
            <div class="mp-team-popup-options">
                ${TEAM_DEFAULTS.colors.map((color, i) => `
                    <div class="mp-team-popup-option" data-team="${i}" style="--team-color: ${color}">
                        <div class="mp-team-popup-swatch" style="background: ${color}"></div>
                        <div class="mp-team-popup-label">${TEAM_DEFAULTS.names[i]}</div>
                    </div>
                `).join('')}
            </div>
        `;

        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        // 点击队伍选项
        popup.querySelectorAll('.mp-team-popup-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const team = parseInt(opt.dataset.team);
                overlay.remove();
                resolve(team);
            });
        });

        // 点击遮罩层关闭（默认选队伍0）
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(0);
            }
        });
    });
}

// ---------- 事件绑定 ----------
function bindMainMenuEvents() {
    // 队伍选择
    document.querySelectorAll('#mp-team-selector .mp-team-option').forEach(el => {
        el.addEventListener('click', () => {
            const team = parseInt(el.dataset.team);
            if (isNaN(team)) return;
            roomState.myTeam = team;
            document.querySelectorAll('#mp-team-selector .mp-team-option').forEach(e => e.classList.remove('selected'));
            el.classList.add('selected');
        });
    });

    // 创建房间
    document.getElementById('mp-create-btn')?.addEventListener('click', () => {
        const name = document.getElementById('mp-create-name')?.value?.trim();
        createRoom(name || undefined);
    });

    // 回车创建
    document.getElementById('mp-create-name')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('mp-create-btn')?.click();
        }
    });

    // 加入房间
    document.getElementById('mp-join-btn')?.addEventListener('click', () => {
        const code = document.getElementById('mp-join-code')?.value?.trim();
        const name = document.getElementById('mp-join-name')?.value?.trim();
        joinRoom(code, name || undefined);
    });

    // 回车加入
    document.getElementById('mp-join-code')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('mp-join-btn')?.click();
        }
    });
    document.getElementById('mp-join-name')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('mp-join-btn')?.click();
        }
    });
}

function bindLobbyEvents() {
    document.getElementById('mp-copy-code')?.addEventListener('click', copyRoomCode);
    document.getElementById('mp-leave-btn')?.addEventListener('click', () => leaveRoom());

    // 队伍切换
    document.querySelectorAll('#mp-team-switch .mp-team-option').forEach(el => {
        el.addEventListener('click', () => {
            const team = parseInt(el.dataset.team);
            if (isNaN(team) || team === roomState.myTeam) return;
            roomState.myTeam = team;
            changeTeam(team);
            // 重新渲染以更新 UI
            renderPlayerList();
            // 更新自己的队伍徽章
            const color = roomState.teamColors[team] || TEAM_DEFAULTS.colors[team];
            const badge = document.querySelector('.mp-my-team-badge');
            if (badge) {
                badge.style.background = color;
                badge.textContent = TEAM_DEFAULTS.names[team];
            }
            document.querySelectorAll('#mp-team-switch .mp-team-option').forEach(e => e.classList.remove('selected'));
            el.classList.add('selected');
        });
    });

    // 颜色自定义
    document.querySelectorAll('#mp-color-customize .mp-color-picker').forEach(picker => {
        picker.addEventListener('input', () => {
            const team = parseInt(picker.dataset.team);
            if (isNaN(team)) return;
            const newColors = [...roomState.teamColors];
            newColors[team] = picker.value;
            updateTeamColors(newColors);
            // 实时更新相关 UI
            roomState.teamColors = newColors;
            renderPlayerList();
            // 更新队伍切换中的色块
            const swatchEl = document.querySelector(`#mp-team-switch .mp-team-option[data-team="${team}"] .mp-team-swatch`);
            if (swatchEl) swatchEl.style.background = picker.value;
            document.querySelectorAll(`#mp-team-switch .mp-team-option[data-team="${team}"]`).forEach(el => {
                el.style.setProperty('--team-color', picker.value);
            });
            // 更新颜色标签文字颜色
            const labelEl = document.querySelector(`#mp-color-customize .mp-color-row:nth-child(${team + 1}) .mp-color-label`);
            if (labelEl) labelEl.style.color = picker.value;
            // 更新自己的队伍徽章
            const badge = document.querySelector('.mp-my-team-badge');
            if (badge && team === roomState.myTeam) {
                badge.style.background = picker.value;
            }
        });
    });
}

// ---------- 页面入口 (由 script.js 调用) ----------
window.initMultiplayerPage = function() {
    if (!socket) {
        connectSocket();
    }
    if (roomState.code) {
        renderLobbyUI();
    } else {
        renderMainMenuUI();
    }
};

window.destroyMultiplayerPage = function() {
    // 页面切换时的清理（不离开房间）
};

// ---------- 自动初始化 ----------
// 当页面加载且 Socket.IO 已可用时自动连接
if (typeof io !== 'undefined') {
    connectSocket();
} else {
    // Socket.IO CDN 可能还没加载，等待
    window.addEventListener('load', () => {
        if (typeof io !== 'undefined') {
            connectSocket();
        } else {
            console.warn('[MP] Socket.IO 未加载，请检查 CDN 引用');
        }
    });
}
