const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

const players = {};
const elementTaken = { fire: null, water: null };
const GROUND_LEFT_EXTEND = 800;
const FIRE_SPAWN_X = -GROUND_LEFT_EXTEND + 200;
const WATER_SPAWN_X = -GROUND_LEFT_EXTEND + 450;
const SPAWN_Y = 400;

function freeElement(id) {
  const el = players[id]?.element;
  if (el && elementTaken[el] === id) elementTaken[el] = null;
}

io.on('connection', socket => {
  const id = socket.id;
  players[id] = { x: FIRE_SPAWN_X, y: SPAWN_Y, velY: 0, onGround: false, color: null, element: null };
  socket.emit('init', id);

  socket.on('chooseCharacter', ({ element }) => {
    if (element !== 'fire' && element !== 'water') return;
    if (elementTaken[element] && elementTaken[element] !== id) {
      socket.emit('chooseFailed', { element });
      return;
    }

    freeElement(id);

    const color = element === 'fire' ? 'red' : 'blue';
    const x = element === 'fire' ? FIRE_SPAWN_X : WATER_SPAWN_X;
    elementTaken[element] = id;
    players[id] = { x, y: SPAWN_Y, velY: 0, onGround: false, color, element };
    socket.emit('chooseOk', { color, element });
  });

  socket.on('move', data => {
    if (!players[id]?.color) return;
    Object.assign(players[id], data);
  });

  socket.on('disconnect', () => {
    freeElement(id);
    delete players[id];
  });
});

setInterval(() => {
  io.emit('state', players);
}, 1000 / 30);

http.listen(3000, () => console.log('Server running on http://localhost:3000'));
