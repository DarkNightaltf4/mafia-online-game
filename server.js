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

// Вспомогательная функция, которая создает "публичную" версию списка участников
function getPublicParticipants(participants) {
  return participants.map(p => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    role: p.role === 'organizer' ? 'organizer' : 'Участник'
  }));
}

// Запускается каждый раз, когда новый пользователь подключается
io.on('connection', (socket) => {
  console.log('Подключился новый игрок:', socket.id);

  // Обработчик входа в игру
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

    if (user.role === 'organizer') {
        socket.emit('loginSuccess', room);
    } else {
        const publicRoomState = { ...room, participants: getPublicParticipants(room.participants) };
        socket.emit('loginSuccess', publicRoomState);
    }

    const socketsInRoom = await io.in(organizerId).fetchSockets();
    for (const connectedSocket of socketsInRoom) {
      if (connectedSocket.data.user?.role === 'organizer') {
        connectedSocket.emit('updateParticipants', room.participants);
      } else {
        connectedSocket.emit('updateParticipants', getPublicParticipants(room.participants));
      }
    }
  });


  // --- ПОЛНОСТЬЮ ПЕРЕРАБОТАННЫЙ ОБРАБОТЧИК СООБЩЕНИЙ ---
  socket.on('sendMessage', async (data) => {
    const { organizerId, text, tab } = data;
    const room = rooms[organizerId];
    const sender = socket.data.user;

    if (!room || !sender) return; // Проверка, что все данные на месте

    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // 1. Создаем "настоящее" сообщение с реальной ролью в имени
    const trueMessage = {
        sender: sender.name, // Например, "Мафия 1"
        senderId: sender.id,
        text: text,
        time: timeString
    };

    // 2. Создаем "публичное" сообщение с обезличенным именем
    const publicMessage = {
        ...trueMessage,
        sender: `Участник ${sender.id}` // Всегда "Участник + номер"
    };

    // 3. Сохраняем в историю чата на сервере всегда "настоящее" сообщение
    if (!room.messages[tab]) room.messages[tab] = [];
    room.messages[tab].push(trueMessage);

    // 4. Рассылаем игрокам правильные версии сообщения
    const socketsInRoom = await io.in(organizerId).fetchSockets();

    for (const connectedSocket of socketsInRoom) {
        const recipient = connectedSocket.data.user;

        // Если это общий чат, и получатель - не организатор, отправляем ему публичную версию
        if (tab === 'general' && recipient.role !== 'organizer') {
            connectedSocket.emit('newMessage', { message: publicMessage, tab });
        } else {
            // Во всех остальных случаях (чат роли, чат организатора, или если получатель - сам организатор)
            // отправляем настоящую версию сообщения
            connectedSocket.emit('newMessage', { message: trueMessage, tab });
        }
    }
  });


  // Обработчик отключения
  socket.on('disconnect', () => {
    console.log('Игрок отключился:', socket.id);
  });
});

// --- 4. Запускаем сервер ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});