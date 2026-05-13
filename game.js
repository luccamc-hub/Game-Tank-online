// ============================================================
// FRONTEND DO JOGO
// ------------------------------------------------------------
// Este arquivo cuida apenas do navegador:
// 1. le eventos de teclado;
// 2. envia os comandos para o backend;
// 3. recebe o estado atual da partida;
// 4. desenha tudo no Canvas.
//
// A regra do jogo fica no server.js. Essa separacao ajuda a
// mostrar a diferenca entre DOM/eventos no cliente e estado no
// servidor.
// ============================================================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const homeScreen = document.getElementById("screen-home");
const gameScreen = document.getElementById("screen-game");
const endScreen = document.getElementById("screen-end");

const nickForm = document.getElementById("nick-form");
const nickInput = document.getElementById("nick-input");

const statusMessage = document.getElementById("status-message");
const hostIpLabel = document.getElementById("host-ip-label");
const connectionLabel = document.getElementById("connection-label");

const playerLabel = document.getElementById("player-label");
const scoreLabel = document.getElementById("score-label");
const endTitle = document.getElementById("end-title");

const restartButton = document.getElementById("restart-button");
const backButton = document.getElementById("back-button");

// O navegador guarda quais teclas estao pressionadas no momento.
// O backend recebe somente um resumo: girando para esquerda/direita,
// andando para frente/tras e atirando.
let keys = {};

let myPlayerId = null;
let latestState = null;
let lastShotAt = 0;
let pollingTimer = null;
let inputTimer = null;

function showScreen(screen) {
  homeScreen.classList.add("hidden"); // adiciona a class "hidden" ao homeScreen, escondendo essa section
  gameScreen.classList.add("hidden");
  endScreen.classList.add("hidden");
  screen.classList.remove("hidden");
}

function setStatus(message) {
  statusMessage.textContent = message;
}

function updateHostIps(ips) {
  if (!ips || ips.length === 0) {
    hostIpLabel.textContent = "IP do servidor: abra este projeto com node server.js";
    return;
  }

  const links = ips.map((ip) => `http://${ip}:3000`).join("  |  ");
  hostIpLabel.textContent = `Para jogar em rede local, outro jogador pode abrir: ${links}`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Erro HTTP ${response.status}`);
  }

  return response.json();
}

async function loadServerInfo() {
  try {
    const info = await requestJson("/api/info");
    updateHostIps(info.hostIps);
  } catch (error) {
    hostIpLabel.textContent = "Backend nao encontrado. Inicie com: node server.js";
  }
}

async function joinGame(nick) {
  const data = await requestJson("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nick })
  });

  myPlayerId = data.playerId;
  latestState = data.state;
  updateHud();
  drawScene();
}

function updateHud() {
  if (!latestState) return;

  const me = latestState.tanks.find((tank) => tank.id === myPlayerId);
  playerLabel.textContent = me
    ? `Voce: ${me.nick} (Tanque ${me.id})`
    : "Voce: espectador";

  scoreLabel.textContent = `Placar: ${latestState.score[1]} x ${latestState.score[2]}`;

  const connected = latestState.tanks.filter((tank) => tank.connected).length;
  connectionLabel.textContent = `Jogadores conectados: ${connected}/2`;
}

// Gera um pacote pequeno com o estado atual dos controles.
// A/D e setas laterais giram o tanque.
// W/S e setas verticais movem para frente/tras na direcao atual.

function buildInputPayload() {
  const turningLeft = keys.a || keys.A || keys.ArrowLeft;
  const turningRight = keys.d || keys.D || keys.ArrowRight;
  const movingForward = keys.w || keys.W || keys.ArrowUp;
  const movingBackward = keys.s || keys.S || keys.ArrowDown;

  const wantsToShoot = keys[" "] && performance.now() - lastShotAt > 250;
  if (wantsToShoot) lastShotAt = performance.now();

  return {
    playerId: myPlayerId,
    input: {
      turn: Number(turningRight) - Number(turningLeft),
      move: Number(movingForward) - Number(movingBackward),
      shoot: wantsToShoot
    }
  };
}

async function sendInput() {
  if (!myPlayerId) return;

  try {
    await requestJson("/api/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildInputPayload())
    });
  } catch (error) {
    connectionLabel.textContent = "Servidor desconectado.";
  }
}

async function pollState() {
  try {
    latestState = await requestJson("/api/state");
    updateHud();

    if (latestState.winnerId) {
      const winner = latestState.tanks.find((tank) => tank.id === latestState.winnerId);
      endTitle.textContent = `Vitoria de ${winner ? winner.nick : "um jogador"}`;
      showScreen(endScreen);
    }
  } catch (error) {
    connectionLabel.textContent = "Servidor desconectado.";
  }
}

function startNetworkLoop() {
  clearInterval(inputTimer);
  clearInterval(pollingTimer);

  // Em uma aula, esses intervalos deixam claro que o navegador
  // envia comandos e busca o estado do servidor varias vezes por segundo.
  inputTimer = setInterval(sendInput, 33);
  pollingTimer = setInterval(pollState, 33);
}

function leaveGame() {
  if (!myPlayerId) return;

  const payload = JSON.stringify({ playerId: myPlayerId });

  // sendBeacon e util quando a aba esta fechando, pois o navegador
  // tenta enviar a mensagem sem bloquear o fechamento da pagina.
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/leave", new Blob([payload], { type: "application/json" }));
  } else {
    fetch("/api/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true
    });
  }
}

function drawArena() {
  ctx.fillStyle = "#172033";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(125, 211, 252, 0.12)";
  ctx.lineWidth = 1;

  for (let x = 0; x <= canvas.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }

  for (let y = 0; y <= canvas.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
}

function drawWalls() {
  if (!latestState) return;

  ctx.fillStyle = "#64748b";
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 2;

  for (const wall of latestState.walls) {
    ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
    ctx.strokeRect(wall.x, wall.y, wall.width, wall.height);
  }
}

function drawTank(tank) {
  ctx.save();

  const centerX = tank.x + tank.width / 2;
  const centerY = tank.y + tank.height / 2;

  // Para girar um desenho no Canvas, movemos a origem para o centro
  // do tanque, rotacionamos o contexto e desenhamos o tanque em torno
  // desse novo centro. Depois, ctx.restore() desfaz a transformacao.
  ctx.translate(centerX, centerY);
  ctx.rotate(tank.angle);

  ctx.fillStyle = tank.color;
  ctx.strokeStyle = tank.id === myPlayerId ? "#facc15" : "#0f172a";
  ctx.lineWidth = tank.id === myPlayerId ? 4 : 2;

  ctx.fillRect(-tank.width / 2, -tank.height / 2, tank.width, tank.height);
  ctx.strokeRect(-tank.width / 2, -tank.height / 2, tank.width, tank.height);

  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(8, -5, 30, 10);

  ctx.fillStyle = "rgba(15, 23, 42, 0.35)";
  ctx.fillRect(-18, -20, 10, 40);
  ctx.fillRect(8, -20, 10, 40);

  ctx.restore();
}

function drawNick(tank) {
  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 14px Arial";
  ctx.textAlign = "center";
  ctx.fillText(tank.nick, tank.x + tank.width / 2, tank.y - 8);
  ctx.textAlign = "left";
}

function drawBullets() {
  if (!latestState) return;

  ctx.fillStyle = "#fde047";
  for (const bullet of latestState.bullets) {
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawScene() {
  drawArena();
  drawWalls();

  if (latestState) {
    for (const tank of latestState.tanks) {
      drawTank(tank);
      drawNick(tank);
    }
  }

  drawBullets();
}

function animationLoop() {
  drawScene();
  requestAnimationFrame(animationLoop);
}

// EVENTOS

nickForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  const nick = nickInput.value.trim();
  if (!nick) {
    setStatus("Digite um nick valido para comecar.");
    return;
  }

  try {
    await joinGame(nick);
    setStatus("Conectado ao servidor.");
    showScreen(gameScreen);
    startNetworkLoop();
  } catch (error) {
    setStatus(`Nao foi possivel entrar: ${error.message}`);
  }
});

document.addEventListener("keydown", function (event) {
  const key = event.key;

  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(key)) {
    event.preventDefault();
  }

  keys[key] = true;

  if (key.toLowerCase() === "r" && myPlayerId) {
    requestJson("/api/reset", { method: "POST" }).catch(() => {
      connectionLabel.textContent = "Servidor desconectado.";
    });
  }
});

document.addEventListener("keyup", function (event) {
  keys[event.key] = false;
});

restartButton.addEventListener("click", async function () {
  await requestJson("/api/reset", { method: "POST" });
  latestState = await requestJson("/api/state");
  showScreen(gameScreen);
});

backButton.addEventListener("click", function () {
  leaveGame();
  myPlayerId = null;
  nickInput.value = "";
  setStatus("Digite um nick para comecar.");
  showScreen(homeScreen);
});

window.addEventListener("beforeunload", leaveGame);

loadServerInfo();
drawScene();
animationLoop();