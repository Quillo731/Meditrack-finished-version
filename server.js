const express = require("express");
const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

const app = express();
const port = process.env.PORT || 4173;
const dataPath = path.join(__dirname, "app-data.json");
const subscriptionsPath = path.join(__dirname, "push-subscriptions.json");

const publicVapidKey = process.env.VAPID_PUBLIC_KEY || "";
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || "";
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:familie@example.com";

if (publicVapidKey && privateVapidKey) {
  webpush.setVapidDetails(vapidSubject, publicVapidKey, privateVapidKey);
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf8");
    }

    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function defaultState() {
  return {
    personName: "",
    medications: [],
    history: [],
    notifications: {},
  };
}

function cleanSharedState(input) {
  return {
    personName: typeof input.personName === "string" ? input.personName : "",
    medications: Array.isArray(input.medications) ? input.medications : [],
    history: Array.isArray(input.history) ? input.history : [],
    notifications: input.notifications && typeof input.notifications === "object" ? input.notifications : {},
  };
}

function readSubscriptions() {
  return readJson(subscriptionsPath, []);
}

function writeSubscriptions(subscriptions) {
  writeJson(subscriptionsPath, subscriptions);
}

async function sendPushToFamily(title, body, tag) {
  if (!publicVapidKey || !privateVapidKey) return;

  const subscriptions = readSubscriptions();
  const remaining = [];
  const payload = JSON.stringify({ title, body, tag });

  for (const item of subscriptions) {
    if (item.role !== "family") {
      remaining.push(item);
      continue;
    }

    try {
      await webpush.sendNotification(item.subscription, payload);
      remaining.push(item);
    } catch (error) {
      if (error.statusCode !== 404 && error.statusCode !== 410) {
        remaining.push(item);
      }
    }
  }

  writeSubscriptions(remaining);
}

function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getScheduledDateTime(medication, date = new Date()) {
  const [hours, minutes] = String(medication.time || "00:00").split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours || 0, minutes || 0, 0, 0);
}

function wasTakenToday(state, medicationId, dateKey) {
  return state.history.some((entry) => entry.medicationId === medicationId && entry.dateKey === dateKey);
}

async function checkLateMedicationNotifications() {
  const state = readJson(dataPath, defaultState());
  const now = new Date();
  const dateKey = getDateKey(now);
  let changed = false;

  for (const medication of state.medications) {
    if (wasTakenToday(state, medication.id, dateKey)) continue;

    const scheduledAt = getScheduledDateTime(medication, now);
    const familyAlertAt = new Date(scheduledAt.getTime() + 15 * 60 * 1000);
    const notificationKey = `server-family-late15-${medication.id}-${dateKey}`;

    if (now >= familyAlertAt && !state.notifications[notificationKey]) {
      state.notifications[notificationKey] = true;
      changed = true;
      await sendPushToFamily(
        "Aile bildirimi",
        `${medication.name} planlanan saatten 15 dakika sonra hâlâ alınmadı.`,
        notificationKey,
      );
    }
  }

  if (changed) {
    writeJson(dataPath, state);
  }
}

app.get("/api/shared-state", (request, response) => {
  response.json(readJson(dataPath, defaultState()));
});

app.post("/api/shared-state", async (request, response) => {
  const previousState = readJson(dataPath, defaultState());
  const previousHistoryIds = new Set(previousState.history.map((entry) => entry.id));
  const nextState = cleanSharedState(request.body || {});

  writeJson(dataPath, nextState);

  const newEntries = nextState.history.filter((entry) => !previousHistoryIds.has(entry.id));
  for (const entry of newEntries) {
    await sendPushToFamily(
      "İlaç alındı",
      `${entry.medicationName} ${entry.actualTime} saatinde alındı.`,
      `family-taken-${entry.id}`,
    );
  }

  response.json({ ok: true });
});

app.get("/api/push-public-key", (request, response) => {
  response.json({ publicKey: publicVapidKey });
});

app.post("/api/push-subscribe", (request, response) => {
  const { role, subscription } = request.body || {};
  if (!role || !subscription || !subscription.endpoint) {
    response.status(400).json({ ok: false });
    return;
  }

  const subscriptions = readSubscriptions();
  const withoutExisting = subscriptions.filter((item) => item.subscription.endpoint !== subscription.endpoint);
  withoutExisting.push({
    role,
    subscription,
    createdAt: new Date().toISOString(),
  });
  writeSubscriptions(withoutExisting);
  response.json({ ok: true });
});

setInterval(checkLateMedicationNotifications, 60 * 1000);
checkLateMedicationNotifications();

app.listen(port, () => {
  console.log(`İlaç Hatırlatıcı läuft auf Port ${port}`);
  if (!publicVapidKey || !privateVapidKey) {
    console.log("Web Push ist noch nicht aktiv. Bitte VAPID_PUBLIC_KEY und VAPID_PRIVATE_KEY setzen.");
  }
});
