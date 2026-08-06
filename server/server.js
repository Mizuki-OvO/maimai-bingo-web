const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// 房间存储: roomCode -> { hostId, players: Map<socketId, {name, isHost, team}>, teamColors, teamCaptains, createdAt }
const rooms = new Map();

// 默认队伍颜色
const DEFAULT_TEAM_COLORS = ['#e74c3c', '#3498db', '#27ae60'];

// 生成6位房间码
function generateRoomCode() {
  return crypto.randomInt(100000, 999999).toString();
}

// 5分钟清理不活跃房间
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > 5 * 60 * 1000) {
      rooms.delete(code);
      io.to(code).emit('room-closed');
      console.log(`Room ${code} expired and removed`);
    }
  }
}, 60 * 1000);

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // 创建房间
  socket.on('create-room', (data, callback) => {
    const roomCode = generateRoomCode();
    const playerName = data?.playerName || 'Host';
    const creatorTeam = typeof data?.team === 'number' && data.team >= 0 && data.team <= 2 ? data.team : 0;
    const teamCaptains = { 0: null, 1: null, 2: null };
    teamCaptains[creatorTeam] = socket.id;
    rooms.set(roomCode, {
      hostId: socket.id,
      players: new Map([[socket.id, { name: playerName, isHost: true, team: creatorTeam }]]),
      teamColors: [...DEFAULT_TEAM_COLORS],
      teamCaptains,
      createdAt: Date.now(),
      state: null
    });
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerName = playerName;
    const room = rooms.get(roomCode);
    socket.emit('room-created', { code: roomCode, players: getPlayerList(roomCode), teamColors: room.teamColors, teamCaptains: room.teamCaptains });
    if (typeof callback === 'function') callback({ success: true, roomCode, players: getPlayerList(roomCode), teamColors: room.teamColors, teamCaptains: room.teamCaptains });
    console.log(`Room ${roomCode} created by ${playerName}`);
  });

  // 加入房间
  socket.on('join-room', (data, callback) => {
    const { roomCode, playerName } = data;
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit('error-message', { error: '房间不存在' });
      if (typeof callback === 'function') callback({ success: false, error: '房间不存在' });
      return;
    }
    if (room.players.has(socket.id)) {
      socket.emit('error-message', { error: '你已经在该房间中' });
      if (typeof callback === 'function') callback({ success: false, error: '你已经在该房间中' });
      return;
    }
    const playerTeam = typeof data.team === 'number' && data.team >= 0 && data.team <= 2 ? data.team : 0;
    room.players.set(socket.id, { name: playerName || 'Player', isHost: false, team: playerTeam });
    // 如果该队伍没有队长，第一个加入的自动成为队长
    if (!room.teamCaptains) room.teamCaptains = { 0: null, 1: null, 2: null };
    if (!room.teamCaptains[playerTeam]) {
      room.teamCaptains[playerTeam] = socket.id;
    }
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerName = playerName;
    socket.emit('room-joined', { code: roomCode, players: getPlayerList(roomCode), state: room.state, teamColors: room.teamColors, teamCaptains: room.teamCaptains });
    if (typeof callback === 'function') callback({ success: true, players: getPlayerList(roomCode), state: room.state, teamColors: room.teamColors, teamCaptains: room.teamCaptains });
    socket.to(roomCode).emit('player-joined', { players: getPlayerList(roomCode), teamCaptains: room.teamCaptains });
    console.log(`${playerName} joined room ${roomCode}`);
  });

  // 离开房间
  socket.on('leave-room', () => {
    handleLeaveRoom(socket);
  });

  // 同步状态（非Host同步给其他人）
  socket.on('sync-state', (state) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (socket.id !== room.hostId) return;
    room.state = state;
    socket.to(roomCode).emit('state-updated', state);
  });

  // 更新cell
  socket.on('update-cell', (data) => {
    broadcastToRoom(socket, 'cell-updated', data);
  });

  // 更新map
  socket.on('update-map', (data) => {
    broadcastToRoom(socket, 'map-updated', data);
  });

  // 更新锁定
  socket.on('update-locks', (data) => {
    broadcastToRoom(socket, 'locks-updated', data);
  });

  // 更新format
  socket.on('update-format', (data) => {
    broadcastToRoom(socket, 'format-updated', data);
  });

  // 生成地图（Host专用）
  socket.on('generate-map', (data) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostId) return;
    socket.to(roomCode).emit('map-generated', data);
  });

  // 清空面板（Host专用）
  socket.on('clear-board', (data) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostId) return;
    socket.to(roomCode).emit('board-cleared', data);
  });

  // 切换曲库（Host专用）
  socket.on('switch-library', (data) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostId) return;
    socket.to(roomCode).emit('library-switched', data);
  });

  // 切换队伍
  socket.on('update-team', (data) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    const oldTeam = player.team;
    const newTeam = typeof data.team === 'number' && data.team >= 0 && data.team <= 2 ? data.team : 0;
    player.team = newTeam;
    // 如果离开旧队伍且自己是该队队长，则清除旧队伍队长
    if (!room.teamCaptains) room.teamCaptains = { 0: null, 1: null, 2: null };
    if (room.teamCaptains[oldTeam] === socket.id) {
      room.teamCaptains[oldTeam] = null;
      // 从旧队伍中找下一个成员当队长
      for (const [pid, p] of room.players) {
        if (pid !== socket.id && p.team === oldTeam) {
          room.teamCaptains[oldTeam] = pid;
          break;
        }
      }
    }
    // 如果新队伍没有队长，该玩家自动成为队长
    if (!room.teamCaptains[newTeam]) {
      room.teamCaptains[newTeam] = socket.id;
    }
    io.to(roomCode).emit('team-updated', { playerId: socket.id, team: newTeam, players: getPlayerList(roomCode), teamCaptains: room.teamCaptains });
  });

  // 转让队长
  socket.on('transfer-captain', (data, callback) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    if (!room) { if (typeof callback === 'function') callback({ success: false, error: '房间不存在' }); return; }
    if (!room.teamCaptains) room.teamCaptains = { 0: null, 1: null, 2: null };
    const targetId = data.targetId;
    const target = room.players.get(targetId);
    if (!target) { if (typeof callback === 'function') callback({ success: false, error: '目标玩家不在房间' }); return; }
    const team = target.team;
    // 验证请求者是该队伍的当前队长
    if (room.teamCaptains[team] !== socket.id) {
      if (typeof callback === 'function') callback({ success: false, error: '你不是该队伍的队长' });
      return;
    }
    // 验证目标在同一队伍
    if (socket.id === targetId) {
      if (typeof callback === 'function') callback({ success: false, error: '不能转让给自己' });
      return;
    }
    room.teamCaptains[team] = targetId;
    io.to(roomCode).emit('captain-changed', { team, newCaptainId: targetId, oldCaptainId: socket.id, teamCaptains: room.teamCaptains });
    if (typeof callback === 'function') callback({ success: true, teamCaptains: room.teamCaptains });
    console.log(`Team ${team} captain transferred from ${socket.id} to ${targetId}`);
  });

  // 更新队伍颜色
  socket.on('update-team-colors', (data) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    if (!room || !data.colors || !Array.isArray(data.colors)) return;
    room.teamColors = data.colors.slice(0, 3);
    io.to(roomCode).emit('team-colors-updated', { colors: room.teamColors });
  });

  // 断线处理
  socket.on('disconnect', () => {
    handleLeaveRoom(socket);
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

function getPlayerList(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return [];
  return Array.from(room.players.entries()).map(([id, p]) => ({
    id, name: p.name, isHost: p.isHost, team: p.team,
    isCaptain: room.teamCaptains && room.teamCaptains[p.team] === id
  }));
}

function getRoomTeamColors(roomCode) {
  const room = rooms.get(roomCode);
  return room ? room.teamColors : [...DEFAULT_TEAM_COLORS];
}

function broadcastToRoom(socket, event, data) {
  const roomCode = socket.data.roomCode;
  if (roomCode) {
    socket.to(roomCode).emit(event, data);
  }
}

function handleLeaveRoom(socket) {
  const roomCode = socket.data.roomCode;
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  if (!room) return;
  const wasHost = socket.id === room.hostId;
  room.players.delete(socket.id);

  // 处理队长转移：如果离开者是某队队长，从该队剩余成员中找人接替
  if (!room.teamCaptains) room.teamCaptains = { 0: null, 1: null, 2: null };
  for (let t = 0; t <= 2; t++) {
    if (room.teamCaptains[t] === socket.id) {
      room.teamCaptains[t] = null;
      for (const [pid, p] of room.players) {
        if (p.team === t) {
          room.teamCaptains[t] = pid;
          break;
        }
      }
    }
  }

  if (room.players.size === 0) {
    rooms.delete(roomCode);
    console.log(`Room ${roomCode} deleted (empty)`);
  } else {
    if (wasHost) {
      // 转移Host给下一个人
      const newHostId = room.players.keys().next().value;
      room.hostId = newHostId;
      room.players.get(newHostId).isHost = true;
      io.to(roomCode).emit('host-changed', { newHostId });
    }
    io.to(roomCode).emit('player-left', { players: getPlayerList(roomCode), teamCaptains: room.teamCaptains });
  }
  socket.leave(roomCode);
  socket.data.roomCode = null;
}

// Render 健康检查端点
app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
