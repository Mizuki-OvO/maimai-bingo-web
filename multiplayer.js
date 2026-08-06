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

// ---------- 状态 ----------
let socket = null;
let roomState = {
    code: null,             // 当前房间号
    players: [],            // [{ id, name, isHost }]
    isHost: false,          // 我是否房主
    connected: false,       // Socket 是否连接中
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
        window.isMultiplayerHost = true;
        window.mpRoomCode = data.code;
        showToast('房间已创建: ' + data.code, 'success');
        renderLobbyUI();
        updateConnectionUI();
    });

    socket.on('room-joined', (data) => {
        roomState.code = data.code;
        roomState.players = data.players;
        roomState.isHost = false;
        window.isMultiplayerHost = false;
        window.mpRoomCode = data.code;
        showToast('已加入房间: ' + data.code, 'success');
        renderLobbyUI();
        updateConnectionUI();
    });

    socket.on('player-joined', (data) => {
        roomState.players = data.players;
        showToast('有玩家加入了房间', 'info');
        renderPlayerList();
    });

    socket.on('player-left', (data) => {
        roomState.players = data.players;
        roomState.isHost = data.isHost || false;
        window.isMultiplayerHost = roomState.isHost;
        if (roomState.isHost) {
            showToast('你已成为新房主', 'info');
        }
        renderPlayerList();
        if (data.playerName) {
            showToast(data.playerName + ' 离开了房间', 'info');
        }
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
    socket.emit('create-room', { playerName: name });
}

function joinRoom(code, playerName) {
    if (!socket || !roomState.connected) {
        showToast('未连接到服务器', 'error');
        return;
    }
    if (!code || code.trim().length === 0) {
        showToast('请输入房间号', 'warning');
        return;
    }
    const name = playerName || localStorage.getItem('mp_player_name') || '玩家' + Math.floor(Math.random() * 1000);
    localStorage.setItem('mp_player_name', name);
    socket.emit('join-room', { roomCode: code.trim(), playerName: name });
}

function leaveRoom(silent) {
    if (roomState.code && socket) {
        socket.emit('leave-room', { roomCode: roomState.code });
    }
    roomState.code = null;
    roomState.players = [];
    roomState.isHost = false;
    window.isMultiplayerHost = false;
    window.mpRoomCode = null;
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
                <h3 class="mp-section-title">🎮 创建房间</h3>
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
                    ${roomState.isHost ? '<span class="mp-badge mp-badge-host">👑 房主</span>' : '<span class="mp-badge mp-badge-guest">👤 成员</span>'}
                </div>
            </div>

            <div class="mp-section">
                <h3 class="mp-section-title">👥 在线玩家 (${roomState.players.length})</h3>
                <div id="mp-player-list" class="mp-player-list">
                    ${renderPlayerListHTML()}
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
    return roomState.players.map(p => `
        <div class="mp-player-item">
            <span class="mp-player-avatar">${p.isHost ? '👑' : '🎵'}</span>
            <span class="mp-player-name">${escapeHtml(p.name)}</span>
            ${p.isHost ? '<span class="mp-badge mp-badge-host-sm">房主</span>' : ''}
            ${p.id === (socket ? socket.id : '') ? '<span class="mp-badge mp-badge-me">你</span>' : ''}
        </div>
    `).join('');
}

function renderPlayerList() {
    const listEl = document.getElementById('mp-player-list');
    if (!listEl) return;
    listEl.innerHTML = renderPlayerListHTML();

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

// ---------- 事件绑定 ----------
function bindMainMenuEvents() {
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
