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

// Здесь будет храниться состояние всех игровых комнат
const rooms = {};

// НОВАЯ ФУНКЦИЯ для создания "безопасного" списка участников для игроков
function getPublicParticipants(participants) {
  return participants.map(p => {
    // Мы копируем все данные участника, но заменяем его роль
    return {
      id: p.id,
      name: p.name,
      alive: p.alive,
      // Роль организатора не секрет, а вот роли остальных скрываем
      role: p.role === 'organizer' ? 'organizer' : 'Участник'
    };
  });
}


// Эта функция запускается каждый раз, когда новый пользователь подключается к серверу
io.on('connection', (socket) => {
  console.log('Подключился новый игрок:', socket.id);

  // --- ОБНОВЛЕННЫЙ ОБРАБОТЧИК ВХОДА В ИГРУ ---
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

    socket.join(organizerId); // Присоединяем игрока к общей комнате
    // Если это организатор, присоединяем его к специальной подкомнате для оргов
    if (user.role === 'organizer') {
        socket.join(organizerId + '-organizers');
    }

    console.log(`Игрок ${user.name} вошел в комнату ${organizerId}`);

    // --- НОВАЯ УМНАЯ ЛОГИКА РАССЫЛКИ СПИСКА УЧАСТНИКОВ ---

    // 1. Отправляем ПУБЛИЧНЫЙ список (без ролей) ВСЕМ в комнате.
    io.to(organizerId).emit('updateParticipants', getPublicParticipants(room.participants));

    // 2. Отправляем ПОЛНЫЙ список (с ролями) ТОЛЬКО организаторам.
    // У них на экране этот список заменит предыдущий.
    io.to(organizerId + '-organizers').emit('updateParticipants', room.participants);
    
    // Отправляем новому игроку начальное состояние комнаты
    if (user.role === 'organizer') {
        // Организатор получает полную информацию
        socket.emit('loginSuccess', room);
    } else {
        // Обычный игрок получает "безопасную" версию
        const publicRoomState = {
            ...room,
            participants: getPublicParticipants(room.participants)
        };
        socket.emit('loginSuccess', publicRoomState);
    }
  });


  // Событие: Пришло новое сообщение в чат (этот блок без изменений)
  socket.on('sendMessage', (data) => {
    const { organizerId, message, tab } = data;
    const room = rooms[organizerId];

    if (room && room.messages[tab]) {
      room.messages[tab].push(message);
      io.to(organizerId).emit('newMessage', { message, tab });
    }
  });

  // Событие: Пользователь отключается (этот блок без изменений)
  socket.on('disconnect', () => {
    console.log('Игрок отключился:', socket.id);
    // В будущем здесь нужно будет добавить логику удаления игрока из списка
  });
});


// --- 4. Запускаем сервер ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});