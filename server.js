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

const PORT = Number(process.env.PORT) || 3000;

http.listen(PORT, '0.0.0.0', () => {
  console.log('Server listening on port', PORT);
});
