const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// 房间存储: roomCode -> { hostId, players: Map<socketId, {name, isHost}>, createdAt }
const rooms = new Map();

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
    rooms.set(roomCode, {
      hostId: socket.id,
      players: new Map([[socket.id, { name: playerName, isHost: true }]]),
      createdAt: Date.now(),
      state: null
    });
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerName = playerName;
    socket.emit('room-created', { code: roomCode, players: getPlayerList(roomCode) });
    if (typeof callback === 'function') callback({ success: true, roomCode, players: getPlayerList(roomCode) });
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
    room.players.set(socket.id, { name: playerName || 'Player', isHost: false });
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerName = playerName;
    socket.emit('room-joined', { code: roomCode, players: getPlayerList(roomCode), state: room.state });
    if (typeof callback === 'function') callback({ success: true, players: getPlayerList(roomCode), state: room.state });
    socket.to(roomCode).emit('player-joined', { players: getPlayerList(roomCode) });
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

  // 断线处理
  socket.on('disconnect', () => {
    handleLeaveRoom(socket);
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

function getPlayerList(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return [];
  return Array.from(room.players.values()).map(p => ({ name: p.name, isHost: p.isHost }));
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
    io.to(roomCode).emit('player-left', { players: getPlayerList(roomCode) });
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
