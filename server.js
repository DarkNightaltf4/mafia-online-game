// --- 1. Подключаем необходимые библиотеки ---
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- 2. Настраиваем сервер для отдачи нашего index.html ---
app.use(express.static(path.join(__dirname, '')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- 3. Главная логика игры на сервере ---

const rooms = {}; // Хранилище всех игровых комнат

// --- НОВАЯ СУПЕР-ФУНКЦИЯ, КОТОРАЯ ГОТОВИТ ПЕРСОНАЛЬНЫЙ ВИД ДЛЯ КАЖДОГО ИГРОКА ---
function buildParticipantViewFor(viewer, allParticipants) {
  // Если смотрящий - организатор, он видит всё и с цветами
  if (viewer.role === 'organizer') {
    return allParticipants.map(p => {
      let color = 'black'; // Цвет по умолчанию
      if (p.role === 'mafia') color = 'red';
      if (p.role === 'doctor') color = 'green';
      if (p.role === 'commissar') color = 'brown';
      return { ...p, color }; // Возвращаем участника с полной инфой + цветом
    });
  }

  // Если смотрящий - мафия, он видит своих тиммейтов
  if (viewer.role === 'mafia') {
    return allParticipants.map(p => {
      // Если участник, на которого мы смотрим, тоже мафия...
      if (p.role === 'mafia') {
        return { ...p, color: 'red' }; // ...показываем его роль и красим в красный.
      }
      // Всех остальных скрываем
      return {
        id: p.id,
        name: p.name,
        alive: p.alive,
        role: p.role === 'organizer' ? 'organizer' : 'Участник', // Скрываем роль
        color: 'black'
      };
    });
  }

  // Все остальные (доктор, комиссар, мирные) видят публичную версию
  return allParticipants.map(p => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    role: p.role === 'organizer' ? 'organizer' : 'Участник',
    color: 'black'
  }));
}

// --- НОВАЯ ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ОБНОВЛЕНИЯ ВСЕХ СПИСКОВ ---
async function updateAllParticipantLists(organizerId) {
    const room = rooms[organizerId];
    if (!room) return;

    const socketsInRoom = await io.in(organizerId).fetchSockets();
    for (const connectedSocket of socketsInRoom) {
        const viewer = connectedSocket.data.user;
        if (viewer) {
            const personalizedList = buildParticipantViewFor(viewer, room.participants);
            connectedSocket.emit('updateParticipants', personalizedList);
        }
    }
}


io.on('connection', (socket) => {
  console.log('Подключился новый игрок:', socket.id);

  socket.on('login', async (data) => {
    const { organizerId, user } = data;
    if (!rooms[organizerId]) {
      rooms[organizerId] = { participants: [], messages: { general: [], role: [], organizer: [] } };
    }
    const room = rooms[organizerId];
    socket.data.user = user;
    socket.data.organizerId = organizerId;
    if (!room.participants.some(p => p.id === user.id)) {
      room.participants.push(user);
    }
    await socket.join(organizerId);
    console.log(`Игрок ${user.name} вошел в комнату ${organizerId}`);

    // Отправляем новому игроку его персональную версию комнаты при входе
    const personalizedInitialList = buildParticipantViewFor(user, room.participants);
    const personalizedRoomState = { ...room, participants: personalizedInitialList };
    socket.emit('loginSuccess', personalizedRoomState);

    // Обновляем списки у ВСЕХ игроков в комнате
    await updateAllParticipantLists(organizerId);
  });

  socket.on('sendMessage', async (data) => {
    const { organizerId, text, tab } = data;
    const room = rooms[organizerId];
    const sender = socket.data.user;
    if (!room || !sender) return;

    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const trueMessage = { sender: sender.name, senderId: sender.id, text, time: timeString };
    if (!room.messages[tab]) room.messages[tab] = [];
    room.messages[tab].push(trueMessage);

    const socketsInRoom = await io.in(organizerId).fetchSockets();
    for (const connectedSocket of socketsInRoom) {
        const recipient = connectedSocket.data.user;
        if (!recipient) continue;

        let messageToSend = { ...trueMessage };

        // Логика анонимизации и цвета для общего чата
        if (tab === 'general' && recipient.role !== 'organizer') {
            messageToSend.sender = `Участник ${sender.id}`;
        }

        // Логика цвета для мафии
        if (sender.role === 'mafia' && (recipient.role === 'mafia' || recipient.role === 'organizer')) {
            messageToSend.color = 'red';
        }

        connectedSocket.emit('newMessage', { message: messageToSend, tab });
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