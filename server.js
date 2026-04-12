const express = require('express');
const os = require('os');
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

function firstLanIPv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      const v4 = net.family === 'IPv4' || net.family === 4;
      if (net && v4 && !net.internal) return net.address;
    }
  }
  return null;
}

http.listen(3000, '0.0.0.0', () => {
  console.log('Server running on http://localhost:3000');
  const lan = firstLanIPv4();
  if (lan) console.log('iPad / phone (same WiFi): http://' + lan + ':3000');
});
