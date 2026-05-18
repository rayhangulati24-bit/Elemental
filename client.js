const socket = io();

let cameraX = 0;
let cameraY = 0;

// Canvas setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Fixed world size so every player sees the same layout
const WORLD_W = 1280;
const WORLD_H = 600;
const STEP_LIFT = 80; // how much higher (px) floating steps sit

let viewScale = 1;
let viewOffsetX = 0;
let viewOffsetY = 0;

function updateViewTransform() {
    viewScale = Math.min(canvas.width / WORLD_W, canvas.height / WORLD_H);
    viewOffsetX = (canvas.width - WORLD_W * viewScale) / 2;
    viewOffsetY = (canvas.height - WORLD_H * viewScale) / 2;
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    updateViewTransform();
}

function getViewSize() {
    return { w: canvas.width / viewScale, h: canvas.height / viewScale };
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
const jumpVelocity = -12 * Math.sqrt(1.2); // 20% higher jump

const GROUND_LEFT_EXTEND = 800;
const FIRE_SPAWN_X = -GROUND_LEFT_EXTEND + 200;
const WATER_SPAWN_X = -GROUND_LEFT_EXTEND + 450;
function spawnY() {
    return WORLD_H - 50 - playerHeight;
}

let currentWorld = 1;
let platforms = [];
let hazards = [];
let doors = {};
let world2LowStepBaseY = null;
let world2LowStepLift = 0;
const WORLD2_HIGH_Y = 90; // height of upper steps, doors, wall (very high)
const WORLD2_LOW_STEP_RISE = (WORLD_H - 140 - STEP_LIFT) - WORLD2_HIGH_Y;
const TEMP_STEP_MS = 4000;
let stepTimers = new Map();
let lastPhysicsTime = 0;
let worldTransitionUntil = 0;
let fireAtDoor = false;
let waterAtDoor = false;

// Laser barrage (must be declared before loadWorld)
const LASER_BARRAGE_MS = 10000;
let prevWrongHazard = false;
let laserBarrageEnd = 0;
let laserGuns = [];
let lasers = [];
const MAX_LASERS = 50;
const NET_SEND_MS = 1000 / 30;
let lastNetSend = 0;

function buildWorld1() {
    const h = WORLD_H;
    const w = WORLD_W;
    const midStepY = (h - 120 + 350) / 2 - STEP_LIFT;
    const stepsRight = 820 + 200;
    const towardSteps = 0.2 * ((w - 145) - stepsRight);
    return {
        platforms: [
            { x: -GROUND_LEFT_EXTEND, y: h - 50, w: w + GROUND_LEFT_EXTEND, h: 50 },
            { x: 200, y: midStepY, w: 200, h: 20 },
            { x: 500, y: 350 - STEP_LIFT, w: 200, h: 20 },
            { x: 820, y: 350 - STEP_LIFT, w: 200, h: 20 },
            { x: 120, y: h - 120 - STEP_LIFT, w: 180, h: 20 },
            { x: w - 145 - towardSteps, y: h - 420, w: 20, h: 370, wall: true }
        ],
        hazards: [
            { type: 'fire', x: 250, y: midStepY - 20, w: 100, h: 20 },
            { type: 'water', x: 550, y: 330 - STEP_LIFT, w: 100, h: 20 },
            { type: 'fire', x: 870, y: 330 - STEP_LIFT, w: 100, h: 20 }
        ],
        doors: {
            fire: { x: w - 120 - towardSteps, y: h - 100, w: 50, h: 70 },
            water: { x: w - 60 - towardSteps, y: h - 100, w: 50, h: 70 }
        }
    };
}

function buildWorld2() {
    const h = WORLD_H;
    const w = WORLD_W;
    const stepsRight = 920 + 200;
    const towardSteps = 0.2 * ((w - 145) - stepsRight);
    const lowStepBaseY = h - 140 - STEP_LIFT;
    const raisedStepY = WORLD2_HIGH_Y;
    return {
        platforms: [
            { x: -GROUND_LEFT_EXTEND, y: h - 50, w: w + GROUND_LEFT_EXTEND + 300, h: 50 },
            { x: 0, y: lowStepBaseY, w: 220, h: 20, lowestStep: true },
            { x: 300, y: raisedStepY, w: 220, h: 20, temporaryStep: true },
            { x: 600, y: raisedStepY, w: 220, h: 20, temporaryStep: true },
            { x: 920, y: raisedStepY, w: 200, h: 20, temporaryStep: true },
            { x: w - 140 - towardSteps, y: raisedStepY, w: 135, h: 20 }
        ],
        hazards: [],
        doors: {
            fire: { x: w - 120 - towardSteps, y: raisedStepY - 70, w: 50, h: 70 },
            water: { x: w - 60 - towardSteps, y: raisedStepY - 70, w: 50, h: 70 }
        }
    };
}

function loadWorld(world) {
    const data = world === 2 ? buildWorld2() : buildWorld1();
    platforms = data.platforms;
    hazards = data.hazards;
    doors = data.doors;
    if (world !== currentWorld) {
        worldTransitionUntil = performance.now() + 2500;
    }
    currentWorld = world;
    world2LowStepLift = 0;
    world2LowStepBaseY = null;
    stepTimers.clear();
    lastPhysicsTime = 0;
    if (world === 2) {
        const lowStep = platforms.find(p => p.lowestStep);
        world2LowStepBaseY = lowStep?.y ?? null;
        for (const plat of platforms) {
            if (plat.temporaryStep) stepTimers.set(plat, 0);
        }
    }
    cameraX = 0;
    cameraY = 0;
    lasers = [];
    laserGuns = [];
    laserBarrageEnd = 0;
    prevWrongHazard = false;
}

function localAtDoor() {
    const lp = localId && players[localId];
    if (!lp) return false;
    if (lp.color === 'red') {
        return rectsOverlap(lp.x, lp.y, playerWidth, playerHeight,
            doors.fire.x, doors.fire.y, doors.fire.w, doors.fire.h);
    }
    if (lp.color === 'blue') {
        return rectsOverlap(lp.x, lp.y, playerWidth, playerHeight,
            doors.water.x, doors.water.y, doors.water.w, doors.water.h);
    }
    return false;
}

// Local player ID
let localId = null;
let gameStarted = false;

const characterSelect = document.getElementById('characterSelect');
const pickFire = document.getElementById('pickFire');
const pickWater = document.getElementById('pickWater');
const selectStatus = document.getElementById('selectStatus');

canvas.classList.add('selecting');

function updateCharacterSelectUI(state) {
    if (!pickFire || !pickWater || !state || typeof state !== 'object') return;
    let fireTaken = false;
    let waterTaken = false;
    for (const id in state) {
        if (id === 'world' || id === 'players') continue;
        if (id === localId) continue;
        const el = state[id]?.element;
        if (el === 'fire') fireTaken = true;
        if (el === 'water') waterTaken = true;
    }
    pickFire.disabled = fireTaken;
    pickWater.disabled = waterTaken;
}

const gameControls = document.getElementById('gameControls');
const jumpBtn = document.getElementById('jumpBtn');
const backBtn = document.getElementById('backBtn');
const moveBtn = document.getElementById('moveBtn');
let moveBackwardActive = false;
let moveForwardActive = false;

function hideCharacterSelect() {
    characterSelect?.classList.add('hidden');
    canvas.classList.remove('selecting');
    gameControls?.removeAttribute('hidden');
}

function tryJump(player) {
    if (player.onGround) {
        player.velY = jumpVelocity;
        player.onGround = false;
    }
}

jumpBtn?.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!gameStarted || !localId || !players[localId]) return;
    tryJump(players[localId]);
});

function setupHoldButton(btn, setActive) {
    btn?.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (!gameStarted) return;
        setActive(true);
        btn.setPointerCapture(e.pointerId);
    });
    btn?.addEventListener('pointerup', () => setActive(false));
    btn?.addEventListener('pointercancel', () => setActive(false));
    btn?.addEventListener('lostpointercapture', () => setActive(false));
}

setupHoldButton(backBtn, active => { moveBackwardActive = active; });
setupHoldButton(moveBtn, active => { moveForwardActive = active; });

pickFire?.addEventListener('click', () => {
    selectStatus.textContent = '';
    socket.emit('chooseCharacter', { element: 'fire' });
});
pickWater?.addEventListener('click', () => {
    selectStatus.textContent = '';
    socket.emit('chooseCharacter', { element: 'water' });
});

loadWorld(1);

socket.on('chooseOk', ({ color, element }) => {
    gameStarted = true;
    hideCharacterSelect();
    if (localId) {
        const spawnX = element === 'fire' ? FIRE_SPAWN_X : WATER_SPAWN_X;
        const y = spawnY();
        players[localId] = {
            x: spawnX,
            y,
            targetX: spawnX,
            targetY: y,
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

const firePortraitImg = new Image();
firePortraitImg.src = 'fire-portrait.png';
const waterPortraitImg = new Image();
waterPortraitImg.src = 'water-portrait.png';

const fireImg = new Image();
fireImg.src = "fire_sprites.png";
const waterImg = new Image();
waterImg.src = "water_sprites.png";

function drawImageCover(ctx, img, dx, dy, dw, dh) {
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const boxAspect = dw / dh;
    let sw, sh, sx, sy;
    if (imgAspect > boxAspect) {
        sh = img.naturalHeight;
        sw = sh * boxAspect;
        sx = (img.naturalWidth - sw) / 2;
        sy = 0;
    } else {
        sw = img.naturalWidth;
        sh = sw / boxAspect;
        sx = 0;
        sy = 0;
    }
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawPlayerSprite(p) {
    const sx = p.x - cameraX;
    const sy = p.y - cameraY;
    const portraitH = playerHeight * 0.75;
    const bodyH = playerHeight - portraitH;

    if (p.color === 'red' && firePortraitImg.complete && firePortraitImg.naturalWidth) {
        ctx.fillStyle = p.color;
        ctx.fillRect(sx, sy + portraitH, playerWidth, bodyH);
        drawImageCover(ctx, firePortraitImg, sx, sy, playerWidth, portraitH);
        return;
    }
    if (p.color === 'blue' && waterPortraitImg.complete && waterPortraitImg.naturalWidth) {
        ctx.fillStyle = p.color;
        ctx.fillRect(sx, sy + portraitH, playerWidth, bodyH);
        drawImageCover(ctx, waterPortraitImg, sx, sy, playerWidth, portraitH);
        return;
    }

    ctx.fillStyle = p.color;
    ctx.fillRect(sx, sy, playerWidth, playerHeight);
}

// Socket events
socket.on('init', id => {
    localId = id;
});

socket.on('state', payload => {
    const world = payload.world ?? 1;
    const worldChanged = world !== currentWorld;
    if (worldChanged) loadWorld(world);

    const state = payload.players ?? payload;
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
        } else if (worldChanged) {
            players[id].x = s.x;
            players[id].y = s.y;
            players[id].targetX = s.x;
            players[id].targetY = s.y;
            players[id].velY = s.velY;
            players[id].onGround = s.onGround;
        }
    }
});

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function fireAndWaterOverlapping() {
    let fire = null;
    let water = null;
    for (const id in players) {
        const p = players[id];
        if (!p.color) continue;
        if (p.color === 'red') fire = p;
        if (p.color === 'blue') water = p;
    }
    if (!fire || !water) return false;
    return rectsOverlap(
        fire.x, fire.y, playerWidth, playerHeight,
        water.x, water.y, playerWidth, playerHeight
    );
}

function getLowestStep() {
    return platforms.find(p => p.lowestStep);
}

function playerOnPlatform(player, plat) {
    if (!plat) return false;
    const feet = player.y + playerHeight;
    return player.x < plat.x + plat.w && player.x + playerWidth > plat.x &&
        feet >= plat.y - 4 && feet <= plat.y + 12;
}

function updateWorld2LowStep() {
    if (currentWorld !== 2 || world2LowStepBaseY == null) return 0;

    const targetLift = fireAndWaterOverlapping() ? WORLD2_LOW_STEP_RISE : 0;
    const prevLift = world2LowStepLift;
    world2LowStepLift += (targetLift - world2LowStepLift) * 0.07;

    const lowStep = getLowestStep();
    if (lowStep) lowStep.y = world2LowStepBaseY - world2LowStepLift;

    return world2LowStepLift - prevLift;
}

function carryPlayersOnLowStep(liftDelta) {
    if (!liftDelta) return;
    const lowStep = getLowestStep();
    if (!lowStep) return;

    for (const id in players) {
        const p = players[id];
        if (!p.color) continue;
        if (playerOnPlatform(p, lowStep)) {
            p.y -= liftDelta;
            if (id === localId) {
                p.velY = 0;
                p.onGround = true;
            }
        }
    }
}

function anyPlayerOnPlatform(plat) {
    for (const id in players) {
        const p = players[id];
        if (p.color && playerOnPlatform(p, plat)) return true;
    }
    return false;
}

function hazardOnPlatform(h, plat) {
    return rectsOverlap(h.x, h.y, h.w, h.h, plat.x, plat.y - 24, plat.w, plat.h + 24);
}

function removeTemporaryStep(plat) {
    if (plat.lowestStep) {
        world2LowStepBaseY = null;
        world2LowStepLift = 0;
    } else {
        hazards = hazards.filter(h => !hazardOnPlatform(h, plat));
    }
    platforms = platforms.filter(p => p !== plat);
    stepTimers.delete(plat);
}

function updateTemporarySteps(dt) {
    if (currentWorld !== 2) return;

    const toRemove = [];
    for (const [plat, elapsed] of stepTimers) {
        if (!platforms.includes(plat)) {
            stepTimers.delete(plat);
            continue;
        }
        if (anyPlayerOnPlatform(plat)) {
            const next = elapsed + dt;
            stepTimers.set(plat, next);
            if (next >= TEMP_STEP_MS) toRemove.push(plat);
        } else {
            stepTimers.set(plat, 0);
        }
    }
    for (const plat of toRemove) removeTemporaryStep(plat);
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
    player.x = player.color === 'red' ? FIRE_SPAWN_X : WATER_SPAWN_X;
    player.y = spawnY();
    player.velY = 0;
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
        if (keys['ArrowLeft'] || keys['a'] || moveBackwardActive) player.x -= 5;
        if (keys['ArrowRight'] || keys['d'] || moveForwardActive) player.x += 5;
        if ((keys['ArrowUp'] || keys['w']) && player.onGround) {
            tryJump(player);
        }
    }

    player.velY += gravity;
    player.y += player.velY;

    // Platform / wall collision
    player.onGround = false;
    const rect = {x: player.x, y: player.y, w: playerWidth, h: playerHeight};
    for (let plat of platforms) {
        if (plat.wall) continue;
        if (rect.x < plat.x + plat.w && rect.x + rect.w > plat.x &&
            rect.y < plat.y + plat.h && rect.y + rect.h > plat.y &&
            player.velY >= 0) {
            player.y = plat.y - rect.h;
            player.velY = 0;
            player.onGround = true;
            rect.y = player.y;
        }
    }
    for (let wall of platforms) {
        if (!wall.wall) continue;
        if (rect.x >= wall.x + wall.w || rect.x + rect.w <= wall.x ||
            rect.y >= wall.y + wall.h || rect.y + rect.h <= wall.y) continue;

        const overlapLeft = rect.x + rect.w - wall.x;
        const overlapRight = wall.x + wall.w - rect.x;
        const overlapTop = rect.y + rect.h - wall.y;
        const overlapBottom = wall.y + wall.h - rect.y;
        const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

        if (minOverlap === overlapTop && player.velY >= 0) {
            const prevBottom = rect.y + rect.h - player.velY;
            if (prevBottom <= wall.y + 12) {
                player.y = wall.y - rect.h;
                player.velY = 0;
                player.onGround = true;
                rect.y = player.y;
                continue;
            }
        }
        if (minOverlap === overlapLeft) {
            player.x = wall.x - rect.w;
        } else if (minOverlap === overlapRight) {
            player.x = wall.x + wall.w;
        } else if (minOverlap === overlapBottom) {
            player.y = wall.y + wall.h;
            player.velY = 0;
            rect.y = player.y;
        }
        rect.x = player.x;
    }

    // Land on other players (World 1 only — disabled in World 2)
    if (currentWorld !== 2 && player.velY >= 0) {
        const prevBottom = rect.y + rect.h - player.velY;
        let landSurfaceY = null;
        for (const otherId in players) {
            if (otherId === player.id) continue;
            const other = players[otherId];
            if (!other?.color) continue;

            const ox = other.x;
            const oy = other.y;
            const ow = playerWidth;
            const oh = playerHeight;
            if (rect.x >= ox + ow || rect.x + rect.w <= ox) continue;
            if (rect.y + rect.h <= oy || rect.y >= oy + oh) continue;
            if (prevBottom > oy + 12) continue;

            if (landSurfaceY === null || oy < landSurfaceY) landSurfaceY = oy;
        }
        if (landSurfaceY !== null) {
            player.y = landSurfaceY - rect.h;
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

    if (!lastPhysicsTime) lastPhysicsTime = now;
    const dt = Math.min(now - lastPhysicsTime, 50);
    lastPhysicsTime = now;

    const lowStepLiftDelta = updateWorld2LowStep();
    carryPlayersOnLowStep(lowStepLiftDelta);
    updateTemporarySteps(dt);

    // Camera follow (must run before drawing)
    const view = getViewSize();
    if (localId && players[localId]) {
        const p = players[localId];
        cameraX += ((p.x - view.w / 2 + playerWidth / 2) - cameraX) * 0.15;
        cameraY += ((p.y - view.h / 2 + playerHeight / 2) - cameraY) * 0.15;
        if (cameraX < -GROUND_LEFT_EXTEND) cameraX = -GROUND_LEFT_EXTEND;
        if (cameraY < 0) cameraY = 0;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Title + world label (screen space)
    ctx.fillStyle = "white";
    ctx.font = "20px Arial";
    ctx.fillText("Rayhan ❤️ Riya", 20, 30);
    ctx.fillText(`World ${currentWorld}`, 20, 55);

    ctx.save();
    ctx.translate(viewOffsetX, viewOffsetY);
    ctx.scale(viewScale, viewScale);

    // Draw platforms
    for (let p of platforms) {
        let alpha = 1;
        if (p.temporaryStep && stepTimers.has(p)) {
            const t = stepTimers.get(p);
            if (t > 0) alpha = Math.max(0.25, 1 - (t / TEMP_STEP_MS) * 0.75);
        }
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.fillRect(p.x - cameraX, p.y - cameraY, p.w, p.h);
    }

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

        drawPlayerSprite(p);
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

    ctx.restore();

    // Send local state (30 Hz, not every frame)
    if (gameStarted && localId && players[localId] && now - lastNetSend >= NET_SEND_MS) {
        lastNetSend = now;
        const lp = players[localId];
        socket.emit('move', {
            x: lp.x,
            y: lp.y,
            velY: lp.velY,
            onGround: lp.onGround,
            atDoor: localAtDoor()
        });
    }

    // Gate status / world transition
    if (currentWorld === 1 && gameStarted) {
        const lp = localId && players[localId];
        if (lp && localAtDoor() && !(fireAtDoor && waterAtDoor)) {
            ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
            ctx.font = "22px Arial";
            ctx.fillText("At your gate — waiting for partner...", canvas.width / 2 - 200, 90);
        }
    }

    if (now < worldTransitionUntil) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "white";
        ctx.font = "42px Arial";
        ctx.textAlign = "center";
        ctx.fillText(`World ${currentWorld}`, canvas.width / 2, canvas.height / 2 - 20);
        ctx.font = "22px Arial";
        ctx.fillText("Both players reached their gates!", canvas.width / 2, canvas.height / 2 + 30);
        ctx.textAlign = "left";
    }

    if (currentWorld === 2 && fireAtDoor && waterAtDoor) {
        ctx.fillStyle = "white";
        ctx.font = "50px Arial";
        ctx.textAlign = "center";
        ctx.fillText("WORLD 2 COMPLETE ❤️", canvas.width / 2, canvas.height / 2);
        ctx.textAlign = "left";
    }

    requestAnimationFrame(gameLoop);
}

gameLoop();