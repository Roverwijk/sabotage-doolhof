const ACTIONS = [
  { id: "slow", label: "Slow", cost: 1, description: "Tegenstander beweegt 4 seconden ongeveer half zo snel." },
  { id: "swap", label: "Besturing om", cost: 1, description: "Links en rechts zijn 3 seconden omgedraaid." },
  { id: "shuffle", label: "Doel verplaatsen", cost: 2, description: "Het doel van de tegenstander springt naar een andere plek in het doolhof." },
  { id: "freeze", label: "Bevriezen", cost: 2, description: "Tegenstander kan 3 seconden niet bewegen." }
];

const state = {
  room: null,
  selfPlayerId: null,
  mode: window.location.pathname === "/controller" ? "controller" : "dashboard",
  joined: false
};

const elements = {
  joinForm: document.getElementById("join-form"),
  playerName: document.getElementById("player-name"),
  joinButton: document.getElementById("join-button"),
  joinHelper: document.getElementById("join-helper"),
  modeEyebrow: document.getElementById("mode-eyebrow"),
  modeTitle: document.getElementById("mode-title"),
  controllerQrImage: document.getElementById("controller-qr-image"),
  roomCode: document.getElementById("room-code"),
  roundLabel: document.getElementById("round-label"),
  dashboardCount: document.getElementById("dashboard-count"),
  statusMessage: document.getElementById("status-message"),
  countdownLabel: document.getElementById("countdown-label"),
  countdownOverlay: document.getElementById("countdown-overlay"),
  countdownOverlayLabel: document.getElementById("countdown-overlay-label"),
  countdownOverlayNumber: document.getElementById("countdown-overlay-number"),
  countdownOverlayCopy: document.getElementById("countdown-overlay-copy"),
  lobbyBanner: document.getElementById("lobby-banner"),
  lobbyTitle: document.getElementById("lobby-title"),
  lobbyCopy: document.getElementById("lobby-copy"),
  lobbyPlayersCard: document.getElementById("lobby-players-card"),
  lobbyPlayersList: document.getElementById("lobby-players-list"),
  startGameButton: document.getElementById("start-game-button"),
  stopGameButton: document.getElementById("stop-game-button"),
  arenaWrap: document.querySelector(".arena-wrap"),
  mazeBoard: document.getElementById("maze-board"),
  selfCardTitle: document.getElementById("self-card-title"),
  selfSummary: document.getElementById("self-summary"),
  controllerScorePill: document.getElementById("controller-score-pill"),
  controllerHelper: document.getElementById("controller-helper"),
  pointsPill: document.getElementById("points-pill"),
  sabotageList: document.getElementById("sabotage-list"),
  scoreboard: document.getElementById("scoreboard"),
  controlsCard: document.getElementById("controls-card"),
  sabotageCard: document.getElementById("sabotage-card"),
  scoreTemplate: document.getElementById("score-template")
};

const socketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${socketProtocol}//${window.location.host}`);
const activeInputs = new Map();
let countdownIntervalId = 0;
let overlayIntervalId = 0;

cleanupOldServiceWorkers();
wireJoinForm();
wireControls();
wireKeyboard();
wireStartButton();
wireStopButton();
configureMode();
render();

socket.addEventListener("open", () => {
  if (state.mode === "dashboard") {
    socket.send(JSON.stringify({ type: "join-dashboard" }));
    state.joined = true;
  }
  elements.statusMessage.textContent = state.mode === "dashboard"
    ? "Dashboard verbonden."
    : "Controller verbonden. Vul je naam in.";
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);

  if (message.type === "error") {
    if (state.mode === "controller" && !state.selfPlayerId) {
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
    state.selfPlayerId = message.selfPlayerId || null;
    render();
  }
});

socket.addEventListener("close", () => {
  elements.statusMessage.textContent = "Connection lost. Refresh to reconnect.";
});

function configureMode() {
  document.body.classList.toggle("dashboard-mode", state.mode === "dashboard");
  document.body.classList.toggle("controller-mode", state.mode === "controller");
  const controllerUrl = `${window.location.origin}/controller`;
  if (elements.controllerQrImage) {
    elements.controllerQrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(controllerUrl)}`;
  }

  if (state.mode === "dashboard") {
    elements.modeEyebrow.textContent = "Dashboard";
    elements.modeTitle.textContent = "Gedeeld speelscherm";
    elements.selfCardTitle.textContent = "Dashboard";
    elements.joinButton.textContent = "Meedoen";
  } else {
    elements.modeEyebrow.textContent = "Controller";
    elements.modeTitle.textContent = "Telefoonbediening";
    elements.selfCardTitle.textContent = "Jouw speler";
    elements.joinButton.textContent = "Naar lobby";
  }
}

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
    const start = () => startRepeatingInput(direction);
    const stop = () => stopRepeatingInput(direction);

    button.addEventListener("pointerdown", start);
    button.addEventListener("pointerup", stop);
    button.addEventListener("pointerleave", stop);
    button.addEventListener("pointercancel", stop);
    button.addEventListener("click", () => sendInput(direction));
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

function wireStartButton() {
  elements.startGameButton.addEventListener("click", () => {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify({ type: "start-game" }));
  });
}

function wireStopButton() {
  elements.stopGameButton.addEventListener("click", () => {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify({ type: "stop-game" }));
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
  if (!state.joined || state.mode !== "controller" || !state.selfPlayerId || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({ type: "input", direction }));
}

function render() {
  const room = state.room;

  elements.joinButton.disabled = state.joined && state.mode === "controller";
  elements.controlsCard.classList.toggle("hidden", state.mode !== "controller");
  elements.sabotageCard.classList.toggle("hidden", state.mode !== "controller");
  elements.joinForm.classList.toggle("hidden", state.mode !== "controller");

  if (!room) {
    elements.scoreboard.innerHTML = "";
    elements.sabotageList.innerHTML = "";
    elements.controllerScorePill.textContent = "0/3";
    elements.selfSummary.innerHTML = "<strong>Spelstatus laden</strong><span>Even wachten tot de server de kamerstatus heeft gestuurd.</span>";
    return;
  }

  elements.roomCode.textContent = room.roomCode;
  elements.roundLabel.textContent = String(room.round);
  elements.dashboardCount.textContent = String(room.dashboards || 0);
  elements.statusMessage.textContent = room.message;
  renderCountdown(room);
  renderCountdownOverlay(room);
  renderLobby(room);
  renderLobbyPlayers(room);
  renderBoard(room);
  renderScoreboard(room);
  renderSelf(room);
  renderSabotage(room);
}

function renderCountdown(room) {
  window.clearInterval(countdownIntervalId);

  if (!room.countdownEndsAt && !room.roundResetAt) {
    elements.countdownLabel.textContent = "";
    return;
  }

  const renderTick = () => {
    if (state.room?.phase === "countdown" && state.room?.countdownEndsAt) {
      const seconds = Math.max(0, Math.ceil((state.room.countdownEndsAt - Date.now()) / 1000));
      elements.countdownLabel.textContent = seconds ? `Start over ${seconds}s` : "";
      return;
    }

    const seconds = Math.max(0, Math.ceil(((state.room?.roundResetAt || 0) - Date.now()) / 1000));
    elements.countdownLabel.textContent = seconds ? `Nieuwe maze over ${seconds}s` : "";
  };

  renderTick();
  countdownIntervalId = window.setInterval(() => {
    if (!state.room) {
      window.clearInterval(countdownIntervalId);
      return;
    }
    renderTick();
  }, 250);
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

function renderLobby(room) {
  const isLobbyVisible = room.phase !== "playing";
  elements.lobbyBanner.classList.toggle("hidden", !isLobbyVisible || state.mode !== "dashboard");
  elements.arenaWrap.classList.toggle("is-hidden", isLobbyVisible || state.mode !== "dashboard");

  if (!isLobbyVisible) {
    return;
  }

  if (room.phase === "intermission") {
    elements.lobbyTitle.textContent = "Nieuwe maze komt eraan";
    elements.lobbyCopy.textContent = "Even pauze. Na het aftellen verschijnt automatisch een nieuwe maze.";
  } else if (room.phase === "countdown") {
    elements.lobbyTitle.textContent = "Ronde start bijna";
    elements.lobbyCopy.textContent = "Na het aftellen verschijnt het doolhof op het laptopscherm.";
  } else if (room.minPlayersReady) {
    elements.lobbyTitle.textContent = "Klaar om te starten";
    elements.lobbyCopy.textContent = "De spelers zijn binnen. Start de ronde op de laptop.";
  } else {
    elements.lobbyTitle.textContent = "Wachten op spelers";
    elements.lobbyCopy.textContent = "Minimaal 2 spelers moeten meedoen voordat je kunt starten.";
  }

  const canStart = state.mode === "dashboard" && room.phase === "lobby" && room.minPlayersReady;
  const canStop = state.mode === "dashboard" && room.phase !== "lobby";
  elements.startGameButton.classList.toggle("hidden", !canStart);
  elements.stopGameButton.classList.toggle("hidden", !canStop);
}

function renderLobbyPlayers(room) {
  const isLobbyVisible = room.phase !== "playing";
  elements.lobbyPlayersCard.classList.toggle("hidden", !isLobbyVisible || state.mode !== "dashboard");

  if (!isLobbyVisible || state.mode !== "dashboard") {
    return;
  }

  elements.lobbyPlayersList.innerHTML = "";

  if (!room.players.length) {
    elements.lobbyPlayersList.innerHTML = "<p class='helper-copy'>Er heeft nog niemand meegedaan.</p>";
    return;
  }

  room.players.forEach((player) => {
    const row = document.createElement("article");
    row.className = "score-row";
    if (player.id === state.selfPlayerId) {
      row.classList.add("is-self");
    }

    row.innerHTML = `
      <div class="score-identity">
        <span class="score-color" style="background:${player.colorHex}"></span>
        <div>
          <strong class="score-name">${player.name}</strong>
          <p class="score-meta">${capitalize(player.colorId)} speler</p>
        </div>
      </div>
      <div class="score-values">
        <span class="score-goals">Klaar</span>
      </div>
    `;

    elements.lobbyPlayersList.append(row);
  });
}

function renderBoard(room) {
  const playersByCell = new Map(room.players.map((player) => [`${player.position.x},${player.position.y}`, player]));
  const goalsByCell = new Map(room.players.map((player) => [`${player.goal.x},${player.goal.y}`, player]));
  const { grid } = room.maze;

  elements.mazeBoard.innerHTML = "";
  elements.mazeBoard.style.gridTemplateColumns = `repeat(${grid[0].length}, var(--cell-size))`;
  grid.forEach((row, y) => {
    row.forEach((cell, x) => {
      const cellElement = document.createElement("div");
      cellElement.className = `maze-cell ${cell === 1 ? "wall" : "path"}`;

      const goalOwner = goalsByCell.get(`${x},${y}`);
      if (goalOwner) {
        const goal = document.createElement("div");
        goal.className = "goal-marker";
        goal.style.color = goalOwner.colorHex;
        goal.title = `${goalOwner.name} goal`;
        cellElement.append(goal);
      }

      const player = playersByCell.get(`${x},${y}`);
      if (player) {
        const dot = document.createElement("div");
        dot.className = "player-dot";
        if (player.activeEffect?.id === "freeze") {
          dot.classList.add("is-frozen");
        }
        dot.style.background = player.colorHex;
        dot.title = player.name;
        cellElement.append(dot);

        if (player.activeEffect?.id === "swap") {
          const indicator = document.createElement("div");
          indicator.className = "inverse-indicator";
          indicator.textContent = "↔";
          indicator.style.background = player.colorHex;
          indicator.style.color = getReadableTextColor(player.colorHex);
          indicator.title = `${player.activeEffect.label} (${Math.ceil(player.effectRemainingMs / 1000)}s)`;
          cellElement.append(indicator);
        } else if (player.activeEffect && player.activeEffect.id !== "freeze") {
          const badge = document.createElement("div");
          badge.className = "effect-badge";
          badge.textContent = player.activeEffect.icon;
          badge.title = `${player.activeEffect.label} (${Math.ceil(player.effectRemainingMs / 1000)}s)`;
          cellElement.append(badge);
        }
      }

      elements.mazeBoard.append(cellElement);
    });
  });
}

function renderScoreboard(room) {
  elements.scoreboard.innerHTML = "";

  room.players
    .slice()
    .sort((left, right) => right.score - left.score)
    .forEach((player) => {
      const fragment = elements.scoreTemplate.content.cloneNode(true);
      const row = fragment.querySelector(".score-row");
      fragment.querySelector(".score-color").style.background = player.colorHex;
      fragment.querySelector(".score-name").textContent = player.name;
      fragment.querySelector(".score-meta").textContent = `${player.score} punten`;
      fragment.querySelector(".score-goals").textContent = `${player.score} totaal • ${player.mazeScore}/3 deze maze`;
      fragment.querySelector(".score-effect").textContent = player.activeEffect
        ? `${player.activeEffect.label} ${Math.ceil(player.effectRemainingMs / 1000)}s`
        : player.immunityRemainingMs > 0
          ? `Immuun ${Math.ceil(player.immunityRemainingMs / 1000)}s`
          : "Geen effect";

      if (player.id === state.selfPlayerId) {
        row.classList.add("is-self");
      }

      elements.scoreboard.append(fragment);
    });
}

function renderSelf(room) {
  if (state.mode === "dashboard") {
    elements.selfSummary.innerHTML = "<strong>Gedeeld scherm</strong><span>Start hier de ronde en gebruik dit scherm als spelbord.</span>";
    elements.pointsPill.textContent = "--";
    elements.pointsPill.classList.remove("is-active");
    elements.controllerScorePill.textContent = "--";
    return;
  }

  const self = room.players.find((player) => player.id === state.selfPlayerId);
  if (!self) {
    elements.selfSummary.innerHTML = "<strong>Nog niet in de lobby</strong><span>Vul je naam in en doe mee.</span>";
    elements.pointsPill.textContent = "0 punten";
    elements.pointsPill.classList.remove("is-active");
    elements.controllerScorePill.textContent = "0/3";
    elements.controllerHelper.textContent = "Vul je naam in en ga de lobby in.";
    return;
  }

  elements.selfSummary.innerHTML = `
    <strong style="color:${self.colorHex}">${self.name}</strong>
    <span>${capitalize(self.colorId)} speler</span>
    <span>${self.score} totaal • ${self.mazeScore}/3 in deze maze</span>
    <span>${self.activeEffect ? `${self.activeEffect.label} ${Math.ceil(self.effectRemainingMs / 1000)}s` : room.phase === "playing" ? "Gebruik de pijlen om te bewegen." : room.phase === "intermission" ? "Nieuwe maze komt eraan." : "Wachten op start."}</span>
  `;
  elements.pointsPill.textContent = `${self.score} punten`;
  elements.pointsPill.classList.toggle("is-active", self.score > 0);
  elements.controllerScorePill.textContent = `${self.score}`;
  elements.controllerHelper.textContent = room.phase === "playing"
    ? "Houd een knop vast om door te bewegen."
    : room.phase === "intermission"
      ? "Even wachten. De nieuwe maze start automatisch."
    : "Wacht tot de laptop de ronde start.";
}

function renderSabotage(room) {
  elements.sabotageList.innerHTML = "";

  if (state.mode !== "controller") {
    return;
  }

  const self = room.players.find((player) => player.id === state.selfPlayerId);
  if (!self) {
    elements.sabotageList.innerHTML = "<p class='helper-copy'>Sabotage wordt zichtbaar zodra je in de lobby zit.</p>";
    return;
  }

  const targets = room.players.filter((player) => player.id !== self.id);
  if (!targets.length) {
    elements.sabotageList.innerHTML = "<p class='helper-copy'>Je hebt minimaal 1 tegenstander nodig.</p>";
    return;
  }

  if (room.phase !== "playing") {
    elements.sabotageList.innerHTML = "<p class='helper-copy'>Sabotage wordt actief zodra de ronde is gestart.</p>";
    return;
  }

  ACTIONS.forEach((action) => {
    const row = document.createElement("div");
    row.className = "sabotage-row";

    const selectId = `target-${action.id}`;
    const title = getActionPrompt(action.label);

    row.innerHTML = `
      <div class="sabotage-row-head">
        <strong>${title}</strong>
        <span class="sabotage-cost">${action.cost} punt${action.cost > 1 ? "en" : ""}</span>
      </div>
      <p class="sabotage-description">${action.description}</p>
      <label for="${selectId}">
        Kies speler
        <select id="${selectId}"></select>
      </label>
    `;

    const select = row.querySelector("select");
    targets.forEach((target) => {
      const option = document.createElement("option");
      option.value = target.id;
      option.textContent = `${capitalize(target.colorId)} - ${target.name}`;
      select.append(option);
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "sabotage-button";
    button.textContent = title;

    const updateButtonState = () => {
      const selectedTarget = targets.find((target) => target.id === select.value) || targets[0];
      const immune = selectedTarget?.immunityRemainingMs > 0;
      const hasEnoughPoints = self.score >= action.cost;
      const disabled = !selectedTarget || !hasEnoughPoints || !room.minPlayersReady || immune;

      button.disabled = disabled;
      button.classList.toggle("is-ready", hasEnoughPoints && !immune);
      button.classList.toggle("disabled", disabled);
      button.textContent = immune
        ? `${title} (${Math.ceil(selectedTarget.immunityRemainingMs / 1000)}s immuun)`
        : title;
    };

    select.addEventListener("change", updateButtonState);
    button.addEventListener("click", () => {
      socket.send(JSON.stringify({
        type: "sabotage",
        actionId: action.id,
        targetId: select.value
      }));
    });

    row.append(button);
    elements.sabotageList.append(row);
    updateButtonState();
  });
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getReadableTextColor(hex) {
  if (!hex || !hex.startsWith("#")) {
    return "#ffffff";
  }

  const normalized = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const red = parseInt(normalized.slice(1, 3), 16);
  const green = parseInt(normalized.slice(3, 5), 16);
  const blue = parseInt(normalized.slice(5, 7), 16);
  const luminance = (0.299 * red) + (0.587 * green) + (0.114 * blue);
  return luminance > 170 ? "#1f1f1a" : "#ffffff";
}

function getActionPrompt(actionLabel) {
  if (actionLabel === "Slow") {
    return "Vertraag speler";
  }
  if (actionLabel === "Besturing om") {
    return "Draai besturing om speler";
  }
  if (actionLabel === "Doel verplaatsen") {
    return "Verplaats doel speler";
  }
  if (actionLabel === "Bevriezen") {
    return "Bevries speler";
  }
  return actionLabel;
}

function isTypingTarget(target) {
  if (!target) {
    return false;
  }

  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || target.isContentEditable;
}

function cleanupOldServiceWorkers() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      registration.unregister();
    });
  }).catch(() => {
    // Ignore cleanup failures and continue loading the app.
  });
}
