const socket = io();

let cameraX = 0;
let cameraY = 0;

// Canvas setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

/** Layout baseline height used for proportional platforms / water hazard */
const REF_H = 600;

function syncLevelLayout() {
    const w = canvas.width;
    const h = canvas.height;
    const r = h / REF_H;
    if (platforms[0]) {
        platforms[0].y = h - 50;
        platforms[0].w = w;
    }
    if (platforms[1]) platforms[1].y = Math.round(450 * r);
    if (platforms[2]) platforms[2].y = Math.round(350 * r);
    if (hazards[0]) hazards[0].y = h - 70;
    if (hazards[1]) hazards[1].y = Math.round(330 * r);
    doors.fire.x = w - 120;
    doors.fire.y = h - 100;
    doors.water.x = w - 60;
    doors.water.y = h - 100;
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    syncLevelLayout();
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

/** Show on-screen pad when a coarse pointer exists (typical phones / iPad) or small window */
function syncTouchUi() {
    const coarse =
        window.matchMedia('(any-pointer: coarse)').matches ||
        window.matchMedia('(max-width: 900px)').matches;
    document.documentElement.classList.toggle('touch-ui', coarse);
}
syncTouchUi();
window.addEventListener('resize', syncTouchUi);

// Key input
const keys = {};
document.addEventListener('keydown', e => keys[e.key] = true);
document.addEventListener('keyup', e => keys[e.key] = false);

// Touch / on-screen controls (iPad, phones)
const touchPad = { left: false, right: false, jump: false };

function bindHoldButton(el, key) {
    if (!el) return;
    const down = e => {
        e.preventDefault();
        touchPad[key] = true;
        try {
            el.setPointerCapture(e.pointerId);
        } catch (_) {}
    };
    const up = e => {
        if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
        touchPad[key] = false;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', e => {
        if (!el.hasPointerCapture?.(e.pointerId)) touchPad[key] = false;
    });
    el.addEventListener('lostpointercapture', () => {
        touchPad[key] = false;
    });
}

bindHoldButton(document.getElementById('touchLeft'), 'left');
bindHoldButton(document.getElementById('touchRight'), 'right');
bindHoldButton(document.getElementById('touchJump'), 'jump');

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

// Wrong hazard: lasers start immediately, fire for 10 seconds
const LASER_BARRAGE_MS = 10000;
let laserBarrageEnd = 0;
/** @type {{ x: number, y: number }[]} */
let laserGuns = [];
/** @type {{ x: number, y: number, vx: number, vy: number, life: number }[]} */
let lasers = [];

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
        if (keys['ArrowLeft'] || keys['a'] || touchPad.left) player.x -= 5;
        if (keys['ArrowRight'] || keys['d'] || touchPad.right) player.x += 5;
        if ((keys['ArrowUp'] || keys['w'] || touchPad.jump) && player.onGround) {
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

    // Wrong-colour hazards: no instant kill; lasers handled in gameLoop
}

// Game loop
function gameLoop() {
    const now = performance.now();

    fireAtDoor = false;
    waterAtDoor = false;

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

        // Wrong hazard → lasers immediately; new barrage only after previous 10s ends (local only)
        if (id === localId && isInWrongHazard(p) && now >= laserBarrageEnd) {
            startLaserBarrage(p);
        }

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

    // Laser barrage: guns + bolts (world space)
    if (now < laserBarrageEnd && laserGuns.length) {
        if (Math.random() < 0.22) spawnLaserBolt();

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
        for (let i = lasers.length - 1; i >= 0; i--) {
            const L = lasers[i];
            L.x += L.vx;
            L.y += L.vy;
            L.life--;

            ctx.save();
            ctx.strokeStyle = 'rgba(255, 0, 220, 0.95)';
            ctx.lineWidth = 4;
            ctx.shadowColor = '#ff00ff';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.moveTo(L.x - L.vx * 2.2 - cameraX, L.y - L.vy * 2.2 - cameraY);
            ctx.lineTo(L.x - cameraX, L.y - cameraY);
            ctx.stroke();
            ctx.restore();

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