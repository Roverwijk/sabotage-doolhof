const STORAGE_KEY = "hoofdpijn-dagboek-items";

const form = document.getElementById("entry-form");
const entryDate = document.getElementById("entry-date");
const entryTime = document.getElementById("entry-time");
const painLevel = document.getElementById("pain-level");
const painDisplay = document.getElementById("pain-display");
const entriesList = document.getElementById("entries-list");
const totalEntries = document.getElementById("total-entries");
const averagePain = document.getElementById("average-pain");
const topTrigger = document.getElementById("top-trigger");
const template = document.getElementById("entry-template");
const cancelEditButton = document.getElementById("cancel-edit");

let entries = loadEntries();
let editingEntryId = null;

setDefaultDateTime();
render();
registerServiceWorker();

painLevel.addEventListener("input", () => {
  painDisplay.textContent = painLevel.value;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const entry = {
    id: editingEntryId || crypto.randomUUID(),
    date: formData.get("date"),
    time: formData.get("time"),
    painLevel: Number(formData.get("painLevel")),
    duration: formData.get("duration"),
    triggers: formData.getAll("triggers"),
    symptoms: formData.getAll("symptoms"),
    medication: formData.get("medication").trim(),
    notes: formData.get("notes").trim(),
    createdAt: new Date().toISOString()
  };

  if (editingEntryId) {
    const existingEntry = entries.find((item) => item.id === editingEntryId);
    entry.createdAt = existingEntry?.createdAt || entry.createdAt;
    entries = entries.map((item) => item.id === editingEntryId ? entry : item);
  } else {
    entries.unshift(entry);
  }

  persistEntries();
  resetForm();
  render();
});

cancelEditButton.addEventListener("click", () => {
  resetForm();
});

entriesList.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) {
    return;
  }

  const card = event.target.closest(".entry-card");
  const entryId = card?.dataset.entryId;
  if (!entryId) {
    return;
  }

  if (button.classList.contains("delete-entry")) {
    entries = entries.filter((entry) => entry.id !== entryId);
    persistEntries();

    if (editingEntryId === entryId) {
      resetForm();
    }

    render();
    return;
  }

  if (button.classList.contains("edit-entry")) {
    startEditing(entryId);
  }
});

function loadEntries() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error("Kon registraties niet laden", error);
    return [];
  }
}

function persistEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function setDefaultDateTime() {
  const now = new Date();
  entryDate.value = formatDateInput(now);
  entryTime.value = formatTimeInput(now);
}

function render() {
  renderSummary();
  renderEntries();
}

function renderSummary() {
  totalEntries.textContent = String(entries.length);

  const painAverage = entries.length
    ? entries.reduce((sum, entry) => sum + entry.painLevel, 0) / entries.length
    : 0;

  averagePain.textContent = painAverage.toFixed(1);
  topTrigger.textContent = getTopTrigger();
}

function renderEntries() {
  entriesList.innerHTML = "";

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Nog geen registraties. Voeg je eerste hoofdpijnmoment toe.";
    entriesList.append(empty);
    return;
  }

  entries
    .slice()
    .sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`))
    .forEach((entry) => {
      const fragment = template.content.cloneNode(true);
      const card = fragment.querySelector(".entry-card");

      fragment.querySelector(".entry-datetime").textContent = formatDateTime(entry.date, entry.time);
      fragment.querySelector(".entry-duration").textContent = `Duur: ${entry.duration}`;
      fragment.querySelector(".pain-badge").textContent = `${entry.painLevel}/10`;
      fragment.querySelector(".triggers-line").textContent = formatList("Triggers", entry.triggers);
      fragment.querySelector(".symptoms-line").textContent = formatList("Symptomen", entry.symptoms);
      fragment.querySelector(".medication-line").textContent = entry.medication
        ? `Aanpak: ${entry.medication}`
        : "Aanpak: niet ingevuld";
      fragment.querySelector(".entry-notes").textContent = entry.notes || "Geen extra notities.";

      card.dataset.entryId = entry.id;
      entriesList.append(fragment);
    });
}

function getTopTrigger() {
  const counts = new Map();

  entries.forEach((entry) => {
    entry.triggers.forEach((trigger) => {
      counts.set(trigger, (counts.get(trigger) || 0) + 1);
    });
  });

  if (!counts.size) {
    return "Nog geen data";
  }

  const [trigger, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return `${trigger} (${count}x)`;
}

function formatList(label, values) {
  return values.length ? `${label}: ${values.join(", ")}` : `${label}: geen`;
}

function formatDateTime(dateValue, timeValue) {
  const date = new Date(`${dateValue}T${timeValue}`);
  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimeInput(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function resetForm() {
  editingEntryId = null;
  form.reset();
  setDefaultDateTime();
  painLevel.value = "5";
  painDisplay.textContent = "5";
  cancelEditButton.hidden = true;
  form.querySelector(".primary-button").textContent = "Opslaan";
}

function startEditing(entryId) {
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) {
    return;
  }

  editingEntryId = entryId;
  entryDate.value = entry.date;
  entryTime.value = entry.time;
  painLevel.value = String(entry.painLevel);
  painDisplay.textContent = String(entry.painLevel);
  document.getElementById("duration").value = entry.duration;
  document.getElementById("medication").value = entry.medication;
  document.getElementById("notes").value = entry.notes;

  setCheckedValues("triggers", entry.triggers);
  setCheckedValues("symptoms", entry.symptoms);

  cancelEditButton.hidden = false;
  form.querySelector(".primary-button").textContent = "Bijwerken";
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setCheckedValues(name, values) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = values.includes(input.value);
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.error("Kon service worker niet registreren", error);
    });
  });
}
