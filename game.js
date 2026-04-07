const GameState = Object.freeze({
  IDLE: 'idle',
  CASTING: 'casting',
  WAITING_FOR_BITE: 'waiting_for_bite',
  BITE_WINDOW: 'bite_window',
  HOOKED: 'hooked',
  REELING: 'reeling',
  CAUGHT: 'caught',
  FAILED: 'failed',
});

const DATA = {
  gear: {
    basicRod: { name: 'Basic Rod', hookWindowMs: 700, castSpeed: 750 },
    starterLine: { name: 'Starter Line', reelRisePerSec: 0.95, reelFallPerSec: 0.68 },
  },
  maps: {
    willowLake: {
      id: 'willowLake',
      name: 'Willow Lake',
      waterColor: '#2a7498',
      fishPool: [
        {
          id: 'bluegill',
          name: 'Bluegill',
          rarity: 0.5,
          value: 7,
          difficulty: {
            targetHeight: 0.3,
            progressDrainPerSec: 0.2,
            progressGainPerSec: 0.72,
            timeToCatch: 2.2,
            fishForceRange: [0.3, 0.7],
          },
        },
        {
          id: 'largemouthBass',
          name: 'Largemouth Bass',
          rarity: 0.32,
          value: 26,
          difficulty: {
            targetHeight: 0.24,
            progressDrainPerSec: 0.28,
            progressGainPerSec: 0.7,
            timeToCatch: 3.2,
            fishForceRange: [0.4, 1.0],
          },
        },
        {
          id: 'goldenCarp',
          name: 'Golden Carp',
          rarity: 0.14,
          value: 80,
          difficulty: {
            targetHeight: 0.18,
            progressDrainPerSec: 0.34,
            progressGainPerSec: 0.64,
            timeToCatch: 4.6,
            fishForceRange: [0.55, 1.25],
          },
        },
        {
          id: 'mythicKoi',
          name: 'Mythic Koi',
          rarity: 0.04,
          value: 300,
          difficulty: {
            targetHeight: 0.14,
            progressDrainPerSec: 0.44,
            progressGainPerSec: 0.6,
            timeToCatch: 6,
            fishForceRange: [0.9, 1.45],
          },
        },
      ],
    },
  },
};

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const stateText = document.getElementById('stateText');
const mapText = document.getElementById('mapText');
const catchLogEl = document.getElementById('catchLog');

const game = {
  currentState: GameState.IDLE,
  map: DATA.maps.willowLake,
  gear: { rod: DATA.gear.basicRod, line: DATA.gear.starterLine },
  boat: { x: canvas.width / 2, y: canvas.height / 2, radius: 52 },
  fisher: { angle: 0 },
  castTarget: null,
  castProgress: 0,
  waitTimerMs: 0,
  nibbleEvents: [],
  nibbleIndex: 0,
  fishOnHook: null,
  biteElapsedMs: 0,
  totalValue: 0,
  log: [],
  reeling: {
    meter: 0.5,
    progress: 0,
    holdSpace: false,
    targetCenter: 0.5,
    targetHeight: 0.2,
    fishPull: 0,
    fishJerkTimer: 0,
  },
  stateTimerMs: 0,
  message: 'Click the water to cast.',
};

mapText.textContent = `${game.map.name} (${game.map.id})`;
setState(GameState.IDLE);

canvas.addEventListener('click', onCastClick);
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

let lastTs = performance.now();
requestAnimationFrame(loop);

function onCastClick(event) {
  if (![GameState.IDLE, GameState.CAUGHT, GameState.FAILED].includes(game.currentState)) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;

  if (distance(x, y, game.boat.x, game.boat.y) <= game.boat.radius * 0.8) {
    game.message = 'Cast somewhere into open water.';
    return;
  }

  game.castTarget = { x, y, visibleX: game.boat.x, visibleY: game.boat.y, submerged: false };
  game.fisher.angle = Math.atan2(y - game.boat.y, x - game.boat.x);
  game.castProgress = 0;
  setState(GameState.CASTING);
}

function onKeyDown(event) {
  if (event.code !== 'Space') return;
  event.preventDefault();

  if (game.currentState === GameState.BITE_WINDOW) {
    beginReeling();
    return;
  }

  if (game.currentState === GameState.REELING) {
    game.reeling.holdSpace = true;
  }
}

function onKeyUp(event) {
  if (event.code !== 'Space') return;
  if (game.currentState === GameState.REELING) {
    game.reeling.holdSpace = false;
  }
}

function loop(ts) {
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

function update(dt) {
  game.stateTimerMs += dt * 1000;

  switch (game.currentState) {
    case GameState.CASTING:
      updateCasting(dt);
      break;
    case GameState.WAITING_FOR_BITE:
      updateWaitingForBite(dt);
      break;
    case GameState.BITE_WINDOW:
      updateBiteWindow(dt);
      break;
    case GameState.REELING:
      updateReeling(dt);
      break;
    default:
      break;
  }
}

function updateCasting(dt) {
  game.castProgress = Math.min(1, game.castProgress + dt * (game.gear.rod.castSpeed / 500));
  const t = easeOutCubic(game.castProgress);
  game.castTarget.visibleX = lerp(game.boat.x, game.castTarget.x, t);
  game.castTarget.visibleY = lerp(game.boat.y, game.castTarget.y, t);

  if (game.castProgress >= 1) {
    prepareBiteSequence();
    setState(GameState.WAITING_FOR_BITE);
  }
}

function prepareBiteSequence() {
  game.waitTimerMs = randomRange(1300, 4200);
  game.nibbleEvents = [];
  game.nibbleIndex = 0;

  const nibbleCount = Math.floor(Math.random() * 3);
  for (let i = 0; i < nibbleCount; i += 1) {
    game.nibbleEvents.push(randomRange(250, game.waitTimerMs - 350));
  }
  game.nibbleEvents.sort((a, b) => a - b);

  game.fishOnHook = rollFishFromPool(game.map.fishPool);
  game.castTarget.submerged = false;
  game.message = 'Waiting for a bite...';
}

function updateWaitingForBite(dt) {
  game.waitTimerMs -= dt * 1000;

  while (game.nibbleIndex < game.nibbleEvents.length && game.waitTimerMs <= game.nibbleEvents[game.nibbleIndex]) {
    game.nibbleIndex += 1;
    game.message = 'Nibble... wait for a real bite!';
    pulseBobber(0.16);
  }

  if (game.waitTimerMs <= 0) {
    game.castTarget.submerged = true;
    game.biteElapsedMs = 0;
    game.message = 'BITE! Press SPACE now!';
    setState(GameState.BITE_WINDOW);
  }
}

function updateBiteWindow(dt) {
  game.biteElapsedMs += dt * 1000;
  if (game.biteElapsedMs >= game.gear.rod.hookWindowMs) {
    failCast('Too slow! The fish got away.');
  }
}

function beginReeling() {
  const difficulty = game.fishOnHook.difficulty;
  game.reeling.meter = 0.5;
  game.reeling.progress = 0;
  game.reeling.holdSpace = true;
  game.reeling.targetCenter = randomRange(0.25, 0.75);
  game.reeling.targetHeight = difficulty.targetHeight;
  game.reeling.fishPull = randomRange(...difficulty.fishForceRange);
  game.reeling.fishJerkTimer = randomRange(0.35, 0.85);

  game.message = `Hook set! Reeling in ${game.fishOnHook.name}...`;
  setState(GameState.HOOKED);
  setState(GameState.REELING);
}

function updateReeling(dt) {
  const { line } = game.gear;
  const reel = game.reeling;
  const fishDiff = game.fishOnHook.difficulty;

  reel.fishJerkTimer -= dt;
  if (reel.fishJerkTimer <= 0) {
    reel.fishPull = randomRange(...fishDiff.fishForceRange);
    reel.targetCenter = clamp(reel.targetCenter + randomRange(-0.2, 0.2), 0.15, 0.85);
    reel.fishJerkTimer = randomRange(0.25, 0.9);
  }

  const holdForce = reel.holdSpace ? line.reelRisePerSec : -line.reelFallPerSec;
  reel.meter = clamp(reel.meter + (holdForce - reel.fishPull * 0.35) * dt, 0, 1);

  const zoneTop = reel.targetCenter - reel.targetHeight / 2;
  const zoneBottom = reel.targetCenter + reel.targetHeight / 2;
  const inZone = reel.meter >= zoneTop && reel.meter <= zoneBottom;

  if (inZone) {
    reel.progress += fishDiff.progressGainPerSec * dt;
  } else {
    reel.progress -= fishDiff.progressDrainPerSec * dt;
  }
  reel.progress = clamp(reel.progress, 0, fishDiff.timeToCatch);

  if (reel.progress >= fishDiff.timeToCatch) {
    completeCatch();
  }

  if (reel.meter <= 0.01 || reel.meter >= 0.99) {
    failCast(`${game.fishOnHook.name} broke free during the fight.`);
  }
}

function completeCatch() {
  const fish = game.fishOnHook;
  game.totalValue += fish.value;
  game.log.unshift(`${fish.name} (+$${fish.value})`);
  game.log = game.log.slice(0, 8);
  refreshLog();

  setState(GameState.CAUGHT);
  game.message = `Caught ${fish.name}! Total value: $${game.totalValue}. Click to cast again.`;
}

function failCast(reason) {
  setState(GameState.FAILED);
  game.message = `${reason} Click to cast again.`;
}

function setState(nextState) {
  game.currentState = nextState;
  game.stateTimerMs = 0;
  stateText.textContent = nextState.replaceAll('_', ' ');
  overlay.textContent = game.message;
}

function refreshLog() {
  catchLogEl.innerHTML = '';
  if (!game.log.length) {
    const item = document.createElement('li');
    item.textContent = 'No catches yet.';
    catchLogEl.appendChild(item);
    return;
  }

  game.log.forEach((entry) => {
    const item = document.createElement('li');
    item.textContent = entry;
    catchLogEl.appendChild(item);
  });
}

refreshLog();

function render() {
  drawWater();
  drawBoat();
  drawFisher();
  drawBobber();

  if (game.currentState === GameState.REELING) {
    drawReelingHud();
  }

  overlay.textContent = game.message;
}

function drawWater() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createRadialGradient(
    canvas.width / 2,
    canvas.height / 2,
    120,
    canvas.width / 2,
    canvas.height / 2,
    canvas.width * 0.7,
  );
  gradient.addColorStop(0, lightenColor(game.map.waterColor, 0.18));
  gradient.addColorStop(1, darkenColor(game.map.waterColor, 0.28));

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 28; i += 1) {
    const x = (i * 173 + performance.now() * 0.015) % (canvas.width + 120) - 60;
    const y = ((i * 71) % (canvas.height + 100)) - 50;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(x, y, 18 + (i % 5) * 3, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawBoat() {
  ctx.save();
  ctx.translate(game.boat.x, game.boat.y);

  ctx.fillStyle = '#5a3e2a';
  ctx.beginPath();
  ctx.ellipse(0, 0, 72, 44, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#734f37';
  ctx.beginPath();
  ctx.ellipse(0, 0, 56, 30, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#2f1c11';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(0, 0, 72, 44, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function drawFisher() {
  const angle = game.fisher.angle;
  const px = game.boat.x + Math.cos(angle) * 8;
  const py = game.boat.y + Math.sin(angle) * 8;

  ctx.fillStyle = '#fed8af';
  ctx.beginPath();
  ctx.arc(px, py - 10, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#152028';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(px, py - 2);
  ctx.lineTo(px + Math.cos(angle) * 15, py + Math.sin(angle) * 15);
  ctx.stroke();

  ctx.strokeStyle = '#f2f6ff';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(px + Math.cos(angle) * 13, py + Math.sin(angle) * 13);
  const hookTarget = game.castTarget ? [game.castTarget.visibleX, game.castTarget.visibleY] : [px, py];
  ctx.lineTo(hookTarget[0], hookTarget[1]);
  ctx.stroke();
}

function drawBobber() {
  if (!game.castTarget) return;
  const bobberY = game.castTarget.visibleY + (game.castTarget.submerged ? 8 : 0);

  ctx.fillStyle = game.castTarget.submerged ? '#d04444' : '#ff6767';
  ctx.beginPath();
  ctx.arc(game.castTarget.visibleX, bobberY, game.castTarget.submerged ? 4 : 7, 0, Math.PI * 2);
  ctx.fill();

  if (!game.castTarget.submerged) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(game.castTarget.visibleX, bobberY - 3, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawReelingHud() {
  const x = canvas.width - 64;
  const y = 110;
  const w = 20;
  const h = 320;
  const reel = game.reeling;

  ctx.fillStyle = 'rgba(7, 13, 22, 0.7)';
  ctx.fillRect(x, y, w, h);

  const zoneTopPx = y + (1 - (reel.targetCenter + reel.targetHeight / 2)) * h;
  const zoneHeightPx = reel.targetHeight * h;
  ctx.fillStyle = 'rgba(102, 209, 122, 0.65)';
  ctx.fillRect(x, zoneTopPx, w, zoneHeightPx);

  const meterY = y + (1 - reel.meter) * h;
  ctx.fillStyle = '#ffdb5a';
  ctx.fillRect(x - 5, meterY - 4, w + 10, 8);

  const fish = game.fishOnHook;
  const progressPct = Math.floor((reel.progress / fish.difficulty.timeToCatch) * 100);

  ctx.fillStyle = '#e9f8ff';
  ctx.font = '14px sans-serif';
  ctx.fillText(`Reeling ${fish.name}`, x - 170, y - 16);
  ctx.fillText(`Catch progress ${progressPct}%`, x - 170, y + h + 20);
}

function rollFishFromPool(pool) {
  const total = pool.reduce((sum, fish) => sum + fish.rarity, 0);
  let roll = Math.random() * total;

  for (const fish of pool) {
    roll -= fish.rarity;
    if (roll <= 0) return fish;
  }
  return pool[pool.length - 1];
}

function pulseBobber(strength) {
  if (!game.castTarget) return;
  game.castTarget.visibleY += strength * 18;
  setTimeout(() => {
    if (game.castTarget) {
      game.castTarget.visibleY -= strength * 18;
    }
  }, 120);
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lightenColor(hex, amount) {
  return adjustHex(hex, amount);
}

function darkenColor(hex, amount) {
  return adjustHex(hex, -amount);
}

function adjustHex(hex, amt) {
  const value = hex.replace('#', '');
  const num = parseInt(value, 16);
  let r = (num >> 16) + Math.round(255 * amt);
  let g = ((num >> 8) & 0x00ff) + Math.round(255 * amt);
  let b = (num & 0x0000ff) + Math.round(255 * amt);

  r = clamp(r, 0, 255);
  g = clamp(g, 0, 255);
  b = clamp(b, 0, 255);

  return `rgb(${r}, ${g}, ${b})`;
}
