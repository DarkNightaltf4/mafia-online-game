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

// --- НОВАЯ, ИСПРАВЛЕННАЯ СУПЕР-ФУНКЦИЯ ---
function buildParticipantViewFor(viewer, allParticipants) {
  // Правило №1: Организатор видит абсолютно всё.
  if (viewer.role === 'organizer') {
    return allParticipants.map(p => {
      let color = 'black'; // Цвет по умолчанию
      if (p.role === 'mafia') color = 'red';
      if (p.role === 'doctor') color = 'green';
      if (p.role === 'commissar') color = 'brown';
      // Возвращаем полную, нетронутую информацию + цвет
      return { ...p, color };
    });
  }

  // Правило №2 и №3: Собираем список для обычного игрока.
  return allParticipants.map(p => {
    // Условие A: Это я сам?
    if (p.id === viewer.id) {
      // Игрок всегда видит свою собственную роль и имя.
      return { ...p, color: viewer.role === 'mafia' ? 'red' : 'black' };
    }

    // Условие B: Я мафия, и этот игрок тоже мафия?
    if (viewer.role === 'mafia' && p.role === 'mafia') {
      // Мафия видит своих тиммейтов.
      return { ...p, color: 'red' };
    }

    // Условие C (Для всех остальных случаев): Это другой игрок, чью роль я не должен знать.
    return {
      id: p.id,
      name: `Участник ${p.id}`, // <-- КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: МЕНЯЕМ ИМЯ НА ОБЕЗЛИЧЕННОЕ
      alive: p.alive,
      role: p.role === 'organizer' ? 'organizer' : 'Участник', // Меняем роль на обезличенную
      color: 'black'
    };
  });
}

// Вспомогательная функция для обновления списков у всех игроков
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

    const personalizedInitialList = buildParticipantViewFor(user, room.participants);
    const personalizedRoomState = { ...room, participants: personalizedInitialList };
    socket.emit('loginSuccess', personalizedRoomState);

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

        if (tab === 'general' && recipient.role !== 'organizer') {
            messageToSend.sender = `Участник ${sender.id}`;
        }

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