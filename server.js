// ============================================================
// BACKEND DO JOGO
// ------------------------------------------------------------
// Execute com:
//   node server.js
//
// Este servidor usa apenas modulos nativos do Node.js. Assim, os
// discentes conseguem estudar HTTP, rotas, JSON e estado compartilhado
// sem instalar bibliotecas externas.
// ============================================================

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = 3000;
const PUBLIC_DIR = __dirname;

const arena = { width: 900, height: 520 };

const walls = [
  { x: 300, y: 90, width: 40, height: 180 },
  { x: 560, y: 250, width: 40, height: 180 }
];

const tanks = [
  createTank(1, "Jogador 1", 80, 120, "#22c55e", 0),
  createTank(2, "Jogador 2", 760, 320, "#ef4444", Math.PI)
];

const inputs = {
  1: { turn: 0, move: 0, shoot: false },
  2: { turn: 0, move: 0, shoot: false }
};

const bullets = [];
const score = { 1: 0, 2: 0 };

let winnerId = null;

function createTank(id, nick, x, y, color, angle) {
  return {
    id,
    nick,
    x,
    y,
    width: 50,
    height: 50,
    color,
    angle,
    connected: false,
    lastShotAt: 0
  };
}

function getLocalIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        ips.push(address.address);
      }
    }
  }

  return ips;
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1_000_000) {
        reject(new Error("Corpo da requisicao muito grande."));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("JSON invalido."));
      }
    });
  });
}

function serveStaticFile(request, response) {
  const urlPath = request.url === "/" ? "/index.html" : request.url;
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Arquivo nao encontrado.");
      return;
    }

    const extension = path.extname(filePath);
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8"
    };

    response.writeHead(200, {
      "Content-Type": contentTypes[extension] || "application/octet-stream"
    });
    response.end(content);
  });
}

function publicState() {
  return {
    arena,
    walls,
    tanks,
    bullets,
    score,
    winnerId
  };
}

function joinPlayer(nick) {
  const trimmedNick = String(nick || "").trim().slice(0, 16);
  if (!trimmedNick) {
    return { error: "Nick invalido." };
  }

  const availableTank = tanks.find((tank) => !tank.connected);
  if (!availableTank) {
    return { error: "A partida ja tem dois jogadores. Abra outra aba apenas para assistir." };
  }

  availableTank.nick = trimmedNick;
  availableTank.connected = true;

  return { playerId: availableTank.id, state: publicState() };
}

function leavePlayer(playerId) {
  const tank = tanks.find((item) => item.id === playerId);
  if (!tank) return;

  tank.connected = false;
  tank.nick = `Jogador ${tank.id}`;
  inputs[tank.id] = { turn: 0, move: 0, shoot: false };
}

function resetRound(resetScore = false) {
  tanks[0].x = 80;
  tanks[0].y = 120;
  tanks[0].angle = 0;

  tanks[1].x = 760;
  tanks[1].y = 320;
  tanks[1].angle = Math.PI;

  bullets.length = 0;
  winnerId = null;

  inputs[1] = { turn: 0, move: 0, shoot: false };
  inputs[2] = { turn: 0, move: 0, shoot: false };

  if (resetScore) {
    score[1] = 0;
    score[2] = 0;
  }
}

function isColliding(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function clampTankToArena(tank) {
  tank.x = Math.max(0, Math.min(arena.width - tank.width, tank.x));
  tank.y = Math.max(0, Math.min(arena.height - tank.height, tank.y));
}

function tryMoveTank(tank, distance) {
  const next = {
    ...tank,
    x: tank.x + Math.cos(tank.angle) * distance,
    y: tank.y + Math.sin(tank.angle) * distance
  };

  clampTankToArena(next);

  for (const wall of walls) {
    if (isColliding(next, wall)) return;
  }

  for (const otherTank of tanks) {
    if (otherTank.id !== tank.id && isColliding(next, otherTank)) return;
  }

  tank.x = next.x;
  tank.y = next.y;
}

function createBullet(tank) {
  const centerX = tank.x + tank.width / 2;
  const centerY = tank.y + tank.height / 2;
  const barrelLength = 38;

  return {
    ownerId: tank.id,
    x: centerX + Math.cos(tank.angle) * barrelLength,
    y: centerY + Math.sin(tank.angle) * barrelLength,
    radius: 6,
    speed: 8,
    angle: tank.angle
  };
}

function updateTanks() {
  const turnSpeed = 0.07;
  const moveSpeed = 4;

  for (const tank of tanks) {
    const input = inputs[tank.id];
    if (!input || winnerId) continue;

    tank.angle += input.turn * turnSpeed;

    if (input.move !== 0) {
      tryMoveTank(tank, input.move * moveSpeed);
    }

    if (input.shoot && Date.now() - tank.lastShotAt > 350) {
      bullets.push(createBullet(tank));
      tank.lastShotAt = Date.now();
    }

    // O disparo deve acontecer uma vez por pressionamento enviado.
    input.shoot = false;
  }
}

function bulletBox(bullet) {
  return {
    x: bullet.x - bullet.radius,
    y: bullet.y - bullet.radius,
    width: bullet.radius * 2,
    height: bullet.radius * 2
  };
}

function isBulletOutOfArena(bullet) {
  return (
    bullet.x < 0 ||
    bullet.x > arena.width ||
    bullet.y < 0 ||
    bullet.y > arena.height
  );
}

function updateBullets() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];
    bullet.x += Math.cos(bullet.angle) * bullet.speed;
    bullet.y += Math.sin(bullet.angle) * bullet.speed;

    if (isBulletOutOfArena(bullet)) {
      bullets.splice(i, 1);
      continue;
    }

    const box = bulletBox(bullet);

    if (walls.some((wall) => isColliding(box, wall))) {
      bullets.splice(i, 1);
      continue;
    }

    const target = tanks.find((tank) => tank.id !== bullet.ownerId && isColliding(box, tank));
    if (target) {
      bullets.splice(i, 1);
      score[bullet.ownerId]++;

      if (score[bullet.ownerId] >= 3) {
        winnerId = bullet.ownerId;
      } else {
        resetRound(false);
      }
    }
  }
}

function gameLoop() {
  updateTanks();
  updateBullets();
}

async function handleApi(request, response) {
  if (request.method === "GET" && request.url === "/api/info") {
    sendJson(response, 200, {
      port: PORT,
      hostIps: getLocalIps()
    });
    return;
  }

  if (request.method === "GET" && request.url === "/api/state") {
    sendJson(response, 200, publicState());
    return;
  }

  if (request.method === "POST" && request.url === "/api/join") {
    const body = await readRequestBody(request);
    const result = joinPlayer(body.nick);
    sendJson(response, result.error ? 400 : 200, result);
    return;
  }

  if (request.method === "POST" && request.url === "/api/input") {
    const body = await readRequestBody(request);
    const playerId = Number(body.playerId);

    if (!inputs[playerId]) {
      sendJson(response, 400, { error: "Jogador invalido." });
      return;
    }

    inputs[playerId] = {
      turn: Math.max(-1, Math.min(1, Number(body.input?.turn || 0))),
      move: Math.max(-1, Math.min(1, Number(body.input?.move || 0))),
      shoot: Boolean(body.input?.shoot)
    };

    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && request.url === "/api/leave") {
    const body = await readRequestBody(request);
    leavePlayer(Number(body.playerId));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && request.url === "/api/reset") {
    resetRound(true);
    sendJson(response, 200, publicState());
    return;
  }

  sendJson(response, 404, { error: "Rota nao encontrada." });
}

const server = http.createServer((request, response) => {
  if (request.url.startsWith("/api/")) {
    handleApi(request, response).catch((error) => {
      sendJson(response, 400, { error: error.message });
    });
    return;
  }

  serveStaticFile(request, response);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Battle Lab rodando.");
  console.log(`Local:   http://localhost:${PORT}`);

  for (const ip of getLocalIps()) {
    console.log(`Rede:    http://${ip}:${PORT}`);
  }
});

setInterval(gameLoop, 1000 / 60);