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
  joined: false,
  previousRoom: null
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
  countdownOverlayScores: document.getElementById("countdown-overlay-scores"),
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
let audioContext = null;
let audioUnlocked = false;
let overlayLastSecond = null;

cleanupOldServiceWorkers();
wireJoinForm();
wireControls();
wireKeyboard();
wireStartButton();
wireStopButton();
wireAudioUnlock();
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
    const previousRoom = state.room;
    state.room = {
      ...message.room,
      dashboards: message.dashboards
    };
    state.previousRoom = previousRoom;
    state.selfPlayerId = message.selfPlayerId || null;
    handleRoomSounds(previousRoom, state.room);
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

function wireAudioUnlock() {
  const unlock = () => {
    if (state.mode !== "dashboard") {
      return;
    }

    const context = getAudioContext();
    if (!context) {
      return;
    }

    if (context.state === "suspended") {
      context.resume().catch(() => {});
    }
    audioUnlocked = true;
  };

  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
    window.addEventListener(eventName, unlock, { passive: true });
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
  renderScoreboardV2(room);
  renderSelfV2(room);
  renderSabotage(room);
}

function renderCountdown(room) {
  window.clearInterval(countdownIntervalId);

  if ((!room.countdownEndsAt && !room.roundResetAt) || room.phase === "gameover") {
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
  const hasWinnerOverlay = room.phase === "gameover" && room.winnerId;
  const visible = hasStartCountdown || hasMazeCountdown || hasWinnerOverlay;

  elements.countdownOverlay.classList.toggle("hidden", !visible);
  if (!visible) {
    window.clearInterval(overlayIntervalId);
    overlayLastSecond = null;
    elements.countdownOverlayScores.classList.add("hidden");
    elements.countdownOverlayScores.innerHTML = "";
    return;
  }

  if (hasWinnerOverlay) {
    const winner = room.players.find((player) => player.id === room.winnerId);
    elements.countdownOverlayLabel.textContent = "Winnaar";
    elements.countdownOverlayNumber.textContent = winner?.name || "Speler";
    elements.countdownOverlayCopy.textContent = `${winner?.score || 10} punten gehaald.`;
    renderOverlayScores(room, true);
    window.clearInterval(overlayIntervalId);
    overlayLastSecond = null;
    return;
  }

  if (hasStartCountdown) {
    elements.countdownOverlayLabel.textContent = "Start";
    elements.countdownOverlayCopy.textContent = "De ronde begint zo.";
    elements.countdownOverlayScores.classList.add("hidden");
    elements.countdownOverlayScores.innerHTML = "";
  } else {
    elements.countdownOverlayLabel.textContent = "Tussenstand";
    elements.countdownOverlayCopy.textContent = "Samen zijn er 3 punten gescoord. Nieuwe maze komt eraan.";
    renderOverlayScores(room, false);
  }

  const renderOverlayTick = () => {
    const remainingMs = state.room
      ? state.room.phase === "countdown"
        ? Math.max(0, (state.room.countdownEndsAt || 0) - Date.now())
        : Math.max(0, (state.room.roundResetAt || 0) - Date.now())
      : 0;
    const seconds = Math.max(1, Math.ceil((remainingMs || 0) / 1000));
    elements.countdownOverlayNumber.textContent = String(seconds);

    if (state.mode === "dashboard" && overlayLastSecond !== seconds) {
      if (seconds <= 3) {
        playCountdownTick(seconds);
      }
      overlayLastSecond = seconds;
    }
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

  if (room.phase === "gameover") {
    const winner = room.players.find((player) => player.id === room.winnerId);
    elements.lobbyTitle.textContent = `${winner?.name || "Speler"} wint het spel`;
    elements.lobbyCopy.textContent = "De eindstand staat hieronder. Gebruik 'Stop spel' om terug te gaan naar de lobby.";
  } else if (room.phase === "intermission") {
    elements.lobbyTitle.textContent = "Tussenstand";
    elements.lobbyCopy.textContent = "Er zijn samen 3 punten gescoord. Na het aftellen start automatisch een nieuwe maze.";
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
  const portalCells = new Set(Object.values(room.maze.portals || {}).map((portal) => `${portal.x},${portal.y}`));

  elements.mazeBoard.innerHTML = "";
  elements.mazeBoard.style.gridTemplateColumns = `repeat(${grid[0].length}, var(--cell-size))`;
  grid.forEach((row, y) => {
    row.forEach((cell, x) => {
      const cellElement = document.createElement("div");
      cellElement.className = `maze-cell ${cell === 1 ? "wall" : "path"}`;
      if (portalCells.has(`${x},${y}`)) {
        cellElement.classList.add("portal-cell");
        cellElement.classList.add(room.gatesOpenRemainingMs > 0 ? "is-open" : "is-closed");
      }

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

        if (player.activeEffect?.id === "__unused_swap__") {
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

function renderScoreboardV2(room) {
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
          : room.winnerId === player.id && room.phase === "gameover"
            ? "Winnaar"
            : "Geen effect";

      if (player.id === state.selfPlayerId) {
        row.classList.add("is-self");
      }

      elements.scoreboard.append(fragment);
    });
}

function renderSelfV2(room) {
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

  const teamMazeScore = room.players.reduce((sum, player) => sum + player.mazeScore, 0);
  const helperText = self.activeEffect
    ? `${self.activeEffect.label} ${Math.ceil(self.effectRemainingMs / 1000)}s`
    : room.phase === "playing"
      ? "Gebruik de pijlen om te bewegen."
      : room.phase === "intermission"
        ? "Tussenstand. Nieuwe maze komt eraan."
        : room.phase === "gameover"
          ? "Het spel is klaar."
          : "Wachten op start.";

  elements.selfSummary.innerHTML = `
    <strong style="color:${self.colorHex}">${self.name}</strong>
    <span>${capitalize(self.colorId)} speler</span>
    <span>${self.score} totaal • jij ${self.mazeScore}/3 • samen ${teamMazeScore}/3</span>
    <span>${helperText}</span>
  `;
  elements.pointsPill.textContent = `${self.score} punten`;
  elements.pointsPill.classList.toggle("is-active", self.score > 0);
  elements.controllerScorePill.textContent = `${self.score}`;
  elements.controllerHelper.textContent = room.phase === "playing"
    ? "Houd een knop vast om door te bewegen."
    : room.phase === "intermission"
      ? "Even wachten. De nieuwe maze start automatisch."
      : room.phase === "gameover"
        ? "Het spel is afgelopen."
        : "Wacht tot de laptop de ronde start.";
}

function renderOverlayScores(room, isFinal) {
  const orderedPlayers = room.players.slice().sort((left, right) => right.score - left.score);
  elements.countdownOverlayScores.classList.remove("hidden");
  elements.countdownOverlayScores.innerHTML = orderedPlayers.map((player) => `
    <div class="countdown-score-row">
      <span class="countdown-score-name">
        <span class="countdown-score-dot" style="background:${player.colorHex}"></span>
        ${player.name}
      </span>
      <span class="countdown-score-value">${player.score} totaal${isFinal ? "" : ` • ${player.mazeScore}/3 deze maze`}</span>
    </div>
  `).join("");
}

function handleRoomSounds(previousRoom, nextRoom) {
  if (state.mode !== "dashboard" || !previousRoom || !nextRoom) {
    return;
  }

  const previousTotalScore = previousRoom.players.reduce((sum, player) => sum + player.score, 0);
  const nextTotalScore = nextRoom.players.reduce((sum, player) => sum + player.score, 0);
  if (nextTotalScore > previousTotalScore) {
    playSound("goal");
  }

  if ((previousRoom.gatesOpenRemainingMs || 0) <= 0 && (nextRoom.gatesOpenRemainingMs || 0) > 0) {
    playSound("gates");
  }

  const previousFreezeIds = new Set(previousRoom.players.filter((player) => player.activeEffect?.id === "freeze").map((player) => player.id));
  const newFreeze = nextRoom.players.some((player) => player.activeEffect?.id === "freeze" && !previousFreezeIds.has(player.id));
  if (newFreeze) {
    playSound("freeze");
  }

  if (previousRoom.message !== nextRoom.message && /verschuift het doolhof/i.test(nextRoom.message || "")) {
    playSound("shuffle");
  }

  if (previousRoom.phase !== "playing" && nextRoom.phase === "playing") {
    playSound("start");
  }

  if (!previousRoom.winnerId && nextRoom.winnerId && nextRoom.phase === "gameover") {
    playSound("winner");
  }
}

function getAudioContext() {
  if (audioContext) {
    return audioContext;
  }

  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) {
    return null;
  }

  audioContext = new Context();
  return audioContext;
}

function playSound(kind) {
  if (state.mode !== "dashboard") {
    return;
  }

  const context = getAudioContext();
  if (!context || (!audioUnlocked && context.state === "suspended")) {
    return;
  }

  if (context.state === "suspended") {
    context.resume().catch(() => {});
  }

  const now = context.currentTime;
  if (kind === "goal") {
    playTone(context, now, 523.25, 0.12, "triangle", 0.06);
    playTone(context, now + 0.08, 659.25, 0.16, "triangle", 0.05);
    return;
  }

  if (kind === "freeze") {
    playTone(context, now, 250, 0.18, "square", 0.05);
    playTone(context, now + 0.04, 180, 0.22, "sawtooth", 0.035);
    return;
  }

  if (kind === "gates") {
    playTone(context, now, 390, 0.1, "sine", 0.06);
    playTone(context, now + 0.08, 520, 0.18, "sine", 0.055);
    return;
  }

  if (kind === "shuffle") {
    playTone(context, now, 310, 0.1, "sawtooth", 0.04);
    playTone(context, now + 0.05, 270, 0.1, "sawtooth", 0.035);
    playTone(context, now + 0.1, 220, 0.16, "triangle", 0.03);
    return;
  }

  if (kind === "start") {
    playTone(context, now, 440, 0.08, "triangle", 0.05);
    playTone(context, now + 0.08, 660, 0.18, "triangle", 0.05);
    return;
  }

  if (kind === "winner") {
    playTone(context, now, 523.25, 0.12, "triangle", 0.06);
    playTone(context, now + 0.12, 659.25, 0.14, "triangle", 0.06);
    playTone(context, now + 0.26, 783.99, 0.22, "triangle", 0.07);
  }
}

function playCountdownTick(seconds) {
  if (state.mode !== "dashboard") {
    return;
  }

  const context = getAudioContext();
  if (!context || (!audioUnlocked && context.state === "suspended")) {
    return;
  }

  const frequency = seconds === 1 ? 740 : seconds === 2 ? 660 : 580;
  playTone(context, context.currentTime, frequency, 0.08, "square", 0.03);
}

function playTone(context, startTime, frequency, duration, type, gainValue) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(gainValue, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
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
