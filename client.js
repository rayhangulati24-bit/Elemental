const socket = io();

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const keys = {};
document.addEventListener('keydown', e => keys[e.key] = true);
document.addEventListener('keyup', e => keys[e.key] = false);

// Game variables
const players = {};
const playerWidth = 40;
const playerHeight = 50;
const gravity = 0.5;

const platforms = [
  {x:0, y:canvas.height - 50, w:canvas.width, h:50},
  {x:200, y:450, w:200, h:20},
  {x:500, y:350, w:200, h:20}
];


const hazards = [
  {type:'fire', x:250, y:530, w:100, h:20},
  {type:'water', x:550, y:330, w:100, h:20}
];

const doors = {
  fire: {x: canvas.width - 120, y: canvas.height - 100, w:50, h:70},
  water: {x: canvas.width - 60, y: canvas.height - 100, w:50, h:70}
};

let fireAtDoor = false;
let waterAtDoor = false;

let localId = null;

// Receive initial player ID
socket.on('init', id => {
  localId = id;
});

// Receive all players
socket.on('state', state => {
  for (let id in state) {
    if (!players[id]) {
      // Assign color and initialize target position
      players[id] = {
        x: state[id].x,
        y: state[id].y,
        targetX: state[id].x,
        targetY: state[id].y,
        color: id === localId ? 'red' : 'blue',
        velY:0,
        onGround:false
      };
    } else {
      // Update target position for smoothing
      players[id].targetX = state[id].x;
      players[id].targetY = state[id].y;
      players[id].velY = state[id].velY;
      players[id].onGround = state[id].onGround;
    }
  }
});


// Player movement
function updatePlayer(player) {
  if (player.id === localId) {
    // Movement
    if (keys['ArrowLeft'] || keys['a']) player.x -= 5;
    if (keys['ArrowRight'] || keys['d']) player.x += 5;
    if ((keys['ArrowUp'] || keys['w']) && player.onGround) {
      player.velY = -12;
      player.onGround = false;
    }
  }

  // Gravity
  player.velY += gravity;
  player.y += player.velY;

  // Platform collision
  player.onGround = false;
  const rect = {x: player.x, y: player.y, w: playerWidth, h: playerHeight};
  for (let plat of platforms) {
    if (rect.x < plat.x + plat.w && rect.x + rect.w > plat.x &&
        rect.y < plat.y + plat.h && rect.y + rect.h > plat.y &&
        player.velY >=0) {
      player.y = plat.y - rect.h;
      player.velY = 0;
      player.onGround = true;
    }
  }

  // Hazards
  for (let h of hazards) {
    if (rect.x < h.x + h.w && rect.x + rect.w > h.x &&
        rect.y < h.y + h.h && rect.y + rect.h > h.y) {
      if ((player.color === 'red' && h.type==='water') || (player.color==='blue' && h.type==='fire')) {
        // Respawn
        if (player.color === 'red') { player.x=100; player.y=400; player.velY=0; }
        else { player.x=600; player.y=400; player.velY=0; }
      }
    }
  }
}

// Game loop
function gameLoop() {
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // Draw platforms
  ctx.fillStyle='white';
  for (let p of platforms) ctx.fillRect(p.x,p.y,p.w,p.h);

  // Draw hazards
  for (let h of hazards) ctx.fillStyle=h.type==='fire'?'orange':'cyan', ctx.fillRect(h.x,h.y,h.w,h.h);

  // Draw doors
  ctx.fillStyle = 'red';
  ctx.fillRect(doors.fire.x, doors.fire.y, doors.fire.w, doors.fire.h);

  ctx.fillStyle = 'blue';
  ctx.fillRect(doors.water.x, doors.water.y, doors.water.w, doors.water.h);


  for (let id in players) {
    let p = players[id];
    if (id !== localId) { // only smooth remote players
        p.x += (p.targetX - p.x) * 0.2;
        p.y += (p.targetY - p.y) * 0.2;
    }
}

  // Update and draw players
  for (let id in players) {
    let p = players[id];
    p.id = id;

    // Door collision
    if (p.color === 'red') {
    fireAtDoor =
      p.x < doors.fire.x + doors.fire.w &&
      p.x + playerWidth > doors.fire.x &&
      p.y < doors.fire.y + doors.fire.h &&
      p.y + playerHeight > doors.fire.y;
  }

    if (p.color === 'blue') {
    waterAtDoor =
      p.x < doors.water.x + doors.water.w &&
      p.x + playerWidth > doors.water.x &&
      p.y < doors.water.y + doors.water.h &&
      p.y + playerHeight > doors.water.y;
  }

    // Only run physics for your own player
    if (id === localId) {
        updatePlayer(p);
    }

    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, playerWidth, playerHeight);

  }


  // Send local state
  if (localId && players[localId]) {
    socket.emit('move', {x:players[localId].x, y:players[localId].y, velY:players[localId].velY, onGround:players[localId].onGround});
  }
    if (fireAtDoor && waterAtDoor) {
    ctx.fillStyle = "white";
    ctx.font = "50px Arial";
    ctx.fillText("LEVEL COMPLETE ❤️", canvas.width/2 - 200, canvas.height/2);
  }
  requestAnimationFrame(gameLoop);
}

gameLoop();