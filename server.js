const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const rooms = {};

io.on('connection', (socket) => {
  console.log('Подключился новый игрок:', socket.id);

  socket.on('login', (data) => {
    const { organizerId, user } = data;
    
    if (!rooms[organizerId]) {
      rooms[organizerId] = {
        participants: [],
        messages: { general: [], role: [], organizer: [] },
      };
    }

    const room = rooms[organizerId];
    
    if (!room.participants.some(p => p.id === user.id)) {
      room.participants.push(user);
    }

    socket.join(organizerId);
    console.log(`Игрок ${user.name} вошел в комнату ${organizerId}`);

    socket.emit('loginSuccess', room);
    io.to(organizerId).emit('updateParticipants', room.participants);
  });

  socket.on('sendMessage', (data) => {
    const { organizerId, message, tab } = data;
    const room = rooms[organizerId];

    if (room && room.messages[tab]) {
      room.messages[tab].push(message);
      io.to(organizerId).emit('newMessage', { message, tab });
    }
  });

  socket.on('disconnect', () => {
    console.log('Игрок отключился:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});