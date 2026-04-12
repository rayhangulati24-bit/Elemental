const socket = io();

let cameraX = 0;
let cameraY = 0;

// Canvas setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Key input
const keys = {};
document.addEventListener('keydown', e => keys[e.key] = true);
document.addEventListener('keyup', e => keys[e.key] = false);

// Game variables
const players = {};
const playerWidth = 40;
const playerHeight = 50;
const gravity = 0.5;

// Platforms (you can add more)
const platforms = [
  {x:0, y:canvas.height - 50, w:canvas.width, h:50},
  {x:200, y:450, w:200, h:20},
  {x:500, y:350, w:200, h:20}
];

// Hazards (fire & water)
const hazards = [
  {type:'fire', x:250, y:530, w:100, h:20},
  {type:'water', x:550, y:330, w:100, h:20}
];

// Doors
const doors = {
  fire: {x: canvas.width - 120, y: canvas.height - 100, w:50, h:70},
  water: {x: canvas.width - 60, y: canvas.height - 100, w:50, h:70}
};

// Door state
let fireAtDoor = false;
let waterAtDoor = false;

// Local player ID
let localId = null;

// Placeholder images for sprites (replace with your sprite sheets)
const fireImg = new Image();
fireImg.src = "fire_sprites.png"; // your fire sprite sheet
const waterImg = new Image();
waterImg.src = "water_sprites.png"; // your water sprite sheet

// Socket events
socket.on('init', id => {
    localId = id;
});

socket.on('state', state => {
    for (let id in state) {
        if (!players[id]) {
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
            players[id].targetX = state[id].x;
            players[id].targetY = state[id].y;
            players[id].velY = state[id].velY;
            players[id].onGround = state[id].onGround;
        }
    }
});

// Player physics
function updatePlayer(player) {
    if (player.id === localId) {
        if (keys['ArrowLeft'] || keys['a']) player.x -= 5;
        if (keys['ArrowRight'] || keys['d']) player.x += 5;
        if ((keys['ArrowUp'] || keys['w']) && player.onGround) {
            player.velY = -12;
            player.onGround = false;
        }
    }

    player.velY += gravity;
    player.y += player.velY;

    // Platform collision
    player.onGround = false;
    const rect = {x: player.x, y: player.y, w: playerWidth, h: playerHeight};
    for (let plat of platforms) {
        if (rect.x < plat.x + plat.w && rect.x + rect.w > plat.x &&
            rect.y < plat.y + plat.h && rect.y + rect.h > plat.y &&
            player.velY >= 0) {
            player.y = plat.y - rect.h;
            player.velY = 0;
            player.onGround = true;
        }
    }

    // Hazard collision
    for (let h of hazards) {
        if (rect.x < h.x + h.w && rect.x + rect.w > h.x &&
            rect.y < h.y + h.h && rect.y + rect.h > h.y) {
            if ((player.color === 'red' && h.type==='water') || 
                (player.color==='blue' && h.type==='fire')) {
                if (player.color === 'red') { player.x=100; player.y=400; player.velY=0; }
                else { player.x=600; player.y=400; player.velY=0; }
            }
        }
    }
}

// Game loop
function gameLoop() {
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // Title text
    ctx.fillStyle = "white";
    ctx.font = "20px Arial";
    ctx.fillText("Rayhan ❤️ Riya", 20, 30);

    // Smooth remote players
    for (let id in players) {
        let p = players[id];
        if (id !== localId) {
            p.x += (p.targetX - p.x) * 0.2;
            p.y += (p.targetY - p.y) * 0.2;
        }
    }

    // Draw platforms
    ctx.fillStyle='white';
    for (let p of platforms) ctx.fillRect(p.x - cameraX, p.y - cameraY, p.w, p.h);

    // Draw hazards
    for (let h of hazards) {
        ctx.fillStyle = h.type==='fire'?'orange':'cyan';
        ctx.fillRect(h.x - cameraX, h.y - cameraY, h.w, h.h);
    }

    // Draw doors
    ctx.fillStyle='red';
    ctx.fillRect(doors.fire.x - cameraX, doors.fire.y - cameraY, doors.fire.w, doors.fire.h);
    ctx.fillStyle='blue';
    ctx.fillRect(doors.water.x - cameraX, doors.water.y - cameraY, doors.water.w, doors.water.h);

    // Update and draw players
    for (let id in players) {
        let p = players[id];
        p.id = id;

        // Door collision
        if (p.color==='red') fireAtDoor = (p.x < doors.fire.x + doors.fire.w &&
                                           p.x + playerWidth > doors.fire.x &&
                                           p.y < doors.fire.y + doors.fire.h &&
                                           p.y + playerHeight > doors.fire.y);

        if (p.color==='blue') waterAtDoor = (p.x < doors.water.x + doors.water.w &&
                                             p.x + playerWidth > doors.water.x &&
                                             p.y < doors.water.y + doors.water.h &&
                                             p.y + playerHeight > doors.water.y);

        // Physics for local player
        if (id === localId) updatePlayer(p);

        // Draw player (replace with sprite when ready)
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - cameraX, p.y - cameraY, playerWidth, playerHeight);
        
        
        //if (p.color==='red') ctx.drawImage(fireImg, p.x - cameraX, p.y - cameraY, playerWidth, playerHeight);
        //selse ctx.drawImage(waterImg, p.x - cameraX, p.y - cameraY, playerWidth, playerHeight);
    }

    // Camera follow
    if (localId && players[localId]) {
        const p = players[localId];
        cameraX += ((p.x - canvas.width/2 + playerWidth/2) - cameraX) * 0.1;
        cameraY += ((p.y - canvas.height/2 + playerHeight/2) - cameraY) * 0.1;
        if (cameraX < 0) cameraX = 0;
        if (cameraY < 0) cameraY = 0;
    }

    // Send local state
    if (localId && players[localId]) {
        socket.emit('move', {
            x: players[localId].x,
            y: players[localId].y,
            velY: players[localId].velY,
            onGround: players[localId].onGround
        });
    }

    // Level complete
    if (fireAtDoor && waterAtDoor) {
        ctx.fillStyle = "white";
        ctx.font = "50px Arial";
        ctx.fillText("LEVEL COMPLETE ❤️", canvas.width/2 - 200, canvas.height/2);
    }

    requestAnimationFrame(gameLoop);
}

gameLoop();