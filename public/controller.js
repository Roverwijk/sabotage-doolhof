const ACTIONS = {
  maze: { id: "maze", label: "Shuffle", subtitle: "Maze + doelen", type: "world" },
  gates: { id: "gates", label: "Open Gates", subtitle: "Poorten 10s open", type: "world" },
  freeze: { id: "freeze", label: "Freeze", subtitle: "Bevries speler", type: "personal" }
};

const state = {
  room: null,
  selfPlayerId: null,
  joined: false,
  roomSyncedAt: 0
};

const elements = {
  joinForm: document.getElementById("join-form"),
  playerName: document.getElementById("player-name"),
  joinButton: document.getElementById("join-button"),
  statusMessage: document.getElementById("status-message"),
  countdownOverlay: document.getElementById("countdown-overlay"),
  countdownOverlayLabel: document.getElementById("countdown-overlay-label"),
  countdownOverlayNumber: document.getElementById("countdown-overlay-number"),
  countdownOverlayCopy: document.getElementById("countdown-overlay-copy"),
  playerNameLabel: document.getElementById("player-name-label"),
  scorePill: document.getElementById("score-pill"),
  mazeScorePill: document.getElementById("maze-score-pill"),
  playerState: document.getElementById("player-state"),
  controllerHelper: document.getElementById("controller-helper"),
  actionFeedback: document.getElementById("action-feedback"),
  padPhasePill: document.getElementById("pad-phase-pill"),
  moveButtons: {
    up: document.querySelector('[data-direction="up"] .pad-title'),
    left: document.querySelector('[data-direction="left"] .pad-title'),
    down: document.querySelector('[data-direction="down"] .pad-title'),
    right: document.querySelector('[data-direction="right"] .pad-title')
  },
  mazeAction: document.getElementById("maze-action"),
  gatesAction: document.getElementById("gates-action"),
  freezeActions: [
    document.getElementById("freeze-action-0"),
    document.getElementById("freeze-action-1"),
    document.getElementById("freeze-action-2")
  ]
};

const socketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${socketProtocol}//${window.location.host}`);
const activeInputs = new Map();
let overlayIntervalId = 0;
let actionPadIntervalId = 0;

wireJoinForm();
wireControls();
wireActionButtons();
wireKeyboard();
render();

socket.addEventListener("open", () => {
  elements.statusMessage.textContent = "Controller verbonden. Vul je naam in.";
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);

  if (message.type === "error") {
    if (!state.selfPlayerId) {
      state.joined = false;
    }
    elements.statusMessage.textContent = message.message;
    render();
    return;
  }

  if (message.type === "state") {
    state.room = {
      ...message.room,
      dashboards: message.dashboards
    };
    state.roomSyncedAt = Date.now();
    state.selfPlayerId = message.selfPlayerId || null;
    render();
  }
});

socket.addEventListener("close", () => {
  elements.statusMessage.textContent = "Verbinding verbroken. Ververs de pagina.";
});

function wireJoinForm() {
  elements.joinForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (socket.readyState !== WebSocket.OPEN || state.joined) {
      return;
    }

    socket.send(JSON.stringify({
      type: "join-player",
      name: elements.playerName.value.trim()
    }));
    state.joined = true;
    elements.statusMessage.textContent = "Bezig met joinen...";
    render();
  });
}

function wireControls() {
  document.querySelectorAll("[data-direction]").forEach((button) => {
    const direction = button.dataset.direction;
    const start = (event) => {
      event.preventDefault();
      startRepeatingInput(direction);
    };
    const stop = (event) => {
      event.preventDefault();
      stopRepeatingInput(direction);
    };

    button.addEventListener("pointerdown", start);
    button.addEventListener("pointerup", stop);
    button.addEventListener("pointerleave", stop);
    button.addEventListener("pointercancel", stop);
  });
}

function wireKeyboard() {
  const bindings = {
    ArrowUp: "up",
    KeyW: "up",
    ArrowDown: "down",
    KeyS: "down",
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right"
  };

  window.addEventListener("keydown", (event) => {
    if (isTypingTarget(event.target)) {
      return;
    }

    const direction = bindings[event.code];
    if (!direction || event.repeat) {
      return;
    }

    event.preventDefault();
    startRepeatingInput(direction);
  });

  window.addEventListener("keyup", (event) => {
    if (isTypingTarget(event.target)) {
      return;
    }

    const direction = bindings[event.code];
    if (direction) {
      stopRepeatingInput(direction);
    }
  });
}

function startRepeatingInput(direction) {
  sendInput(direction);

  if (activeInputs.has(direction)) {
    return;
  }

  const intervalId = window.setInterval(() => sendInput(direction), 110);
  activeInputs.set(direction, intervalId);
}

function stopRepeatingInput(direction) {
  const intervalId = activeInputs.get(direction);
  if (intervalId) {
    window.clearInterval(intervalId);
    activeInputs.delete(direction);
  }
}

function sendInput(direction) {
  if (!state.joined || !state.selfPlayerId || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({
    type: "input",
    direction
  }));
}

function render() {
  const room = state.room;
  elements.joinButton.disabled = state.joined;

  if (!room) {
    elements.countdownOverlay.classList.add("hidden");
    elements.playerNameLabel.textContent = "Nog niet in de lobby";
    elements.scorePill.textContent = "0 totaal";
    elements.mazeScorePill.textContent = "0/3 maze";
    elements.padPhasePill.textContent = "Lobby";
    elements.actionFeedback.textContent = "Sabotage laadt automatisch op.";
    resetPadButtons();
    stopActionPadTicker();
    return;
  }

  renderCountdownOverlay(room);

  const self = room.players.find((player) => player.id === state.selfPlayerId);
  if (!self) {
    elements.playerNameLabel.textContent = "Nog niet in de lobby";
    elements.playerState.textContent = "Vul je naam in en doe mee.";
    elements.scorePill.textContent = "0 totaal";
    elements.mazeScorePill.textContent = "0/3 maze";
    elements.mazeScorePill.classList.remove("is-active");
    elements.padPhasePill.textContent = "Lobby";
    elements.actionFeedback.textContent = "Sabotage verschijnt zodra je in de lobby zit.";
    resetPadButtons();
    stopActionPadTicker();
    return;
  }

  elements.playerNameLabel.textContent = self.name;
  elements.scorePill.textContent = `${self.score} totaal`;
  elements.mazeScorePill.textContent = `${self.mazeScore}/3 maze`;
  elements.mazeScorePill.classList.toggle("is-active", self.mazeScore > 0);
  elements.padPhasePill.textContent = room.phase === "playing"
    ? "Actief"
    : room.phase === "countdown"
      ? "Start"
      : room.phase === "intermission"
        ? "Pauze"
        : "Lobby";
  elements.padPhasePill.classList.toggle("is-active", room.phase === "playing");

  if (self.activeEffect) {
    elements.playerState.textContent = `${self.activeEffect.label} actief voor ${Math.ceil(self.effectRemainingMs / 1000)}s.`;
  } else if (room.phase === "playing") {
    elements.playerState.textContent = `${self.mazeScore}/3 doelen in deze maze.`;
  } else if (room.phase === "intermission") {
    elements.playerState.textContent = "Even wachten. De nieuwe maze komt eraan.";
  } else {
    elements.playerState.textContent = "Wacht tot de laptop de ronde start.";
  }

  elements.controllerHelper.textContent = room.phase === "playing"
    ? "Houd een knop ingedrukt om te blijven bewegen."
    : "Besturing wordt actief zodra de ronde start.";

  renderActionPad(room, self);
  startActionPadTicker();
}

function renderCountdownOverlay(room) {
  const hasStartCountdown = room.phase === "countdown" && room.countdownInMs > 0;
  const hasMazeCountdown = room.phase === "intermission" && room.resetInMs > 0;
  const visible = hasStartCountdown || hasMazeCountdown;

  elements.countdownOverlay.classList.toggle("hidden", !visible);
  if (!visible) {
    window.clearInterval(overlayIntervalId);
    return;
  }

  if (hasStartCountdown) {
    elements.countdownOverlayLabel.textContent = "Start";
    elements.countdownOverlayCopy.textContent = "De ronde begint zo.";
  } else {
    elements.countdownOverlayLabel.textContent = "Nieuwe maze";
    elements.countdownOverlayCopy.textContent = "Even pauze. De volgende maze komt eraan.";
  }

  const renderOverlayTick = () => {
    const remainingMs = state.room
      ? state.room.phase === "countdown"
        ? Math.max(0, (state.room.countdownEndsAt || 0) - Date.now())
        : Math.max(0, (state.room.roundResetAt || 0) - Date.now())
      : 0;
    const seconds = Math.max(1, Math.ceil((remainingMs || 0) / 1000));
    elements.countdownOverlayNumber.textContent = String(seconds);
  };

  window.clearInterval(overlayIntervalId);
  renderOverlayTick();
  overlayIntervalId = window.setInterval(() => {
    if (!state.room) {
      window.clearInterval(overlayIntervalId);
      return;
    }
    renderOverlayTick();
  }, 250);
}

function wireActionButtons() {
  [elements.mazeAction, elements.gatesAction, ...elements.freezeActions].forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (socket.readyState !== WebSocket.OPEN || button.disabled) {
        return;
      }

      socket.send(JSON.stringify({
        type: "sabotage",
        actionId: button.dataset.actionId,
        targetId: button.dataset.targetId || null
      }));
    });
  });
}

function renderActionPad(room, self) {
  const targets = room.players.filter((player) => player.id !== self.id);
  const isPlaying = room.phase === "playing";

  renderWorldActionButton(elements.mazeAction, ACTIONS.maze, self, room, isPlaying);
  renderWorldActionButton(elements.gatesAction, ACTIONS.gates, self, room, isPlaying);

  elements.freezeActions.forEach((button, index) => {
    const target = targets[index];
    if (!target) {
      button.disabled = true;
      button.dataset.targetId = "";
      button.classList.remove("is-ready", "is-cooling");
      button.classList.add("is-blocked");
      button.style.borderColor = "";
      button.style.boxShadow = "none";
      button.style.background = "";
      button.style.color = "";
      button.querySelector(".pad-title").textContent = "Freeze";
      button.querySelector(".pad-subtitle").textContent = `Wacht op speler ${index + 1}`;
      return;
    }

    button.dataset.targetId = target.id;

    const cooldownMs = getLiveRemainingMs(self.cooldowns?.freeze || 0);
    const immuneMs = getLiveRemainingMs(target.immunityRemainingMs || 0);
    const ready = isPlaying && cooldownMs <= 0 && immuneMs <= 0;
    const title = button.querySelector(".pad-title");
    const subtitle = button.querySelector(".pad-subtitle");
    title.textContent = "Freeze";
    subtitle.textContent = immuneMs > 0
      ? `${target.name} immuun ${Math.ceil(immuneMs / 1000)}s`
      : target.name;

    button.disabled = !ready;
    button.classList.toggle("is-ready", ready);
    button.classList.toggle("is-cooling", cooldownMs > 0);
    button.classList.toggle("is-blocked", !isPlaying || immuneMs > 0);
    button.style.borderColor = target.colorHex;
    button.style.background = ready ? target.colorHex : `${target.colorHex}22`;
    button.style.color = ready ? "#ffffff" : target.colorHex;
    button.style.boxShadow = ready ? `0 10px 24px ${hexToShadow(target.colorHex)}` : "none";

    if (cooldownMs > 0) {
      elements.actionFeedback.textContent = `Freeze klaar over ${Math.ceil(cooldownMs / 1000)}s.`;
    } else if (!isPlaying) {
      elements.actionFeedback.textContent = "Sabotage wordt actief zodra de ronde start.";
    }
  });

  if (!targets.length) {
    elements.actionFeedback.textContent = "Wacht op minstens 1 tegenstander voor freeze.";
  } else if (isPlaying) {
    const worldLock = getLiveRemainingMs(room.worldActionLockRemainingMs || 0) > 0;
    if (worldLock) {
      elements.actionFeedback.textContent = `Wereldactie bezet voor ${Math.ceil(getLiveRemainingMs(room.worldActionLockRemainingMs || 0) / 1000)}s.`;
    } else if (getLiveRemainingMs(self.cooldowns?.maze || 0) <= 0 && getLiveRemainingMs(self.cooldowns?.gates || 0) <= 0 && getLiveRemainingMs(self.cooldowns?.freeze || 0) <= 0) {
      elements.actionFeedback.textContent = "Alle acties zijn klaar om te gebruiken.";
    }
  }
}

function renderWorldActionButton(button, action, self, room, isPlaying) {
  const cooldownMs = getLiveRemainingMs(self.cooldowns?.[action.id] || 0);
  const worldLocked = getLiveRemainingMs(room.worldActionLockRemainingMs || 0) > 0;
  const ready = isPlaying && cooldownMs <= 0 && !worldLocked;
  const title = button.querySelector(".pad-title");
  const subtitle = button.querySelector(".pad-subtitle");

  title.textContent = action.label;
  subtitle.textContent = ready
    ? action.subtitle
      : worldLocked
      ? `Bezet ${Math.ceil(getLiveRemainingMs(room.worldActionLockRemainingMs || 0) / 1000)}s`
      : cooldownMs > 0
        ? `Klaar over ${Math.ceil(cooldownMs / 1000)}s`
        : action.subtitle;

  button.disabled = !ready;
  button.classList.toggle("is-ready", ready);
  button.classList.toggle("is-cooling", cooldownMs > 0);
  button.classList.toggle("is-blocked", !isPlaying || worldLocked);
}

function resetPadButtons() {
  renderWorldActionButtonSkeleton(elements.mazeAction, ACTIONS.maze);
  renderWorldActionButtonSkeleton(elements.gatesAction, ACTIONS.gates);
  elements.freezeActions.forEach((button, index) => {
    button.disabled = true;
    button.dataset.targetId = "";
    button.classList.remove("is-ready", "is-cooling");
    button.classList.add("is-blocked");
    button.style.borderColor = "";
    button.style.boxShadow = "none";
    button.style.background = "";
    button.style.color = "";
    button.querySelector(".pad-title").textContent = "Freeze";
    button.querySelector(".pad-subtitle").textContent = `Wacht op speler ${index + 1}`;
  });
}

function startActionPadTicker() {
  if (actionPadIntervalId) {
    return;
  }

  actionPadIntervalId = window.setInterval(() => {
    if (!state.room || !state.selfPlayerId) {
      stopActionPadTicker();
      return;
    }

    const self = state.room.players.find((player) => player.id === state.selfPlayerId);
    if (!self) {
      stopActionPadTicker();
      return;
    }

    renderActionPad(state.room, self);
  }, 250);
}

function stopActionPadTicker() {
  if (!actionPadIntervalId) {
    return;
  }

  window.clearInterval(actionPadIntervalId);
  actionPadIntervalId = 0;
}

function getLiveRemainingMs(baseRemainingMs) {
  if (!baseRemainingMs || !state.roomSyncedAt) {
    return 0;
  }

  return Math.max(0, baseRemainingMs - (Date.now() - state.roomSyncedAt));
}

function renderWorldActionButtonSkeleton(button, action) {
  button.disabled = true;
  button.classList.remove("is-ready", "is-cooling", "is-blocked");
  button.querySelector(".pad-title").textContent = action.label;
  button.querySelector(".pad-subtitle").textContent = action.subtitle;
}

function hexToShadow(hex) {
  if (!hex || !hex.startsWith("#") || (hex.length !== 7 && hex.length !== 4)) {
    return "rgba(0, 0, 0, 0.12)";
  }

  const normalized = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const red = parseInt(normalized.slice(1, 3), 16);
  const green = parseInt(normalized.slice(3, 5), 16);
  const blue = parseInt(normalized.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, 0.24)`;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isTypingTarget(target) {
  if (!target) {
    return false;
  }

  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target.isContentEditable;
}
