const path = require("path");
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");
const mqtt = require("mqtt");

const PORT = process.env.PORT || 3000;
const MQTT_URL = process.env.MQTT_URL || "";
const MQTT_USER = process.env.MQTT_USER || "";
const MQTT_PASS = process.env.MQTT_PASS || "";
const SIM_MODE = process.env.SIM_MODE !== "false"; // enabled unless explicitly disabled

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ===== Regions + seed towers =====
const regions = [
  { name: "PERTH", code: "PR", lat: -31.95, lng: 115.86 },
  { name: "FREMANTLE", code: "FR", lat: -32.0569, lng: 115.7439 },
  { name: "SYDNEY", code: "SY", lat: -33.8688, lng: 151.2093 },
  { name: "MELBOURNE", code: "MB", lat: -37.8136, lng: 144.9631 },
  { name: "BRISBANE", code: "BN", lat: -27.4698, lng: 153.0251 },
  { name: "GOLD COAST", code: "GC", lat: -28.0, lng: 153.43 },
  { name: "DARWIN", code: "DR", lat: -12.4634, lng: 130.8456 },
  { name: "ADELAIDE", code: "AD", lat: -34.9285, lng: 138.6007 },
];

const TOTAL_TOWERS = 1000;
const towers = [];
const towerById = new Map();
let seq = 1001;

function findTower(token) {
  if (towerById.has(token)) return towerById.get(token);
  const cleaned = token.replace(/[_-]/g, " ");
  if (towerById.has(cleaned)) return towerById.get(cleaned);

  // try by code+number
  const numMatch = token.match(/(\d+)/);
  const num = numMatch ? numMatch[1] : "";
  const codeCandidate = towers.find((t) => `${t.regionCode}${num}` === token);
  if (codeCandidate) return codeCandidate;
  return towers.find((t) => t.id === token) || null;
}

function seedTowers() {
  for (let i = 0; i < TOTAL_TOWERS; i++) {
    const r = regions[i % regions.length];
    const id = `${r.name} ${r.code}${seq++}`;
    const t = {
      id,
      regionName: r.name,
      regionCode: r.code,
      site: `${r.name} Beach Tower`,
      ip: `10.0.${Math.floor(i / 250)}.${(i % 250) + 10}`,
      online: Math.random() > 0.12,
      outputs: [0, 0, 0],
      inputs: [0, 0, 0],
      signal: Math.floor(Math.random() * 5) + 1,
      loc: { lat: r.lat + (Math.random() - 0.5) * 0.04, lng: r.lng + (Math.random() - 0.5) * 0.04 },
      led: { mode: "time", brightness: 60, priority: 10, durationSec: 0, text: "", preset: "", until: 0 },
    };
    towers.push(t);
    towerById.set(id, t);
  }
}

seedTowers();

// ===== Logs & stats =====
const logs = [];
function addLog(type, msg) {
  const entry = { ts: new Date().toISOString(), type, msg };
  logs.push(entry);
  if (logs.length > 300) logs.shift();
  broadcast({ type: "log", entry });
}

function computeStats() {
  const on = towers.filter((t) => t.online).length;
  const off = towers.length - on;
  const alarms = towers.filter((t) => t.inputs.some((v) => v === 1)).length;
  return { online: on, offline: off, alarms };
}

function broadcastStats() {
  broadcast({ type: "stats", stats: computeStats() });
}

// ===== LED helpers =====
function setLedState(tower, cmd) {
  const now = Date.now();
  const durationSec = Number(cmd.durationSec || 0);
  const until = durationSec > 0 ? now + durationSec * 1000 : 0;
  tower.led = {
    mode: cmd.mode,
    preset: cmd.preset || "",
    text: (cmd.text || "").toUpperCase(),
    priority: Number(cmd.priority ?? 10),
    durationSec,
    brightness: Number(cmd.brightness ?? 60),
    until,
  };
}

function expireLedTick() {
  const now = Date.now();
  const changed = [];
  for (const t of towers) {
    if (t.led && t.led.until && now >= t.led.until) {
      t.led = { mode: "time", preset: "", text: "", priority: 10, durationSec: 0, brightness: 60, until: 0 };
      changed.push(t);
    }
  }
  if (changed.length) {
    changed.forEach((t) => broadcast({ type: "tower_update", tower: t }));
  }
}

setInterval(expireLedTick, 1000);

// ===== MQTT wiring =====
let mqttClient = null;
let mqttConnected = false;

function connectMqtt() {
  if (!MQTT_URL) {
    addLog("MQTT", "MQTT_URL not set. MQTT disabled; running simulator only.");
    return;
  }

  const options = {
    username: MQTT_USER || undefined,
    password: MQTT_PASS || undefined,
  };

  mqttClient = mqtt.connect(MQTT_URL, options);

  mqttClient.on("connect", () => {
    mqttConnected = true;
    addLog("MQTT", "Connected to broker");
    mqttClient.subscribe("tower/+/event/#");
  });

  mqttClient.on("error", (err) => {
    mqttConnected = false;
    addLog("MQTT", `Error: ${err.message}`);
  });

  mqttClient.on("close", () => {
    mqttConnected = false;
    addLog("MQTT", "Disconnected from broker");
  });

  mqttClient.on("message", (topic, payload) => {
    handleMqttMessage(topic, payload.toString());
  });
}

function handleMqttMessage(topic, payload) {
  // Expected topics: tower/<id>/event/status, tower/<id>/event/io, tower/<id>/event/call
  const parts = topic.split("/");
  if (parts.length < 4) return;
  const idToken = decodeURIComponent(parts[1]);
  const tower = findTower(idToken);
  if (!tower) return;

  const section = parts[3];
  try {
    const data = JSON.parse(payload || "{}");
    if (section === "status") {
      tower.online = !!data.online;
      if (typeof data.signal === "number") tower.signal = data.signal;
      addLog("MQTT", `Status update ${tower.id} online=${tower.online} signal=${tower.signal}`);
    } else if (section === "io") {
      if (Array.isArray(data.inputs)) tower.inputs = data.inputs.slice(0, 3).map((v) => (v ? 1 : 0));
      if (Array.isArray(data.outputs)) tower.outputs = data.outputs.slice(0, 3).map((v) => (v ? 1 : 0));
      addLog("MQTT", `IO update ${tower.id}`);
    } else if (section === "call") {
      const idx = Number(data.input ?? 0);
      const state = data.state ? 1 : 0;
      if (idx >= 0 && idx < tower.inputs.length) tower.inputs[idx] = state;
      addLog("ALARM", `Call input${idx + 1}=${state} ${tower.id}`);
    } else if (section === "led") {
      if (data.mode) {
        setLedState(tower, data);
        addLog("LED", `LED state from MQTT ${tower.id} mode=${data.mode}`);
      }
    }
    broadcast({ type: "tower_update", tower });
    broadcastStats();
  } catch (err) {
    addLog("MQTT", `Bad payload on ${topic}: ${err.message}`);
  }
}

function publishMqtt(topic, payload) {
  if (!mqttClient || !mqttConnected) return;
  mqttClient.publish(topic, JSON.stringify(payload));
}

// ===== WebSocket =====
let wss;

const server = app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  addLog("System", `Server started on ${PORT} (simulator=${SIM_MODE}, mqtt=${MQTT_URL ? "on" : "off"})`);
});

wss = new WebSocketServer({ server });

function broadcast(msg) {
  if (!wss) return;
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(data);
  });
}

wss.on("connection", (ws) => {
  ws.send(
    JSON.stringify({
      type: "init",
      data: { towers, regions, stats: computeStats(), logs: logs.slice(-80) },
    }),
  );
});

// Connect to MQTT after WebSocket server is ready
connectMqtt();

// ===== API =====
app.get("/api/state", (_req, res) => {
  res.json({ towers, regions, stats: computeStats(), logs: logs.slice(-80) });
});

app.post("/api/towers/:id/output", (req, res) => {
  const { id } = req.params;
  const tower = towerById.get(id) || findTower(id);
  if (!tower) return res.status(404).json({ error: "Tower not found" });
  const idx = Number(req.body.index);
  if (Number.isNaN(idx) || idx < 0 || idx >= tower.outputs.length) return res.status(400).json({ error: "Invalid output index" });

  tower.outputs[idx] = tower.outputs[idx] ? 0 : 1;
  addLog("Output", `${tower.id} OUT${idx + 1} ${tower.outputs[idx] ? "ON" : "OFF"}`);
  broadcast({ type: "tower_update", tower });
  broadcastStats();

  publishMqtt(`tower/${tower.id}/cmd/output`, { index: idx, state: tower.outputs[idx] });
  res.json({ tower, stats: computeStats() });
});

app.post("/api/towers/:id/led", (req, res) => {
  const { id } = req.params;
  const tower = towerById.get(id) || findTower(id);
  if (!tower) return res.status(404).json({ error: "Tower not found" });

  const { target = "tower", mode, preset = "", text = "", durationSec = 0, brightness = 60, priority = 10 } = req.body || {};
  if (!mode) return res.status(400).json({ error: "Missing mode" });

  let affected = [];
  if (target === "region") {
    affected = towers.filter((t) => t.regionName === tower.regionName);
  } else if (target === "all") {
    affected = [...towers];
  } else {
    affected = [tower];
  }

  affected.forEach((t) => setLedState(t, { mode, preset, text, durationSec, brightness, priority }));
  affected.forEach((t) => broadcast({ type: "tower_update", tower: t }));
  addLog("LED", `${target.toUpperCase()} ${target === "region" ? tower.regionName : ""} ${mode}${preset ? `(${preset})` : ""} ${text ? `"${text}"` : ""}`);

  broadcastStats();

  // MQTT publish (tower vs group)
  if (target === "region") {
    publishMqtt(`group/${tower.regionName}/cmd/led`, { mode, preset, text, durationSec, brightness, priority });
  } else if (target === "all") {
    publishMqtt(`group/all/cmd/led`, { mode, preset, text, durationSec, brightness, priority });
  } else {
    publishMqtt(`tower/${tower.id}/cmd/led`, { mode, preset, text, durationSec, brightness, priority });
  }

  res.json({ updated: affected.map((t) => t.id), stats: computeStats() });
});

app.post("/api/towers/:id/ptt", (req, res) => {
  const { id } = req.params;
  const tower = towerById.get(id) || findTower(id);
  if (!tower) return res.status(404).json({ error: "Tower not found" });
  addLog("PTT", `Press-to-talk started on ${tower.id}`);
  publishMqtt(`tower/${tower.id}/cmd/ptt`, { action: "start" });
  res.json({ ok: true });
});

app.post("/api/demo/call", (req, res) => {
  const { id } = req.body || {};
  const tower = id ? towerById.get(id) : towers[Math.floor(Math.random() * towers.length)];
  if (!tower) return res.status(404).json({ error: "Tower not found" });
  triggerCall(tower.id, 15000);
  res.json({ ok: true });
});

// ===== Simulator =====
function triggerCall(towerId, autoClearMs = 15000) {
  const t = towerById.get(towerId);
  if (!t) return;
  t.inputs[0] = 1;
  addLog("ALARM", `CALL BUTTON pressed (Input1) on ${towerId}`);
  broadcast({ type: "tower_update", tower: t });
  broadcastStats();

  setTimeout(() => {
    const tt = towerById.get(towerId);
    if (!tt || tt.inputs[0] !== 1) return;
    tt.inputs[0] = 0;
    addLog("ALARM", `CALL BUTTON cleared on ${towerId}`);
    broadcast({ type: "tower_update", tower: tt });
    broadcastStats();
  }, autoClearMs);
}

if (SIM_MODE) {
  setInterval(() => {
    const t = towers[Math.floor(Math.random() * towers.length)];
    triggerCall(t.id, 12000);
  }, 15000);

  setInterval(() => {
    const t = towers[Math.floor(Math.random() * towers.length)];
    const idx = Math.floor(Math.random() * 3);
    t.outputs[idx] = t.outputs[idx] ? 0 : 1;
    addLog("Output", `Simulator toggled ${t.id} OUT${idx + 1} ${t.outputs[idx] ? "ON" : "OFF"}`);
    broadcast({ type: "tower_update", tower: t });
    broadcastStats();
  }, 18000);
}

module.exports = app;
