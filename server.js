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

let currentWorld = 1;

function freeElement(id) {
  const el = players[id]?.element;
  if (el && elementTaken[el] === id) elementTaken[el] = null;
}

function respawnPlayer(p) {
  p.x = p.element === 'fire' ? FIRE_SPAWN_X : WATER_SPAWN_X;
  p.y = SPAWN_Y;
  p.velY = 0;
  p.onGround = false;
  p.atDoor = false;
}

function tryAdvanceWorld() {
  if (currentWorld !== 1) return;

  const active = Object.values(players).filter(p => p.element);
  if (active.length < 2) return;

  const fireAt = active.some(p => p.element === 'fire' && p.atDoor);
  const waterAt = active.some(p => p.element === 'water' && p.atDoor);
  if (!fireAt || !waterAt) return;

  currentWorld = 2;
  for (const id in players) {
    if (players[id].element) respawnPlayer(players[id]);
  }
}

io.on('connection', socket => {
  const id = socket.id;
  players[id] = { x: FIRE_SPAWN_X, y: SPAWN_Y, velY: 0, onGround: false, color: null, element: null, atDoor: false };
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
    players[id] = { x, y: SPAWN_Y, velY: 0, onGround: false, color, element, atDoor: false };
    socket.emit('chooseOk', { color, element });
  });

  socket.on('move', data => {
    if (!players[id]?.color) return;
    Object.assign(players[id], data);
    tryAdvanceWorld();
  });

  socket.on('disconnect', () => {
    freeElement(id);
    delete players[id];
  });
});

setInterval(() => {
  io.emit('state', { players, world: currentWorld });
}, 1000 / 30);

http.listen(3000, () => console.log('Server running on http://localhost:3000'));
