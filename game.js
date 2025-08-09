/* ========= game.js - Fixed & Combined =========
   - Start screen (Space / ArrowUp)
   - Restart (R), Quit (Q), Secret Win (W)
   - Double jump (max 2)
   - Ducking fixes (upper body lowers, feet stay put)
   - Ground & aerial obstacles (duck for aerial)
   - Min spacing in normal play; chaos/random spawn in last level
   - Chaser cinematic: follow 30s -> pass -> 5s -> return with big chaser
   - Fake progress bar + sarcastic messages
   - Sound hooks (optional): sounds/jump.mp3, sounds/duck.mp3
   ============================================= */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = 900;
canvas.height = 400;

/* ---------- Game state ---------- */
let gameState = 'waiting'; // 'waiting' | 'running' | 'gameover' | 'win'
let lastTime = 0;

/* ---------- Player ---------- */
const GROUND_Y = 320;
const PLAYER_SCREEN_X = 120;
const player = {
  screenX: PLAYER_SCREEN_X,
  y: GROUND_Y - 70,       // top-left y
  width: 40,
  height: 70,
  originalHeight: 70,
  duckHeight: 40,
  vy: 0,                  // velocity y in px/sec
  gravity: 1400,          // px/sec^2
  jumpPower: -700,        // px/sec initial velocity for jump
  jumpsUsed: 0,
  maxJumps: 2,
  ducking: false
};

/* ---------- World & speed ---------- */
let baseSpeed = 280;      // px/sec
let speed = baseSpeed;
let maxSpeed = 1400;

let stripeOffset = 0;


/* ---------- Obstacles ---------- */
let obstacles = [];       // each: { x, y, w, h, type ('ground'|'air'), color }
let lastObstacleX = -9999; // screen-x of last spawned obstacle (for minGap)
const normalMinGap = 220;  // pixels min gap in normal mode

/* spawn timing */
let spawnTimer = 0;
let spawnIntervalMs = 1000; // normal spawn every 1000ms
let spawnElapsed = 0;

/* last-level chaos */
let inLastLevel = false;
let cinematicActive = false;
let lastLevelChaos = false;

/* fake progress */
let fakeProgress = 0;

/* messages */
const messages = [
  "You're doing... something.",
  "At this rate, you might finish by next century!",
  "Wow! Such progress. Much effort. Mostly effort.",
  "Keep going — it's not like anyone's watching.",
  "Almost there! Just kidding.",
  "Every step forward moves the finish line two steps back."
];
let nextMsgAt = 300;
let currentMessage = '';

/* scoring */
let score = 0;
let highScore = parseInt(localStorage.getItem('sarcasticHighScore') || '0', 10);

/* ---------- Chaser cinematic ---------- */
/* chaser screen coords used during cinematic (independent of world obstacles) */
let chaser = { x: PLAYER_SCREEN_X - 300, y: GROUND_Y - 70, w: 44, h: 70, speed: 0 };
let bigChaser = { x: 99999, y: GROUND_Y - 100, w: 80, h: 100, speed: 0 };
let chaserState = 'idle'; // 'idle'|'follow'|'pass'|'passed'|'returning'|'done'
let chaserFollowStart = 0;
let chaserPassedAt = 0;

/* ---------- Sound hooks (optional) ---------- */
let jumpSound = null, duckSound = null;
try {
  jumpSound = new Audio('sounds/jump.mp3');
  duckSound = new Audio('sounds/duck.mp3');
} catch (e) { /* ignore if not available */ }
function playSound(s) { if (!s) return; try { s.currentTime = 0; s.play(); } catch(e){} }

/* ---------- Utility ---------- */
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* ---------- Input ---------- */
document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
    if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) {
    e.preventDefault();
  }


  const k = e.code;

  // universal
  if (k === 'KeyQ') {
    // quit -> graceful reset
    alert('Quit requested. Restarting to title.');
    resetToTitle();
    return;
  }
  if (k === 'KeyW') {
    // secret win
    gameState = 'win';
    saveHighScore();
    return;
  }
  if (k === 'KeyR') {
    // restart from any end state
    resetToTitle();
    return;
  }

  // state-specific
  if (gameState === 'waiting') {
    if (k === 'Space' || k === 'ArrowUp') {
      startGame();
    }
    return;
  }

  if (gameState === 'running') {
    // jump (double jump)
    if (k === 'Space' || k === 'ArrowUp') {
      if (player.jumpsUsed < player.maxJumps) {
        player.vy = player.jumpPower;
        player.jumpsUsed += 1;
        playSound(jumpSound);
      }
    }
    // duck while grounded
    if (k === 'ArrowDown') {
      if (!player.ducking && isPlayerGrounded()) {
        player.ducking = true;
        player.height = player.duckHeight;
        player.y = GROUND_Y - player.height; // keep feet at ground
        playSound(duckSound);
      }
    }
  }

  // gameover/win: R handled above
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowDown') {
    e.preventDefault();
  }

  if (gameState === 'running' && e.code === 'ArrowDown') {
    if (player.ducking) {
      player.ducking = false;
      player.height = player.originalHeight;
      player.y = GROUND_Y - player.height;
    }
  }


});

/* ---------- Start / Reset ---------- */
function startGame() {
  
  gameState = 'running';
  score = 0;
  fakeProgress = 0;
  speed = baseSpeed;
  obstacles = [];
  lastObstacleX = -9999;
  spawnElapsed = 0;
  inLastLevel = false;
  cinematicActive = false;
  lastLevelChaos = false;
  chaserState = 'idle';
  chaser.x = PLAYER_SCREEN_X - 300;
  bigChaser.x = 99999;
  currentMessage = '';
  nextMsgAt = 300;
  lastTime = performance.now();
}

function resetToTitle() {
  gameState = 'waiting';
  // reset player variables
  player.y = GROUND_Y - player.height;
  player.vy = 0;
  player.jumpsUsed = 0;
  player.ducking = false;
  // preserve high score
  drawStartScreen();
}

/* ---------- Helpers ---------- */
function isPlayerGrounded() {
  return Math.abs((player.y + player.height) - GROUND_Y) < 1;
}

function saveHighScore() {
  if (Math.floor(score) > highScore) {
    highScore = Math.floor(score);
    localStorage.setItem('sarcasticHighScore', highScore);
  }
}

/* ---------- Spawn Obstacles ---------- */
function spawnObstacleNormal() {
  const isAir = Math.random() < 0.45;
  const w = 28 + Math.floor(Math.random() * 28);
  const h = isAir ? 36 : 48;
  const y = isAir ? (GROUND_Y - 80) : (GROUND_Y - h);
  const color = isAir ? '#ff9f43' : '#fff';
  const x = canvas.width + 20;
  // enforce min gap in screen space (normal mode)
  // Find the rightmost obstacle on screen
  let rightmostX = -9999;
  for (let o of obstacles) {
    if (o.x > rightmostX) rightmostX = o.x;
  }

  // enforce min gap in screen space (normal mode)
  if (rightmostX > 0) {
    const gap = x - rightmostX;
    if (gap < normalMinGap) return; // skip spawn to maintain min gap
  }
  obstacles.push({ x, y, w, h, type: isAir ? 'air' : 'ground', color });
  lastObstacleX = x;
}

function spawnObstacleLastChaos() {
  const isAir = Math.random() < 0.55;
  const w = 26 + Math.floor(Math.random() * 36);
  const h = isAir ? 36 : 48;
  const y = isAir ? (GROUND_Y - 80) : (GROUND_Y - h);
  const color = isAir ? '#ff6b81' : '#fff';
  const x = canvas.width + 20;
  obstacles.push({ x, y, w, h, type: isAir ? 'air' : 'ground', color });
  lastObstacleX = x;
}

/* ---------- Collision detection ---------- */
function rectsOverlap(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function checkCollisions() {
  const p = { x: player.screenX, y: player.y, w: player.width, h: player.height };
  for (let o of obstacles) {
    const rect = { x: o.x, y: o.y, w: o.w, h: o.h };
    if (rectsOverlap({ x: p.x, y: p.y, w: p.w, h: p.h }, rect)) {
      // On collision, if it's aerial and player is ducking then safe,
      // if ground and player is above it (jumped) then safe. But rect check already did full overlap; we want:
      // If obstacle is 'air' and player.ducking -> safe
      if (o.type === 'air' && player.ducking) continue;
      // If obstacle is 'ground' and player's feet are above obstacle top (i.e., player jumped over) -> safe
      if (o.type === 'ground' && (player.y + player.height) < (o.y + 6)) continue;
      // otherwise hit
      gameState = 'gameover';
      saveHighScore();
      return true;
    }
  }
  return false;
}

// /* ---------- Cinematic (chaser) ---------- */
 function enterLastLevelCinematic() {
   if (inLastLevel) return;
   inLastLevel = true;
   cinematicActive = true;
   chaserState = 'follow';
   chaser.x = PLAYER_SCREEN_X - 300;
   chaser.y = GROUND_Y - chaser.h;
   chaser.speed = speed * 0.95;
   chaserFollowStart = performance.now();
    // pause obstacle spawning during cinematic
   
 }

function enterLastLevelCinematic() {
  if (inLastLevel) return;
  inLastLevel = true;
  cinematicActive = true;
  chaserState = 'follow';
  chaser.x = PLAYER_SCREEN_X - 300;
  chaser.y = GROUND_Y - chaser.h;
  chaser.speed = speed * 0.95;
  chaserFollowStart = performance.now();
  // pause obstacle spawning during cinematic
  spawnElapsed = 0;
}

function updateCinematic(dt, now) {
  if (!cinematicActive) return;

  if (chaserState === 'follow') {
    // chaser approaches right gradually
    chaser.x += (chaser.speed * dt) / 1000;
    // increase world's speed faster to induce tension
    speed = clamp(speed + (60 * dt / 1000), baseSpeed, maxSpeed);
    if (now - chaserFollowStart >= 30000) { // 30s
      chaserState = 'pass';
      chaser.passSpeed = speed * 3;
    }
  }
  else if (chaserState === 'pass') {
    chaser.x += (chaser.passSpeed * dt) / 1000;
    if (chaser.x > canvas.width + 60) {
      chaserState = 'passed';
      chaserPassedAt = performance.now();
    }
  }
  else if (chaserState === 'passed') {
    // wait 5s
    if (performance.now() - chaserPassedAt >= 5000) {
      chaserState = 'returning';
      chaser.x = canvas.width + 60;
      chaser.returnSpeed = - (speed * 1.2);
      bigChaser.x = canvas.width + 240;
      bigChaser.speed = - (speed * 1.7);
    }
  }
  else if (chaserState === 'returning') {
    chaser.x += (chaser.returnSpeed * dt) / 1000;
    bigChaser.x += (bigChaser.speed * dt) / 1000;
    if (bigChaser.x + bigChaser.w < -120) {
      // cinematic ends
      chaserState = 'done';
      cinematicActive = false;
      lastLevelChaos = true;
      speed = clamp(speed * 1.2, baseSpeed, maxSpeed);
    }
  }
}



/* ---------- Draw helpers ---------- */
function drawStartScreen() {
  ctx.fillStyle = '#111';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = '28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Press SPACE to start running', canvas.width/2, canvas.height/2 - 10);
  ctx.font = '14px monospace';
  ctx.fillText('Jump: Space/↑   Duck: ↓   Restart: R   Quit: Q', canvas.width/2, canvas.height/2 + 20);
  ctx.textAlign = 'left';
}

function drawGameHUD() {
  ctx.fillStyle = '#fff';
  ctx.font = '16px monospace';
  ctx.fillText('Score: ' + Math.floor(score), 12, 22);
  ctx.fillText('High: ' + Math.floor(highScore), 12, 42);

  // fake progress bar
  ctx.strokeStyle = '#666';
  ctx.strokeRect(canvas.width - 240, 12, 220, 16);
  ctx.fillStyle = '#6f6';
  const prog = Math.min(216, (fakeProgress % 10000)/10000 * 216);
  ctx.fillRect(canvas.width - 238, 14, prog, 12);
  ctx.fillStyle = '#fff';
  ctx.font = '12px sans-serif';
  ctx.fillText('Finish Line →', canvas.width - 120, 24);

  // message
  if (currentMessage) {
    ctx.fillStyle = '#ddd';
    ctx.fillText(currentMessage, 12, canvas.height - 14);
  }
}

// stickman figure
function drawStickman(x, y, height, ducking) {
  /*
    x, y = top-left corner of player bounding box
    height = total height of stickman
    ducking = boolean to draw a crouched pose
  */

  const headRadius = 10;
  const bodyLength = height - headRadius * 2; // body length below head

  ctx.strokeStyle = '#0ef';
  ctx.lineWidth = 3;

  // head (circle)
  ctx.beginPath();
  ctx.arc(x + player.width / 2, y + headRadius, headRadius, 0, Math.PI * 2);
  ctx.stroke();

  // torso line
  ctx.beginPath();
  ctx.moveTo(x + player.width / 2, y + headRadius * 2);
  if (ducking) {
    // torso bent forward a bit
    ctx.lineTo(x + player.width / 2 - 10, y + headRadius * 2 + bodyLength * 0.7);
  } else {
    ctx.lineTo(x + player.width / 2, y + headRadius * 2 + bodyLength);
  }
  ctx.stroke();

  // arms
  ctx.beginPath();
  const armY = y + headRadius * 2 + bodyLength * 0.3;
  ctx.moveTo(x + player.width / 2, armY);
  ctx.lineTo(x + player.width / 2 - 15, armY + 15);
  ctx.moveTo(x + player.width / 2, armY);
  ctx.lineTo(x + player.width / 2 + 15, armY + 15);
  ctx.stroke();

  // legs
  ctx.beginPath();
  const legStartY = y + headRadius * 2 + bodyLength;
  ctx.moveTo(x + player.width / 2, legStartY);
  ctx.lineTo(x + player.width / 2 - 15, legStartY + 25);
  ctx.moveTo(x + player.width / 2, legStartY);
  ctx.lineTo(x + player.width / 2 + 15, legStartY + 25);
  ctx.stroke();
}
// rocks as ground obstacles
function drawRock(x, y, width, height, color) {
  ctx.fillStyle = color;
  ctx.beginPath();

  // Rough rock shape with arcs and curves
  const segments = 5;
  const segmentWidth = width / segments;

  ctx.moveTo(x, y + height * 0.6);

  for (let i = 0; i <= segments; i++) {
    const px = x + i * segmentWidth;
    // Randomize y to create rough edges
    const py = y + height * 0.6 - (Math.sin(i * Math.PI / segments) * height * 0.3);
    ctx.lineTo(px, py);
  }

  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x, y + height);
  ctx.closePath();

  ctx.fill();

  // Optional: add some lighter shading lines for rock texture
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + width * 0.2, y + height * 0.7);
  ctx.lineTo(x + width * 0.4, y + height * 0.5);
  ctx.lineTo(x + width * 0.6, y + height * 0.7);
  ctx.stroke();
}
// rrockets
function drawMissileWithFire(x, y, w, h) {
  // Draw missile body (gray)
  ctx.fillStyle = '#888';
  ctx.fillRect(x, y + h * 0.25, w * 0.7, h * 0.5);

  // Draw missile nose (triangle pointing left)
  ctx.fillStyle = '#555';
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.5);
  ctx.lineTo(x + w * 0.3, y + h * 0.25);
  ctx.lineTo(x + w * 0.3, y + h * 0.75);
  ctx.closePath();
  ctx.fill();

  // Draw fins (small triangles)
  ctx.fillStyle = '#666';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.5, y + h * 0.25);
  ctx.lineTo(x + w * 0.8, y + h * 0.1);
  ctx.lineTo(x + w * 0.7, y + h * 0.4);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x + w * 0.5, y + h * 0.75);
  ctx.lineTo(x + w * 0.8, y + h * 0.9);
  ctx.lineTo(x + w * 0.7, y + h * 0.6);
  ctx.closePath();
  ctx.fill();

  // Draw fire behind (animated with flicker)
  let fireHeight = h * 0.6 + Math.sin(Date.now() / 100) * (h * 0.1);
  let fireWidth = w * 0.3;

  let fireX = x + w * 0.7;
  let fireY = y + h * 0.5;

  const gradient = ctx.createRadialGradient(fireX, fireY, 2, fireX, fireY, fireWidth);
  gradient.addColorStop(0, 'orange');
  gradient.addColorStop(0.5, 'red');
  gradient.addColorStop(1, 'transparent');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(fireX, fireY, fireWidth, fireHeight / 2, 0, 0, Math.PI * 2);
  ctx.fill();
}



/* ---------- Main Loop ---------- */
function loop(now) {
  if (!lastTime) lastTime = now;
  const dt = now - lastTime; // ms
  lastTime = now;
  stripeOffset += (speed * dt) / 1000;
  stripeOffset %= 20;  // Assuming stripeWidth is 10, so 10*2=20 for full cycle


  // clear
  if (inLastLevel) {
  ctx.fillStyle = '#330000';  // dark red background for final level
  } else {
  ctx.fillStyle = '#111';     // normal background
  }
  ctx.fillRect(0, 0, canvas.width, canvas.height);


  if (gameState === 'waiting') {
    drawStartScreen();
    requestAnimationFrame(loop);
    return;
  }

  if (gameState === 'gameover') {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('💀 Game Over — Press R to Restart', canvas.width/2, canvas.height/2);
    ctx.textAlign = 'left';
    requestAnimationFrame(loop);
    return;
  }

  if (gameState === 'win') {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🏆 YOU WIN (cheater) — Press R to Play Again', canvas.width/2, canvas.height/2);
    ctx.textAlign = 'left';
    requestAnimationFrame(loop);
    return;
  }

  // Running state:
  // update speed slowly
  speed = clamp(speed + (10 * dt / 1000), baseSpeed, maxSpeed);

  // update obstacles positions
  for (let o of obstacles) {
    o.x -= (speed * dt) / 1000;
  }
  // cleanup offscreen
  obstacles = obstacles.filter(o => (o.x + o.w) > -200);

  // spawn logic
  spawnElapsed += dt;
  if (!inLastLevel) {
    if (spawnElapsed >= spawnIntervalMs) {
      spawnObstacleNormal();
      spawnElapsed = 0;
    }
  } else {
    // cinematicActive pauses normal spawn
    if (!cinematicActive) {
      // randomized interval 0.4s - 1.2s
      if (spawnElapsed >= (Math.random() * 800 + 400)) {
        spawnObstacleLastChaos();
        spawnElapsed = 0;
      }
    }
  }

  // player physics (vy in px/sec)
  player.vy += (player.gravity * dt) / 1000;
  player.y += (player.vy * dt) / 1000;

  // ground clamp & reset jumps when touching ground
  if (player.y + player.height >= GROUND_Y) {
    player.y = GROUND_Y - player.height;
    player.vy = 0;
    player.jumpsUsed = 0;
  }

  // draw ground
  // draw ground with vertical stripes
  const stripeWidth = 10;
const numStripes = Math.ceil(canvas.width / stripeWidth) + 1;

for (let i = 0; i < numStripes; i++) {
  let x = (i * stripeWidth) - (stripeOffset % (stripeWidth * 2));
  if (i % 2 === 0) {
    ctx.fillStyle = '#274156';
  } else {
    ctx.fillStyle = '#3b536a';
  }
  ctx.fillRect(x, GROUND_Y, stripeWidth, canvas.height - GROUND_Y);
}



  // draw obstacles
  // draw obstacles
for (let o of obstacles) {
  if (o.type === 'ground') {
    drawRock(o.x, o.y, o.w, o.h, o.color);
  } else {
    // keep aerial obstacles as rectangles for now
   drawMissileWithFire(o.x, o.y, o.w, o.h);
  }
}


  // check entering last level (use score threshold)
  if (!inLastLevel && score >= 200) {
  inLastLevel = true;
  lastLevelChaos = true;
  cinematicActive = false;
  currentMessage = '🔥 Final Level! Watch out! 🔥';  // show message on HUD
}


  // update cinematic
  updateCinematic(dt, now);

  // draw chasers (if cinematic)
  if (cinematicActive) {
    if (chaserState === 'follow' || chaserState === 'pass' || chaserState === 'returning') {
      ctx.fillStyle = 'purple';
      ctx.fillRect(chaser.x, chaser.y, chaser.w, chaser.h);
    }
    if (chaserState === 'returning' || chaserState === 'done') {
      if (bigChaser.x < 99998) {
        ctx.fillStyle = 'orange';
        ctx.fillRect(bigChaser.x, bigChaser.y, bigChaser.w, bigChaser.h);
      }
    }
  }

  // draw player (ducking visual)
  drawStickman(player.screenX, player.y, player.height, player.ducking);


  // update fake progress & score
  fakeProgress += (speed * dt) / 1000;
  score += (dt / 1000) * 10;

  // update messages occasionally
  if (Math.floor(score) > nextMsgAt) {
    currentMessage = messages[Math.floor(Math.random() * messages.length)];
    nextMsgAt += 400 + Math.random() * 300;
  }

  // draw HUD
  drawGameHUD();

  // collisions (only active when not cinematicActive or even during cinematic obstacles are absent)
  if (!cinematicActive) {
    checkCollisions();
  }

  requestAnimationFrame(loop);
}

/* ---------- Start the loop ---------- */
drawStartScreen();
requestAnimationFrame(loop);           