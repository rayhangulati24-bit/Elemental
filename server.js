const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

const players = {};

io.on('connection', socket => {
  const id = socket.id;
  players[id] = {x: id==='player1'?100:600, y:400, velY:0, onGround:false};
  socket.emit('init', id);

  socket.on('move', data => { players[id] = data; });

  socket.on('disconnect', () => { delete players[id]; });
});

setInterval(() => {
  io.emit('state', players);
}, 1000/60);

http.listen(3000, () => console.log('Server running on http://localhost:3000'));
