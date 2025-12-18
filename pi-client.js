// Minimal Raspberry Pi MQTT client to publish tower events to the backend.
// Usage:
//   MQTT_URL=mqtt://2.245.63.236 TOWER_ID="PERTH PR1001" node pi-client.js
// Optional env: MQTT_USER, MQTT_PASS
//
// Topics sent:
// - tower/<id>/event/status { online, signal }
// - tower/<id>/event/io     { inputs:[0/1], outputs:[0/1] }
// - tower/<id>/event/call   { input: 0, state: true/false }

const mqtt = require("mqtt");

const MQTT_URL = process.env.MQTT_URL || "mqtt://2.245.63.236";
const MQTT_USER = process.env.MQTT_USER || "";
const MQTT_PASS = process.env.MQTT_PASS || "";
const TOWER_ID = process.env.TOWER_ID || "PERTH PR1001";

const client = mqtt.connect(MQTT_URL, {
  username: MQTT_USER || undefined,
  password: MQTT_PASS || undefined,
});

client.on("connect", () => {
  console.log("MQTT connected", MQTT_URL, "as", TOWER_ID);
  publishStatus(true, 4);
  publishIO([0, 0, 0], [0, 0, 0]);

  // Demo call trigger: start after 5s, clear after 15s
  setTimeout(() => publishCall(0, true), 5000);
  setTimeout(() => publishCall(0, false), 15000);

  // Periodic status
  setInterval(() => publishStatus(true, 3 + Math.floor(Math.random() * 3)), 30000);
});

client.on("error", (err) => {
  console.error("MQTT error", err.message);
});

function publishStatus(online, signal) {
  client.publish(`tower/${TOWER_ID}/event/status`, JSON.stringify({ online, signal }));
}

function publishIO(inputs, outputs) {
  client.publish(`tower/${TOWER_ID}/event/io`, JSON.stringify({ inputs, outputs }));
}

function publishCall(inputIndex, state) {
  client.publish(`tower/${TOWER_ID}/event/call`, JSON.stringify({ input: inputIndex, state }));
}
