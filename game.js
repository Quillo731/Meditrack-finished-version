const STORAGE_KEY = "medicationReminderApp";
const LOCAL_SETTINGS_KEY = "medicationReminderLocalSettings";
const SW_VERSION = "v1";
const SYNC_URL = "api/shared-state";
const SYNC_INTERVAL_MS = 3000;

const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const appMenu = document.querySelector(".app-menu");
const appShell = document.querySelector("#appShell");
const personNameDisplay = document.querySelector("#personNameDisplay");
const roleDescription = document.querySelector("#roleDescription");
const todayText = document.querySelector("#todayText");
const currentTimeText = document.querySelector("#currentTimeText");
const profileForm = document.querySelector("#profileForm");
const personNameInput = document.querySelector("#personName");
const medicationForm = document.querySelector("#medicationForm");
const medicationList = document.querySelector("#medicationList");
const familyStatusList = document.querySelector("#familyStatusList");
const historyBody = document.querySelector("#historyBody");
const plannedCount = document.querySelector("#plannedCount");
const takenCount = document.querySelector("#takenCount");
const openCount = document.querySelector("#openCount");
const exportButton = document.querySelector("#exportButton");
const menuButton = document.querySelector("#menuButton");
const menuPanel = document.querySelector("#menuPanel");
const showDeletePanelButton = document.querySelector("#showDeletePanelButton");
const showHistoryButton = document.querySelector("#showHistoryButton");
const enableNotificationsButton = document.querySelector("#enableNotificationsButton");
const changeRoleButton = document.querySelector("#changeRoleButton");
const deletePanel = document.querySelector("#deletePanel");
const historyPanel = document.querySelector("#historyPanel");
const patientView = document.querySelector("#patientView");
const familyView = document.querySelector("#familyView");
const closeDeletePanelButton = document.querySelector("#closeDeletePanelButton");
const closeHistoryButton = document.querySelector("#closeHistoryButton");
const deleteMedicationForm = document.querySelector("#deleteMedicationForm");

let appState = loadState();
let tickTimer = null;
let syncTimer = null;
let isSyncing = false;

function defaultState() {
  return {
    role: "",
    personName: "",
    familyName: "",
    medications: [],
    history: [],
    notifications: {},
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const localSettings = JSON.parse(localStorage.getItem(LOCAL_SETTINGS_KEY) || "{}");
    if (!parsed || typeof parsed !== "object") return defaultState();

    return {
      role: typeof localSettings.role === "string" ? localSettings.role : typeof parsed.role === "string" ? parsed.role : "",
      personName: typeof parsed.personName === "string" ? parsed.personName : "",
      familyName: typeof localSettings.familyName === "string" ? localSettings.familyName : typeof parsed.familyName === "string" ? parsed.familyName : "",
      medications: Array.isArray(parsed.medications) ? parsed.medications : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      notifications: parsed.notifications && typeof parsed.notifications === "object" ? parsed.notifications : {},
    };
  } catch (error) {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  saveLocalSettings();
  pushSharedState();
}

function saveLocalSettings() {
  localStorage.setItem(
    LOCAL_SETTINGS_KEY,
    JSON.stringify({
      role: appState.role,
      familyName: appState.familyName,
    }),
  );
}

function getSharedState() {
  return {
    personName: appState.personName,
    medications: appState.medications,
    history: appState.history,
    notifications: appState.notifications,
  };
}

function mergeSharedState(sharedState) {
  if (!sharedState || typeof sharedState !== "object") return;

  appState.personName = typeof sharedState.personName === "string" ? sharedState.personName : appState.personName;
  appState.medications = Array.isArray(sharedState.medications) ? sharedState.medications : appState.medications;
  appState.history = Array.isArray(sharedState.history) ? sharedState.history : appState.history;
  appState.notifications =
    sharedState.notifications && typeof sharedState.notifications === "object" ? sharedState.notifications : appState.notifications;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
}

function sharedStateHasData(sharedState) {
  return Boolean(
    sharedState &&
      (sharedState.personName ||
        (Array.isArray(sharedState.medications) && sharedState.medications.length > 0) ||
        (Array.isArray(sharedState.history) && sharedState.history.length > 0)),
  );
}

async function pullSharedState() {
  if (location.protocol === "file:") return;

  try {
    const previousHistoryIds = new Set(appState.history.map((entry) => entry.id));
    const response = await fetch(SYNC_URL, { cache: "no-store" });
    if (!response.ok) return;

    const sharedState = await response.json();
    if (!sharedStateHasData(sharedState) && sharedStateHasData(getSharedState())) {
      await pushSharedState();
      return;
    }

    mergeSharedState(sharedState);
    notifyFamilyAboutNewHistory(previousHistoryIds);
    render();
  } catch (error) {
    console.warn("Shared state could not be loaded.", error);
  }
}

async function pushSharedState() {
  if (location.protocol === "file:" || isSyncing) return;

  isSyncing = true;
  try {
    await fetch(SYNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getSharedState()),
    });
  } catch (error) {
    console.warn("Shared state could not be saved.", error);
  } finally {
    isSyncing = false;
  }
}

function startSharedSync() {
  if (location.protocol === "file:") return;
  pullSharedState();
  if (syncTimer) window.clearInterval(syncTimer);
  syncTimer = window.setInterval(pullSharedState, SYNC_INTERVAL_MS);
}

async function registerPwa() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return;

  try {
    await navigator.serviceWorker.register(`sw.js?${SW_VERSION}`);
  } catch (error) {
    console.warn("Service worker could not be registered.", error);
  }
}

function makeId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getScheduledDateTime(medication, date = new Date()) {
  const [hours, minutes] = medication.time.split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours || 0, minutes || 0, 0, 0);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("tr-TR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatShortDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatTime(date) {
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function getTodayRecord(medicationId, dateKey = getDateKey()) {
  return appState.history.find((entry) => entry.medicationId === medicationId && entry.dateKey === dateKey);
}

function getMedicationStatus(medication, now = new Date()) {
  const dateKey = getDateKey(now);
  const record = getTodayRecord(medication.id, dateKey);
  const scheduledAt = getScheduledDateTime(medication, now);
  const patientReminderAt = new Date(scheduledAt.getTime() + 10 * 60 * 1000);
  const familyAlertAt = new Date(scheduledAt.getTime() + 15 * 60 * 1000);

  if (record) {
    return {
      key: "taken",
      label: "Bugün alındı",
      buttonDisabled: true,
      detail: `${record.actualTime} saatinde onaylandı`,
      scheduledAt,
      patientReminderAt,
      familyAlertAt,
    };
  }

  if (now >= familyAlertAt) {
    return {
      key: "due",
      label: "15 dakikadan fazla gecikti",
      buttonDisabled: false,
      detail: "Aileye haber verilmesi gerekir",
      scheduledAt,
      patientReminderAt,
      familyAlertAt,
    };
  }

  if (now >= patientReminderAt) {
    return {
      key: "due",
      label: "10 dakikadan fazla gecikti",
      buttonDisabled: false,
      detail: "Hatırlatma zamanı geldi",
      scheduledAt,
      patientReminderAt,
      familyAlertAt,
    };
  }

  if (now >= scheduledAt) {
    return {
      key: "due",
      label: "Bugün henüz alınmadı",
      buttonDisabled: false,
      detail: "Şimdi onaylanabilir",
      scheduledAt,
      patientReminderAt,
      familyAlertAt,
    };
  }

  return {
    key: "waiting",
    label: `Bugün ${medication.time} saatinden sonra`,
    buttonDisabled: true,
    detail: "Planlanan saat henüz gelmedi",
    scheduledAt,
    patientReminderAt,
    familyAlertAt,
  };
}

function render() {
  const now = new Date();
  const hasRole = appState.role === "patient" || appState.role === "family";

  loginScreen.hidden = hasRole;
  appMenu.hidden = !hasRole;
  appShell.hidden = !hasRole;

  if (!hasRole) {
    scheduleNextTick();
    return;
  }

  const isFamily = appState.role === "family";
  const displayName = isFamily ? appState.familyName || "Aile" : appState.personName || "Misafir";

  personNameDisplay.textContent = displayName;
  personNameInput.value = appState.personName;
  roleDescription.textContent = isFamily
    ? `${appState.personName || "Kişi"} için sadece ilaç durumunu ve geçmişini görüyorsun.`
    : "İlaçlarını buradan ekleyebilir ve aldığında onaylayabilirsin.";
  todayText.textContent = formatDate(now);
  currentTimeText.textContent = formatTime(now);

  document.querySelectorAll(".patient-only").forEach((element) => {
    element.hidden = isFamily;
  });
  patientView.hidden = isFamily;
  familyView.hidden = !isFamily;
  if (isFamily) deletePanel.hidden = true;

  renderSummary(now);
  renderMedications(now);
  renderFamilyStatus(now);
  renderDeleteList();
  renderHistory();
  updateNotificationButton();
  checkTimedNotifications(now);
  scheduleNextTick();
}

function renderSummary(now) {
  let taken = 0;
  let open = 0;

  for (const medication of appState.medications) {
    const status = getMedicationStatus(medication, now);
    if (status.key === "taken") taken += 1;
    if (status.key === "due") open += 1;
  }

  plannedCount.textContent = appState.medications.length;
  takenCount.textContent = taken;
  openCount.textContent = open;
}

function renderMedications(now) {
  medicationList.innerHTML = "";

  if (appState.medications.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Henüz ilaç eklenmedi. Sağ taraftan ilacın adını, alma saatini ve istersen notunu ekleyebilirsin.";
    medicationList.append(empty);
    return;
  }

  for (const medication of sortedMedications()) {
    const status = getMedicationStatus(medication, now);
    const card = createMedicationCard(medication, status, true);
    medicationList.append(card);
  }
}

function renderFamilyStatus(now) {
  familyStatusList.innerHTML = "";

  if (appState.medications.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Henüz takip edilecek ilaç eklenmedi.";
    familyStatusList.append(empty);
    return;
  }

  for (const medication of sortedMedications()) {
    const status = getMedicationStatus(medication, now);
    const card = createMedicationCard(medication, status, false);
    familyStatusList.append(card);
  }
}

function createMedicationCard(medication, status, withConfirmButton) {
  const card = document.createElement("article");
  card.className = `med-card ${status.key}`;

  const main = document.createElement("div");
  main.className = "med-main";
  main.innerHTML = `
    <h3>${escapeHtml(medication.name)}</h3>
    <div class="med-meta">
      <span class="pill">Planlanan: ${medication.time}</span>
      <span class="pill status-pill ${status.key}">${status.label}</span>
    </div>
    <p class="notes">${medication.notes ? escapeHtml(medication.notes) : escapeHtml(status.detail)}</p>
  `;

  card.append(main);

  if (withConfirmButton) {
    const actions = document.createElement("div");
    actions.className = "med-actions";
    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.textContent = "Aldım";
    confirmButton.disabled = status.buttonDisabled;
    confirmButton.addEventListener("click", () => confirmMedication(medication.id));
    actions.append(confirmButton);
    card.append(actions);
  }

  return card;
}

function renderDeleteList() {
  deleteMedicationForm.innerHTML = "";

  if (appState.medications.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Silinecek ilaç yok.";
    deleteMedicationForm.append(empty);
    return;
  }

  for (const medication of sortedMedications()) {
    const label = document.createElement("label");
    label.className = "delete-option";
    label.innerHTML = `
      <input type="checkbox" name="medicationToDelete" value="${medication.id}" />
      <span>
        <strong>${escapeHtml(medication.name)}</strong>
        <span>${medication.time}${medication.notes ? ` · ${escapeHtml(medication.notes)}` : ""}</span>
      </span>
    `;
    deleteMedicationForm.append(label);
  }

  const deleteButton = document.createElement("button");
  deleteButton.className = "danger-button delete-submit";
  deleteButton.type = "submit";
  deleteButton.textContent = "Seçilenleri sil";
  deleteMedicationForm.append(deleteButton);
}

function renderHistory() {
  historyBody.innerHTML = "";

  if (appState.history.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="4">Henüz ilaç alımı onaylanmadı.</td>`;
    historyBody.append(row);
    return;
  }

  const sorted = [...appState.history].sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));

  for (const entry of sorted) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formatShortDate(entry.dateKey)}</td>
      <td>${escapeHtml(entry.medicationName)}</td>
      <td>${entry.scheduledTime}</td>
      <td>${entry.actualTime}</td>
    `;
    historyBody.append(row);
  }
}

function sortedMedications() {
  return [...appState.medications].sort((a, b) => a.time.localeCompare(b.time));
}

function confirmMedication(medicationId) {
  const medication = appState.medications.find((item) => item.id === medicationId);
  if (!medication) return;

  const now = new Date();
  const dateKey = getDateKey(now);
  const status = getMedicationStatus(medication, now);
  if (status.buttonDisabled || getTodayRecord(medicationId, dateKey)) return;

  appState.history.push({
    id: makeId(),
    medicationId: medication.id,
    medicationName: medication.name,
    scheduledTime: medication.time,
    dateKey,
    actualTime: formatTime(now),
    confirmedAt: now.toISOString(),
  });

  saveState();
  render();
}

function deleteMedications(medicationIds) {
  if (medicationIds.length === 0) return;

  const countText = medicationIds.length === 1 ? "1 ilaç" : `${medicationIds.length} ilaç`;
  const confirmed = window.confirm(`${countText} silinsin mi? Eski ilaç geçmişi korunur.`);
  if (!confirmed) return;

  const ids = new Set(medicationIds);
  appState.medications = appState.medications.filter((item) => !ids.has(item.id));
  saveState();
  render();
}

function checkTimedNotifications(now) {
  if (!canSendNotifications()) return;

  const dateKey = getDateKey(now);
  for (const medication of appState.medications) {
    const status = getMedicationStatus(medication, now);
    if (status.key === "taken") continue;

    const patientKey = `patient-late10-${medication.id}-${dateKey}`;
    const familyKey = `family-late15-${medication.id}-${dateKey}`;

    if (appState.role === "patient" && now >= status.patientReminderAt && !appState.notifications[patientKey]) {
      appState.notifications[patientKey] = true;
      saveState();
      sendNotification("İlaç hatırlatma", `${medication.name} henüz alınmadı. Lütfen kontrol et.`, patientKey);
    }

    if (appState.role === "family" && now >= status.familyAlertAt && !appState.notifications[familyKey]) {
      appState.notifications[familyKey] = true;
      saveState();
      sendNotification("Aile bildirimi", `${medication.name} planlanan saatten 15 dakika sonra hâlâ alınmadı.`, familyKey);
    }
  }
}

function notifyFamilyAboutNewHistory(previousHistoryIds) {
  if (appState.role !== "family" || !canSendNotifications()) return;

  const newEntries = appState.history.filter((entry) => !previousHistoryIds.has(entry.id));
  for (const entry of newEntries) {
    sendNotification(
      "İlaç alındı",
      `${entry.medicationName} ${entry.actualTime} saatinde alındı.`,
      `family-taken-${entry.id}`,
    );
  }
}

function canSendNotifications() {
  return "Notification" in window && Notification.permission === "granted";
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    window.alert("Bu cihaz bildirimleri desteklemiyor.");
    return;
  }

  const permission = await Notification.requestPermission();
  updateNotificationButton();

  if (permission === "granted") {
    sendNotification("Bildirimler açıldı", "İlaç hatırlatmaları bu cihazda gösterilecek.", "notifications-enabled");
  }
}

async function sendNotification(title, body, tag) {
  if (!canSendNotifications()) return;

  const options = {
    body,
    tag,
    icon: "icon.svg",
    badge: "icon.svg",
  };

  const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
  if (registration && registration.showNotification) {
    registration.showNotification(title, options);
    return;
  }

  new Notification(title, options);
}

function updateNotificationButton() {
  if (!("Notification" in window)) {
    enableNotificationsButton.textContent = "Bildirim desteklenmiyor";
    enableNotificationsButton.disabled = true;
    return;
  }

  if (Notification.permission === "granted") {
    enableNotificationsButton.textContent = "Bildirimler açık";
    enableNotificationsButton.disabled = true;
    return;
  }

  enableNotificationsButton.textContent = "Bildirimleri aç";
  enableNotificationsButton.disabled = Notification.permission === "denied";
}

function scheduleNextTick() {
  if (tickTimer) window.clearTimeout(tickTimer);
  tickTimer = window.setTimeout(render, 1000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const role = String(formData.get("role") || "");
  const name = String(formData.get("loginName") || "").trim();
  if (!role || !name) return;

  appState.role = role;
  if (role === "patient") {
    appState.personName = name;
  } else {
    appState.familyName = name;
  }

  saveLocalSettings();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  if (role === "patient") {
    pushSharedState();
  } else {
    await pullSharedState();
  }
  render();
});

menuButton.addEventListener("click", () => {
  const willOpen = menuPanel.hidden;
  menuPanel.hidden = !willOpen;
  menuButton.setAttribute("aria-expanded", String(willOpen));
});

showDeletePanelButton.addEventListener("click", () => {
  deletePanel.hidden = false;
  historyPanel.hidden = true;
  menuPanel.hidden = true;
  menuButton.setAttribute("aria-expanded", "false");
  deletePanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

showHistoryButton.addEventListener("click", () => {
  historyPanel.hidden = false;
  deletePanel.hidden = true;
  menuPanel.hidden = true;
  menuButton.setAttribute("aria-expanded", "false");
  historyPanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

enableNotificationsButton.addEventListener("click", requestNotifications);

changeRoleButton.addEventListener("click", () => {
  appState.role = "";
  saveLocalSettings();
  menuPanel.hidden = true;
  render();
});

closeDeletePanelButton.addEventListener("click", () => {
  deletePanel.hidden = true;
});

closeHistoryButton.addEventListener("click", () => {
  historyPanel.hidden = true;
});

deleteMedicationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const checked = Array.from(deleteMedicationForm.querySelectorAll("input[name='medicationToDelete']:checked"));
  deleteMedications(checked.map((input) => input.value));
});

document.addEventListener("click", (event) => {
  if (menuPanel.hidden) return;
  if (event.target === menuButton || menuButton.contains(event.target) || menuPanel.contains(event.target)) return;
  menuPanel.hidden = true;
  menuButton.setAttribute("aria-expanded", "false");
});

window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;

  const previousHistoryIds = new Set(appState.history.map((entry) => entry.id));
  appState = loadState();

  notifyFamilyAboutNewHistory(previousHistoryIds);

  render();
});

profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  appState.personName = personNameInput.value.trim();
  saveState();
  render();
});

medicationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(medicationForm);
  const name = String(formData.get("medName") || "").trim();
  const time = String(formData.get("medTime") || "").trim();
  const notes = String(formData.get("medNotes") || "").trim();

  if (!name || !time) return;

  appState.medications.push({
    id: makeId(),
    name,
    time,
    notes,
    createdAt: new Date().toISOString(),
  });

  saveState();
  medicationForm.reset();
  render();
});

exportButton.addEventListener("click", () => {
  const data = JSON.stringify(appState, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ilac-gecmisi-${getDateKey()}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

registerPwa();
startSharedSync();
render();
