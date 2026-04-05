const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const MAZE_WIDTH = 23;
const MAZE_HEIGHT = 15;

const COLORS = [
  { id: "red", hex: "#ff5d73", start: { x: 1, y: 1 } },
  { id: "blue", hex: "#58a6ff", start: { x: MAZE_WIDTH - 2, y: 1 } },
  { id: "green", hex: "#61d095", start: { x: 1, y: MAZE_HEIGHT - 2 } },
  { id: "gold", hex: "#ffd166", start: { x: MAZE_WIDTH - 2, y: MAZE_HEIGHT - 2 } }
];

const EFFECT_DEFS = {
  maze: { label: "Shift maze + doelen", durationMs: 0, cooldownMs: 40000, scope: "world" },
  swap: { label: "Wereld-besturing", durationMs: 10000, cooldownMs: 40000, scope: "world" },
  freeze: { label: "Bevries speler", durationMs: 5000, cooldownMs: 40000, scope: "personal" }
};

const ICONS = {
  maze: "M",
  swap: "LR",
  freeze: "F"
};

const MOVE_INTERVAL_MS = 180;
const EFFECT_IMMUNITY_MS = 1800;
const WIN_SCORE = 3;
const START_COUNTDOWN_MS = 4000;
const MAZE_BREAK_MS = 3000;
const WORLD_ACTION_LOCK_BUFFER_MS = 1200;
const ACTION_CHARGE_MS = 40000;

const room = createRoomState();
const clients = new Map();
let dashboardCount = 0;
let countdownTimer = null;
let roundResetTimer = null;
const HEARTBEAT_MS = 10000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json"
};

const server = http.createServer((request, response) => {
  let requestPath = request.url || "/";
  requestPath = requestPath.split("?")[0];
  if (requestPath === "/" || requestPath === "") {
    requestPath = "/index.html";
  }
  if (requestPath === "/controller") {
    requestPath = "/controller.html";
  }

  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    const extension = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream"
    });
    response.end(content);
  });
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  const clientId = crypto.randomUUID();
  const client = { id: clientId, socket, role: "spectator", playerId: null, isAlive: true };
  clients.set(clientId, client);

  socket.on("pong", () => {
    client.isAlive = true;
  });

  socket.on("message", (rawMessage) => {
    try {
      handleMessage(client, JSON.parse(String(rawMessage)));
    } catch (error) {
      send(client.socket, { type: "error", message: "Invalid message payload." });
    }
  });

  socket.on("close", () => handleDisconnect(client));
  socket.on("error", () => handleDisconnect(client));
  sendState();
});

const heartbeatInterval = setInterval(() => {
  clients.forEach((client) => {
    if (client.socket.readyState !== 1) {
      handleDisconnect(client);
      return;
    }

    if (!client.isAlive) {
      client.socket.terminate();
      handleDisconnect(client);
      return;
    }

    client.isAlive = false;
    try {
      client.socket.ping();
    } catch (error) {
      handleDisconnect(client);
    }
  });
}, HEARTBEAT_MS);

wss.on("close", () => {
  clearInterval(heartbeatInterval);
});

server.listen(PORT, () => {
  console.log(`Maze Sabotage Arena running on http://localhost:${PORT}`);
});

function createRoomState() {
  const maze = generateMaze(MAZE_WIDTH, MAZE_HEIGHT);
  return {
    roomCode: "ARENA",
    maze,
    players: [],
    round: 1,
    phase: "lobby",
    message: "Waiting for players",
    winnerId: null,
    roundResetAt: 0,
    countdownEndsAt: 0,
    worldActionLockUntil: 0
  };
}

function handleMessage(client, message) {
  if (message.type === "join-player") {
    joinPlayer(client, message.name);
    return;
  }

  if (message.type === "join-dashboard") {
    if (client.role === "dashboard" || client.playerId) {
      return;
    }
    client.role = "dashboard";
    dashboardCount += 1;
    sendState();
    return;
  }

  if (message.type === "input") {
    handleInput(client, message.direction);
    return;
  }

  if (message.type === "sabotage") {
    handleSabotage(client, message.actionId, message.targetId);
    return;
  }

  if (message.type === "start-game") {
    handleStartGame(client);
    return;
  }

  if (message.type === "stop-game") {
    handleStopGame(client);
  }
}

function joinPlayer(client, rawName) {
  if (client.playerId || client.role === "dashboard") {
    return;
  }

  const availableColor = COLORS.find((color) => !room.players.some((player) => player.colorId === color.id));
  if (!availableColor) {
    send(client.socket, { type: "error", message: "The arena is full. Up to 4 players can join." });
    return;
  }

  const player = createPlayer(rawName, availableColor);
  room.players.push(player);
  client.role = "player";
  client.playerId = player.id;
  room.message = room.players.length >= 2
    ? "Lobby ready. Dashboard can start the round."
    : "Need at least 2 players to start the race.";

  assignGoals();
  sendState();
}

function createPlayer(rawName, color) {
  const displayName = typeof rawName === "string" && rawName.trim()
    ? rawName.trim().slice(0, 18)
    : `${capitalize(color.id)} Runner`;

  return {
    id: crypto.randomUUID(),
    name: displayName,
    colorId: color.id,
    colorHex: color.hex,
    start: { ...color.start },
    position: { ...color.start },
    score: 0,
    mazeScore: 0,
    goal: null,
    activeEffect: null,
    effectEndsAt: 0,
    immunityUntil: 0,
    cooldowns: {
      maze: 0,
      swap: 0,
      freeze: 0
    },
    moveLockedUntil: 0,
    lastMoveAt: 0,
    lastTargetId: null,
    lastTargetAt: 0
  };
}

function handleDisconnect(client) {
  if (!clients.has(client.id)) {
    return;
  }

  clients.delete(client.id);

  if (client.role === "dashboard" && dashboardCount > 0) {
    dashboardCount -= 1;
  }

  if (client.playerId) {
    room.players = room.players.filter((player) => player.id !== client.playerId);
    if (room.players.length === 0) {
      clearTimer("countdown");
      clearTimer("roundReset");
      room.maze = generateMaze(MAZE_WIDTH, MAZE_HEIGHT);
      room.round = 1;
      room.phase = "lobby";
      room.winnerId = null;
      room.roundResetAt = 0;
      room.countdownEndsAt = 0;
      room.worldActionLockUntil = 0;
      room.message = "Waiting for players";
    } else {
      assignGoals();
      room.message = room.players.length >= 2
        ? room.phase === "playing" || room.phase === "countdown"
          ? room.message
          : "Lobby ready. Dashboard can start the round."
        : "Need at least 2 players to start the race.";

      if (room.players.length < 2 && room.phase !== "playing") {
        clearTimer("countdown");
        room.phase = "lobby";
        room.countdownEndsAt = 0;
      }
    }
  }

  sendState();
}

function handleStartGame(client) {
  if (client.role !== "dashboard") {
    return;
  }

  if (room.players.length < 2 || room.phase !== "lobby") {
    return;
  }

  room.phase = "countdown";
  room.countdownEndsAt = Date.now() + START_COUNTDOWN_MS;
  room.worldActionLockUntil = 0;
  room.message = "Get ready. Round starts soon.";
  room.players.forEach((player) => {
    player.position = { ...player.start };
    player.lastMoveAt = 0;
    player.activeEffect = null;
    player.effectEndsAt = 0;
    player.immunityUntil = 0;
    player.moveLockedUntil = 0;
    setSharedCooldowns(player, ACTION_CHARGE_MS);
  });
  assignGoals();
  scheduleCountdownStart();
  sendState();
}

function handleStopGame(client) {
  if (client.role !== "dashboard") {
    return;
  }

  clearTimer("countdown");
  clearTimer("roundReset");
  room.phase = "lobby";
  room.round = 1;
  room.winnerId = null;
  room.roundResetAt = 0;
  room.countdownEndsAt = 0;
  room.worldActionLockUntil = 0;
  room.maze = generateMaze(MAZE_WIDTH, MAZE_HEIGHT);
  room.players.forEach((player) => {
    player.position = { ...player.start };
    player.score = 0;
    player.mazeScore = 0;
    player.goal = null;
    player.activeEffect = null;
    player.effectEndsAt = 0;
    player.immunityUntil = 0;
    player.moveLockedUntil = 0;
    player.cooldowns = {
      maze: Date.now() + ACTION_CHARGE_MS,
      swap: Date.now() + ACTION_CHARGE_MS,
      freeze: Date.now() + ACTION_CHARGE_MS
    };
    player.lastMoveAt = 0;
    player.lastTargetAt = 0;
    player.lastTargetId = null;
  });
  assignGoals();
  room.message = room.players.length >= 2
    ? "Spel gestopt. Je kunt opnieuw starten vanuit de lobby."
    : "Spel gestopt. Wachten op spelers.";
  sendState();
}

function handleInput(client, direction) {
  const player = getPlayer(client.playerId);
  if (!player || room.players.length < 2 || room.roundResetAt || room.phase !== "playing") {
    return;
  }

  if (!["up", "down", "left", "right"].includes(direction)) {
    return;
  }

  expireEffects();
  if (isMovementLocked(player)) {
    return;
  }

  attemptMove(player.id, direction);
}

function attemptMove(playerId, rawDirection) {
  const player = getPlayer(playerId);
  if (!player || room.roundResetAt) {
    return;
  }

  expireEffects();
  if (isMovementLocked(player)) {
    return;
  }

  const direction = rawDirection;

  const moveInterval = MOVE_INTERVAL_MS;

  if (Date.now() - player.lastMoveAt < moveInterval) {
    return;
  }

  const nextPosition = getNextPosition(player.position, direction);
  if (!nextPosition || room.maze.grid[nextPosition.y]?.[nextPosition.x] !== 0) {
    return;
  }

  player.position = nextPosition;
  player.lastMoveAt = Date.now();
  maybeScore(player);
  sendState();
}

function handleSabotage(client, actionId, targetId) {
  const source = getPlayer(client.playerId);
  const effect = EFFECT_DEFS[actionId];

  if (!source || !effect || room.players.length < 2 || room.roundResetAt || room.phase !== "playing") {
    return;
  }

  expireEffects();

  if (Date.now() < getSharedCooldownRemaining(source)) {
    send(client.socket, { type: "error", message: `${effect.label} is nog niet opgeladen.` });
    return;
  }

  if (effect.scope === "world") {
    handleWorldAction(source, actionId);
    return;
  }

  const target = getPlayer(targetId);
  if (!target || target.id === source.id) {
    return;
  }

  if (Date.now() < target.immunityUntil) {
    send(client.socket, { type: "error", message: `${target.name} is kort immuun.` });
    return;
  }

  setSharedCooldowns(source, effect.cooldownMs);
  source.lastTargetId = target.id;
  source.lastTargetAt = Date.now();
  applyEffect(target, actionId);
  room.message = `${source.name} bevriest ${target.name}.`;
  sendState();
}

function handleWorldAction(source, actionId) {
  const effect = EFFECT_DEFS[actionId];

  if (Date.now() < room.worldActionLockUntil) {
    return;
  }

  setSharedCooldowns(source, effect.cooldownMs);
  room.worldActionLockUntil = Date.now() + Math.max(effect.durationMs, WORLD_ACTION_LOCK_BUFFER_MS);

  if (actionId === "swap") {
    room.players.forEach((player) => {
      if (player.id !== source.id) {
        applyEffect(player, "swap");
      }
    });
    room.message = `${source.name} draait de besturing van alle andere spelers om.`;
    sendState();
    return;
  }

  if (actionId === "maze") {
    room.maze = generateMaze(MAZE_WIDTH, MAZE_HEIGHT);
    room.players.forEach((player) => {
      player.position = { ...player.start };
      player.activeEffect = null;
      player.effectEndsAt = 0;
      player.moveLockedUntil = 0;
      player.immunityUntil = 0;
    });
    assignGoals();
    room.message = `${source.name} verschuift het doolhof en alle doelen.`;
    room.worldActionLockUntil = Date.now() + 2000;
    sendState();
  }
}

function applyEffect(player, effectId) {
  const definition = EFFECT_DEFS[effectId];
  player.activeEffect = {
    id: effectId,
    label: definition.label,
    icon: ICONS[effectId]
  };
  player.effectEndsAt = Date.now() + definition.durationMs;
  player.immunityUntil = Date.now() + definition.durationMs + EFFECT_IMMUNITY_MS;
  if (effectId === "freeze") {
    player.moveLockedUntil = player.effectEndsAt;
    player.lastMoveAt = player.effectEndsAt;
  }
}

function setSharedCooldowns(player, cooldownMs) {
  const nextReadyAt = Date.now() + cooldownMs;
  Object.keys(player.cooldowns).forEach((key) => {
    player.cooldowns[key] = nextReadyAt;
  });
}

function getSharedCooldownRemaining(player) {
  return Math.max(
    0,
    ...Object.values(player.cooldowns || {}).map((value) => value || 0)
  );
}

function expireEffects() {
  let changed = false;

  if (room.phase === "countdown" && room.countdownEndsAt && Date.now() >= room.countdownEndsAt) {
    room.phase = "playing";
    room.countdownEndsAt = 0;
    room.message = `Round ${room.round} is live. Race to 3 goals.`;
    changed = true;
  }

  room.players.forEach((player) => {
    if (player.activeEffect && Date.now() >= player.effectEndsAt) {
      player.activeEffect = null;
      player.effectEndsAt = 0;
      player.moveLockedUntil = 0;
      changed = true;
    }
  });

  if (room.roundResetAt && Date.now() >= room.roundResetAt) {
    startNextRound();
    changed = false;
  }

  if (changed) {
    sendState();
  }
}

function maybeScore(player) {
  if (!player.goal || player.position.x !== player.goal.x || player.position.y !== player.goal.y) {
    return;
  }

  player.score += 1;
  player.mazeScore += 1;
  player.activeEffect = null;
  player.effectEndsAt = 0;
  player.immunityUntil = 0;
  room.message = `${player.name} scoort en heeft nu ${player.score} punten.`;

  if (player.mazeScore >= WIN_SCORE) {
    room.winnerId = player.id;
    room.phase = "intermission";
    room.roundResetAt = Date.now() + MAZE_BREAK_MS;
    room.message = `${player.name} haalt 3 doelen. Nieuwe maze komt eraan.`;
    scheduleRoundReset();
    sendState();
    return;
  }

  assignGoals();
}

function startNextRound() {
  clearTimer("countdown");
  clearTimer("roundReset");
  room.round += 1;
  room.winnerId = null;
  room.roundResetAt = 0;
  room.phase = "playing";
  room.countdownEndsAt = 0;
  room.worldActionLockUntil = 0;
  room.maze = generateMaze(MAZE_WIDTH, MAZE_HEIGHT);
  room.players.forEach((player) => {
    player.position = { ...player.start };
    player.mazeScore = 0;
    player.goal = null;
    player.activeEffect = null;
    player.effectEndsAt = 0;
    player.immunityUntil = 0;
    player.moveLockedUntil = 0;
    player.cooldowns = {
      maze: Date.now() + ACTION_CHARGE_MS,
      swap: Date.now() + ACTION_CHARGE_MS,
      freeze: Date.now() + ACTION_CHARGE_MS
    };
    player.lastMoveAt = 0;
    player.lastTargetAt = 0;
    player.lastTargetId = null;
  });
  assignGoals();
  room.message = room.players.length >= 2
    ? `Nieuwe maze gestart. Ga door in ronde ${room.round}.`
    : "Waiting for players";
  sendState();
}

function assignGoals() {
  if (!room.maze.goalCandidates.length) {
    return;
  }

  const occupied = new Set(room.players.map((player) => `${player.position.x},${player.position.y}`));
  const goalCandidates = room.maze.goalCandidates.filter((candidate) => !occupied.has(`${candidate.x},${candidate.y}`));
  const shuffled = shuffle(goalCandidates.slice());

  room.players.forEach((player, index) => {
    const fallback = room.maze.goalCandidates[index % room.maze.goalCandidates.length];
    const goal = shuffled[index] || fallback;
    player.goal = { x: goal.x, y: goal.y };
  });
}

function sendState() {
  expireEffectsLight();

  const roomState = serializeRoom();
  clients.forEach((client) => {
    send(client.socket, {
      type: "state",
      room: roomState,
      dashboards: dashboardCount,
      selfPlayerId: client.playerId
    });
  });
}

function expireEffectsLight() {
  room.players.forEach((player) => {
    if (player.activeEffect && Date.now() >= player.effectEndsAt) {
      player.activeEffect = null;
      player.effectEndsAt = 0;
    }
  });
}

function serializeRoom() {
  return {
    roomCode: room.roomCode,
    maze: room.maze,
    round: room.round,
    phase: room.phase,
    message: room.message,
    winnerId: room.winnerId,
    countdownEndsAt: room.countdownEndsAt || 0,
    roundResetAt: room.roundResetAt || 0,
    worldActionLockRemainingMs: Math.max(0, (room.worldActionLockUntil || 0) - Date.now()),
    resetInMs: room.roundResetAt ? Math.max(0, room.roundResetAt - Date.now()) : 0,
    countdownInMs: room.countdownEndsAt ? Math.max(0, room.countdownEndsAt - Date.now()) : 0,
    minPlayersReady: room.players.length >= 2,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      colorId: player.colorId,
      colorHex: player.colorHex,
      position: player.position,
      score: player.score,
      mazeScore: player.mazeScore,
        cooldowns: {
          maze: Math.max(0, (player.cooldowns.maze || 0) - Date.now()),
          swap: Math.max(0, (player.cooldowns.swap || 0) - Date.now()),
          freeze: Math.max(0, (player.cooldowns.freeze || 0) - Date.now())
        },
      goal: player.goal,
      activeEffect: player.activeEffect,
      effectRemainingMs: player.effectEndsAt ? Math.max(0, player.effectEndsAt - Date.now()) : 0,
      immunityRemainingMs: player.immunityUntil ? Math.max(0, player.immunityUntil - Date.now()) : 0
    }))
  };
}

function send(socket, payload) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
  }
}

function scheduleCountdownStart() {
  clearTimer("countdown");

  countdownTimer = setTimeout(() => {
    countdownTimer = null;
    if (room.phase !== "countdown") {
      return;
    }

    room.phase = "playing";
    room.countdownEndsAt = 0;
    room.message = `Round ${room.round} is live. Race to 3 goals.`;
    sendState();
  }, START_COUNTDOWN_MS);
}

function scheduleRoundReset() {
  clearTimer("roundReset");

  roundResetTimer = setTimeout(() => {
    roundResetTimer = null;
    if (!room.roundResetAt) {
      return;
    }
    startNextRound();
  }, 2200);
}

function clearTimer(timerName) {
  if (timerName === "countdown" && countdownTimer) {
    clearTimeout(countdownTimer);
    countdownTimer = null;
  }

  if (timerName === "roundReset" && roundResetTimer) {
    clearTimeout(roundResetTimer);
    roundResetTimer = null;
  }
}

function generateMaze(width, height) {
  const grid = Array.from({ length: height }, () => Array(width).fill(1));
  const starts = [
    { x: 1, y: 1 },
    { x: width - 2, y: 1 },
    { x: 1, y: height - 2 },
    { x: width - 2, y: height - 2 }
  ];

  starts.forEach((start) => {
    grid[start.y][start.x] = 0;
  });

  carveFrom(grid, 1, 1);
  starts.forEach((start) => forceOpen(grid, start.x, start.y));

  return {
    width,
    height,
    grid,
    goalCandidates: buildGoalCandidates(grid, starts)
  };
}

function carveFrom(grid, startX, startY) {
  const stack = [{ x: startX, y: startY }];
  const directions = [
    { x: 2, y: 0 },
    { x: -2, y: 0 },
    { x: 0, y: 2 },
    { x: 0, y: -2 }
  ];

  while (stack.length) {
    const current = stack[stack.length - 1];
    const neighbors = shuffle(directions.slice()).filter((direction) => {
      const nx = current.x + direction.x;
      const ny = current.y + direction.y;
      return ny > 0 && ny < grid.length - 1 && nx > 0 && nx < grid[0].length - 1 && grid[ny][nx] === 1;
    });

    if (!neighbors.length) {
      stack.pop();
      continue;
    }

    const next = neighbors[0];
    const wallX = current.x + next.x / 2;
    const wallY = current.y + next.y / 2;
    const nx = current.x + next.x;
    const ny = current.y + next.y;

    grid[wallY][wallX] = 0;
    grid[ny][nx] = 0;
    stack.push({ x: nx, y: ny });
  }
}

function forceOpen(grid, x, y) {
  grid[y][x] = 0;

  const options = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 }
  ].filter((entry, index, items) => {
    const inBounds = entry.x > 0 && entry.x < grid[0].length - 1 && entry.y > 0 && entry.y < grid.length - 1;
    const firstIndex = items.findIndex((candidate) => candidate.x === entry.x && candidate.y === entry.y);
    return inBounds && firstIndex === index;
  });

  options.slice(0, 2).forEach((entry) => {
    grid[entry.y][entry.x] = 0;
  });
}

function buildGoalCandidates(grid, starts) {
  const startSet = new Set(starts.map((start) => `${start.x},${start.y}`));
  const candidates = [];

  for (let y = 1; y < grid.length - 1; y += 1) {
    for (let x = 1; x < grid[0].length - 1; x += 1) {
      if (grid[y][x] !== 0) {
        continue;
      }

      const openNeighbors = [
        grid[y - 1][x],
        grid[y + 1][x],
        grid[y][x - 1],
        grid[y][x + 1]
      ].filter((cell) => cell === 0).length;

      const farEnough = starts.every((start) => Math.abs(start.x - x) + Math.abs(start.y - y) >= 4);
      if (openNeighbors >= 1 && farEnough && !startSet.has(`${x},${y}`)) {
        candidates.push({ x, y });
      }
    }
  }

  const pool = candidates.length ? candidates : starts.map((start) => ({ ...start }));
  return shuffle(pool).slice(0, Math.min(6, Math.max(4, pool.length)));
}

function getNextPosition(position, direction) {
  if (direction === "up") {
    return { x: position.x, y: position.y - 1 };
  }
  if (direction === "down") {
    return { x: position.x, y: position.y + 1 };
  }
  if (direction === "left") {
    return { x: position.x - 1, y: position.y };
  }
  if (direction === "right") {
    return { x: position.x + 1, y: position.y };
  }
  return null;
}

function getPlayer(playerId) {
  return room.players.find((player) => player.id === playerId);
}

function isMovementLocked(player) {
  return Boolean(player) && (
    (player.activeEffect?.id === "freeze" && Date.now() < player.effectEndsAt) ||
    Date.now() < (player.moveLockedUntil || 0)
  );
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
