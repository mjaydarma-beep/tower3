// Minimal MQTT sender for the dashboard.
// Usage:
//   MQTT_URL=mqtt://2.245.63.236 TOWER_ID="PERTH PR1001" node client-sender.js
// Optional env: MQTT_USER, MQTT_PASS
//
// Topics sent (what the server expects):
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
  console.log("MQTT connected to", MQTT_URL, "as", TOWER_ID);
  publishStatus(true, 4);
  publishIO([0, 0, 0], [0, 0, 0]);

  // Demo call: start and clear
  setTimeout(() => publishCall(0, true), 3000);
  setTimeout(() => publishCall(0, false), 12000);

  // Periodic status updates
  setInterval(() => publishStatus(true, 3 + Math.floor(Math.random() * 3)), 30000);
});

client.on("error", (err) => console.error("MQTT error:", err.message));

function publishStatus(online, signal) {
  client.publish(`tower/${TOWER_ID}/event/status`, JSON.stringify({ online, signal }));
}

function publishIO(inputs, outputs) {
  client.publish(`tower/${TOWER_ID}/event/io`, JSON.stringify({ inputs, outputs }));
}

function publishCall(inputIndex, state) {
  client.publish(`tower/${TOWER_ID}/event/call`, JSON.stringify({ input: inputIndex, state }));
}
