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

// УПРОЩЕННАЯ функция, которая отправляет полный список участников ТОЛЬКО организаторам
async function updateOrganizerParticipantList(organizerId) {
    const room = rooms[organizerId];
    if (!room) return;
    // Отправляем событие ТОЛЬКО в подкомнату для организаторов
    io.to(organizerId + '-organizers').emit('updateParticipants', room.participants);
}


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

    if (!room.participants.some(p => p.id === user.id)) {
      room.participants.push(user);
    }
    
    await socket.join(organizerId); // Все входят в основную комнату
    // Если это организатор, он ДОПОЛНИТЕЛЬНО входит в секретную подкомнату
    if (user.role === 'organizer') {
        await socket.join(organizerId + '-organizers');
    }
    console.log(`Игрок ${user.name} вошел в комнату ${organizerId}`);

    // Отправляем новому игроку подтверждение входа
    if (user.role === 'organizer') {
        // Организатор получает полную инфу о комнате
        socket.emit('loginSuccess', room);
    } else {
        // Обычный игрок получает состояние комнаты, но с ПУСТЫМ списком участников
        const publicRoomState = { ...room, participants: [] };
        socket.emit('loginSuccess', publicRoomState);
    }

    // После каждого входа обновляем список у организаторов
    await updateOrganizerParticipantList(organizerId);
  });


  // Обработчик сообщений (логика анонимизации для общего чата осталась)
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
        
        // Простое окрашивание мафии для своих и для орга
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