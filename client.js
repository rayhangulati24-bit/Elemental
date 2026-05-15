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
  {x:500, y:350, w:200, h:20},
  {x:120, y:canvas.height - 120, w:180, h:20},
  {x: canvas.width - 145, y: canvas.height - 420, w: 20, h: 370}
];

// Hazards (fire & water)
const hazards = [
  {type:'fire', x:250, y:430, w:100, h:20},
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

// Wrong-hazard contact → instant laser barrage for LASER_BARRAGE_MS
const LASER_BARRAGE_MS = 10000;
let prevWrongHazard = false;
let laserBarrageEnd = 0;
/** @type {{ x: number, y: number }[]} */
let laserGuns = [];
/** @type {{ x: number, y: number, vx: number, vy: number, life: number }[]} */
let lasers = [];
const MAX_LASERS = 50;
const NET_SEND_MS = 1000 / 30;
let lastNetSend = 0;

// Local player ID
let localId = null;
let gameStarted = false;

const characterSelect = document.getElementById('characterSelect');
const pickFire = document.getElementById('pickFire');
const pickWater = document.getElementById('pickWater');
const selectStatus = document.getElementById('selectStatus');

function updateCharacterSelectUI(state) {
    if (!pickFire || !pickWater) return;
    let fireTaken = false;
    let waterTaken = false;
    for (const id in state) {
        if (id === localId) continue;
        const el = state[id].element;
        if (el === 'fire') fireTaken = true;
        if (el === 'water') waterTaken = true;
    }
    pickFire.disabled = fireTaken;
    pickWater.disabled = waterTaken;
}

function hideCharacterSelect() {
    characterSelect?.classList.add('hidden');
}

pickFire?.addEventListener('click', () => {
    selectStatus.textContent = '';
    socket.emit('chooseCharacter', { element: 'fire' });
});
pickWater?.addEventListener('click', () => {
    selectStatus.textContent = '';
    socket.emit('chooseCharacter', { element: 'water' });
});

socket.on('chooseOk', ({ color, element }) => {
    gameStarted = true;
    hideCharacterSelect();
    if (localId) {
        const spawnX = element === 'fire' ? 100 : 600;
        players[localId] = {
            x: spawnX,
            y: 400,
            targetX: spawnX,
            targetY: 400,
            color,
            element,
            velY: 0,
            onGround: false
        };
    }
});

socket.on('chooseFailed', ({ element }) => {
    const label = element === 'fire' ? 'Fire' : 'Water';
    selectStatus.textContent = `${label} was already chosen — pick the other element.`;
});

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
    if (!gameStarted) updateCharacterSelectUI(state);

    for (let id in state) {
        const s = state[id];
        if (!s.color) {
            delete players[id];
            continue;
        }
        if (!players[id]) {
            players[id] = {
                x: s.x,
                y: s.y,
                targetX: s.x,
                targetY: s.y,
                color: s.color,
                element: s.element,
                velY: s.velY,
                onGround: s.onGround
            };
        } else if (id !== localId) {
            players[id].targetX = s.x;
            players[id].targetY = s.y;
            players[id].velY = s.velY;
            players[id].onGround = s.onGround;
            players[id].color = s.color;
            players[id].element = s.element;
        }
    }
});

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function isInWrongHazard(player) {
    for (let h of hazards) {
        if (!rectsOverlap(player.x, player.y, playerWidth, playerHeight, h.x, h.y, h.w, h.h)) continue;
        if ((player.color === 'red' && h.type === 'water') ||
            (player.color === 'blue' && h.type === 'fire')) {
            return true;
        }
    }
    return false;
}

function respawnPlayer(player) {
    if (player.color === 'red') {
        player.x = 100;
        player.y = 400;
        player.velY = 0;
    } else {
        player.x = 600;
        player.y = 400;
        player.velY = 0;
    }
}

function startLaserBarrage(player) {
    const spread = 380;
    laserGuns = [
        { x: player.x - spread, y: player.y - spread },
        { x: player.x + spread, y: player.y - spread },
        { x: player.x - spread, y: player.y + spread },
        { x: player.x + spread, y: player.y + spread }
    ];
    lasers = [];
    laserBarrageEnd = performance.now() + LASER_BARRAGE_MS;
}

function spawnLaserBolt() {
    if (!laserGuns.length) return;
    const gun = laserGuns[(Math.random() * laserGuns.length) | 0];
    const angle = Math.random() * Math.PI * 2;
    const speed = 11 + Math.random() * 6;
    lasers.push({
        x: gun.x,
        y: gun.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 100
    });
}

function laserHitsPlayer(l, player) {
    const tipX = l.x;
    const tipY = l.y;
    const r = 10;
    return rectsOverlap(
        player.x, player.y, playerWidth, playerHeight,
        tipX - r, tipY - r, r * 2, r * 2
    );
}

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

    // Wrong-colour hazards: laser barrage triggered from gameLoop on contact
}

// Game loop
function gameLoop() {
    const now = performance.now();

    if (!gameStarted) {
        requestAnimationFrame(gameLoop);
        return;
    }

    // Physics + remote interpolation (before camera/draw)
    for (let id in players) {
        const p = players[id];
        p.id = id;
        if (id === localId) {
            updatePlayer(p);
        } else {
            p.x += (p.targetX - p.x) * 0.35;
            p.y += (p.targetY - p.y) * 0.35;
        }
    }

    // Camera follow (must run before drawing)
    if (localId && players[localId]) {
        const p = players[localId];
        cameraX += ((p.x - canvas.width / 2 + playerWidth / 2) - cameraX) * 0.15;
        cameraY += ((p.y - canvas.height / 2 + playerHeight / 2) - cameraY) * 0.15;
        if (cameraX < 0) cameraX = 0;
        if (cameraY < 0) cameraY = 0;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Title text (screen space, not world)
    ctx.fillStyle = "white";
    ctx.font = "20px Arial";
    ctx.fillText("Rayhan ❤️ Riya", 20, 30);

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

    fireAtDoor = false;
    waterAtDoor = false;

    // Draw players + door / hazard checks
    for (let id in players) {
        const p = players[id];

        if (p.color === 'red') {
            fireAtDoor = rectsOverlap(p.x, p.y, playerWidth, playerHeight,
                doors.fire.x, doors.fire.y, doors.fire.w, doors.fire.h);
        }
        if (p.color === 'blue') {
            waterAtDoor = rectsOverlap(p.x, p.y, playerWidth, playerHeight,
                doors.water.x, doors.water.y, doors.water.w, doors.water.h);
        }

        if (id === localId) {
            const wrong = isInWrongHazard(p);
            if (now >= laserBarrageEnd && wrong && !prevWrongHazard) {
                startLaserBarrage(p);
            }
            prevWrongHazard = wrong;
        }

        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - cameraX, p.y - cameraY, playerWidth, playerHeight);
    }

    // Laser barrage: guns + bolts (world space)
    if (now < laserBarrageEnd && laserGuns.length) {
        if (lasers.length < MAX_LASERS && Math.random() < 0.1) spawnLaserBolt();

        ctx.lineWidth = 2;
        for (const g of laserGuns) {
            const sx = g.x - cameraX;
            const sy = g.y - cameraY;
            ctx.fillStyle = '#444';
            ctx.strokeStyle = '#888';
            ctx.fillRect(sx - 14, sy - 8, 28, 16);
            ctx.strokeRect(sx - 14, sy - 8, 28, 16);
            ctx.fillStyle = '#222';
            ctx.fillRect(sx - 4, sy - 14, 8, 10);
        }

        const lp = localId ? players[localId] : null;
        ctx.strokeStyle = 'rgba(255, 0, 220, 0.95)';
        ctx.lineWidth = 3;
        for (let i = lasers.length - 1; i >= 0; i--) {
            const L = lasers[i];
            L.x += L.vx;
            L.y += L.vy;
            L.life--;

            ctx.beginPath();
            ctx.moveTo(L.x - L.vx * 2.2 - cameraX, L.y - L.vy * 2.2 - cameraY);
            ctx.lineTo(L.x - cameraX, L.y - cameraY);
            ctx.stroke();

            if (lp && laserHitsPlayer(L, lp)) {
                respawnPlayer(lp);
                lasers = [];
                laserGuns = [];
                laserBarrageEnd = 0;
                break;
            }
            if (L.life <= 0) lasers.splice(i, 1);
        }
    } else if (now >= laserBarrageEnd) {
        lasers = [];
        laserGuns = [];
    }

    // Send local state (30 Hz, not every frame)
    if (gameStarted && localId && players[localId] && now - lastNetSend >= NET_SEND_MS) {
        lastNetSend = now;
        const lp = players[localId];
        socket.emit('move', {
            x: lp.x,
            y: lp.y,
            velY: lp.velY,
            onGround: lp.onGround
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