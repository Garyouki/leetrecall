// ============================================================
// ui/index.js — Dashboard Logic
// Reads from chrome.storage and renders the full problem table
// ============================================================

let allProblems  = [];
let activeFilter = "all";
let searchQuery  = "";
const selectedProblemIds = new Set();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ── Proficiency level based on SM-2 repetition + easeFactor 
function getProficiency(p) {
  const rep = p.repetition || 0;
  const ef  = p.easeFactor || 2.5;
  if (rep === 0)                  return { label: "Novice",     cls: "badge-novice" };
  if (rep <= 3 || ef < 1.8)      return { label: "Learning",   cls: "badge-learning" };
  if (rep <= 5 && ef < 2.3)      return { label: "Familiar",   cls: "badge-familiar" };
  if (rep <= 5 && ef >= 2.3)     return { label: "Proficient", cls: "badge-proficient" };
  if (rep >= 6 && ef >= 2.3)     return { label: "Mastered",   cls: "badge-mastered" };
  return                                 { label: "Familiar",   cls: "badge-familiar" };
}
// ── Acceptance rate from history ─────────────────────────────
function getAcceptanceRate(p) {
  const history = p.history || [];
  if (!history.length) {
    const solved = p.lastPerformance?.solved ? 1 : 0;
    return { rate: solved * 100, label: `${solved * 100}% (${solved}/1)` };
  }
  const total    = history.length;
  const accepted = history.filter(h => h.solved).length;
  const rate     = Math.round((accepted / total) * 100);
  return { rate, label: `${rate}% (${accepted}/${total})` };
}

// ── Average solve time from history ──────────────────────────
function getAvgTime(p) {
  const history = p.history || [];
  if (!history.length) return p.lastPerformance?.time ? `${p.lastPerformance.time}m` : "—";
  const times = history.map(h => h.time).filter(Boolean);
  if (!times.length) return "—";
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  return `${avg}m`;
}

// ── Format date ───────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric"
  });
}

function updateSelectionControls(visibleIds = []) {
  const redoButton = document.getElementById("redo-tomorrow");
  redoButton.disabled = selectedProblemIds.size === 0;
  redoButton.textContent = `Redo tomorrow (${selectedProblemIds.size})`;

  const selectVisible = document.getElementById("select-visible");
  const selectedVisible = visibleIds.filter(id => selectedProblemIds.has(id)).length;
  selectVisible.disabled = visibleIds.length === 0;
  selectVisible.checked = visibleIds.length > 0 && selectedVisible === visibleIds.length;
  selectVisible.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;
}

// ── Render table ─────────────────────────────────────────────
function render() {
  const today   = new Date();
  today.setHours(0, 0, 0, 0);

  // Filter
  let list = [...allProblems];
  if (activeFilter === "due") {
    list = list.filter(p => new Date(p.nextReview) <= today);
  } else if (activeFilter === "mastered") {
    list = list.filter(p => getProficiency(p).label === "Mastered");
  }

  // Search
  if (searchQuery) {
    list = list.filter(p =>
      p.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }

  // Sort: due first, then by nextReview
  list.sort((a, b) => {
    const aDue = new Date(a.nextReview) <= today;
    const bDue = new Date(b.nextReview) <= today;
    if (aDue && !bDue) return -1;
    if (!aDue && bDue) return 1;
    return new Date(a.nextReview) - new Date(b.nextReview);
  });

  const tbody = document.getElementById("problem-table");

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">
      ${searchQuery ? "No problems match your search." : "No problems here yet!"}
    </td></tr>`;
    updateSelectionControls([]);
    return;
  }

  tbody.innerHTML = list.map(p => {
    const isDue       = new Date(p.nextReview) <= today;
    const nextDate    = formatDate(p.nextReview);
    const lastDate    = p.lastPerformance ? formatDate(p.history?.[p.history.length - 1]?.date || p.nextReview) : "—";
    const proficiency = getProficiency(p);
    const acceptance  = getAcceptanceRate(p);
    const avgTime     = getAvgTime(p);

    // Acceptance rate color
    const rateClass = acceptance.rate >= 70 ? "rate-high"
                    : acceptance.rate >= 40 ? "rate-medium"
                    : "rate-low";

    // Status
    let statusHtml;
    if (isDue) {
      statusHtml = `<span class="status-due">● Due Now</span>`;
    } else if (proficiency.label === "Mastered") {
      statusHtml = `<span class="status-mastered">Mastered</span>`;
    } else {
      statusHtml = `<span class="status-upcoming">Upcoming</span>`;
    }

    return `
      <tr>
        <td class="select-column">
          <input class="problem-checkbox row-checkbox" type="checkbox"
            data-problem-id="${escapeHtml(p.id)}"
            aria-label="Select ${escapeHtml(p.title)}"
            ${selectedProblemIds.has(p.id) ? "checked" : ""}>
        </td>
        <td>
          <a class="prob-link" href="${LeetRecallUrls.getReviewUrl(p.url)}" target="_blank">${escapeHtml(p.title)}</a>
        </td>
        <td class="date-cell ${isDue ? "date-due" : ""}">${nextDate}</td>
        <td class="date-cell">${lastDate}</td>
        <td class="${rateClass}">${acceptance.label}</td>
        <td class="date-cell">${avgTime}</td>
        <td><span class="badge ${proficiency.cls}">${proficiency.label}</span></td>
        <td>${statusHtml}</td>
      </tr>
    `;
  }).join("");

  updateSelectionControls(list.map(problem => problem.id));
}

// ── Update stats bar ──────────────────────────────────────────
function updateStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due      = allProblems.filter(p => new Date(p.nextReview) <= today).length;
  const mastered = allProblems.filter(p => getProficiency(p).label === "Mastered").length;

  document.getElementById("total").textContent    = allProblems.length;
  document.getElementById("due-today").textContent = due;
  document.getElementById("mastered").textContent  = mastered;

  // Simple streak: count consecutive days with at least 1 submission
  const dates = allProblems
    .flatMap(p => (p.history || []).map(h => h.date?.slice(0, 10)))
    .filter(Boolean);
  const uniqueDays = [...new Set(dates)].sort().reverse();
  let streak = 0;
  let checkDate = new Date();
  for (const day of uniqueDays) {
    const d = new Date(day);
    d.setHours(0, 0, 0, 0);
    checkDate.setHours(0, 0, 0, 0);
    const diff = Math.round((checkDate - d) / 86400000);
    if (diff === 0 || diff === 1) { streak++; checkDate = d; }
    else break;
  }
  document.getElementById("streak").textContent = streak;
}

// ── Load from storage ─────────────────────────────────────────
function load() {
  chrome.storage.local.get({ problems: [] }, ({ problems }) => {
    allProblems = problems || [];
    const currentIds = new Set(allProblems.map(problem => problem.id));
    for (const id of selectedProblemIds) {
      if (!currentIds.has(id)) selectedProblemIds.delete(id);
    }
    updateStats();
    render();
  });
}

function showDataMessage(message, type = "") {
  const element = document.getElementById("data-message");
  element.textContent = message;
  element.className = `data-message ${type}`.trim();
}

function validateImportedProblems(value) {
  const problems = Array.isArray(value) ? value : value?.problems;
  if (!Array.isArray(problems)) throw new Error("Backup does not contain a problems array.");

  const seenIds = new Set();
  return problems.map((problem, index) => {
    if (!problem || typeof problem !== "object") {
      throw new Error(`Problem ${index + 1} is invalid.`);
    }
    if (typeof problem.id !== "string" || !problem.id.startsWith("/problems/")) {
      throw new Error(`Problem ${index + 1} has an invalid id.`);
    }
    if (seenIds.has(problem.id)) throw new Error(`Duplicate problem id: ${problem.id}`);
    seenIds.add(problem.id);
    if (typeof problem.title !== "string" || !problem.title.trim()) {
      throw new Error(`Problem ${index + 1} has no title.`);
    }
    if (!problem.nextReview || Number.isNaN(new Date(problem.nextReview).getTime())) {
      throw new Error(`Problem ${index + 1} has an invalid nextReview date.`);
    }
    for (const field of ["interval", "repetition", "easeFactor"]) {
      if (!Number.isFinite(problem[field])) {
        throw new Error(`Problem ${index + 1} has an invalid ${field}.`);
      }
    }
    if (problem.history != null && !Array.isArray(problem.history)) {
      throw new Error(`Problem ${index + 1} has invalid history.`);
    }
    return problem;
  });
}

document.getElementById("export-data").addEventListener("click", () => {
  chrome.storage.local.get({ problems: [] }, ({ problems }) => {
    const backup = {
      format: "leetrecall-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      problems: problems || []
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `leetrecall-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showDataMessage(`Exported ${backup.problems.length} problems.`, "success");
  });
});

const importFile = document.getElementById("import-file");
document.getElementById("import-data").addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    const problems = validateImportedProblems(parsed);
    const shouldImport = window.confirm(
      `Import ${problems.length} problems? This will replace the data currently stored in this extension.`
    );
    if (!shouldImport) return;

    chrome.storage.local.set({ problems }, () => {
      if (chrome.runtime.lastError) {
        showDataMessage(chrome.runtime.lastError.message, "error");
        return;
      }
      showDataMessage(`Imported ${problems.length} problems.`, "success");
      load();
    });
  } catch (error) {
    showDataMessage(`Import failed: ${error.message}`, "error");
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.problems) load();
});

// ── Tab clicks ────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    activeFilter = tab.dataset.filter;
    render();
  });
});

// ── Search ────────────────────────────────────────────────────
document.getElementById("search").addEventListener("input", e => {
  searchQuery = e.target.value;
  render();
});

document.getElementById("problem-table").addEventListener("change", event => {
  const checkbox = event.target.closest(".row-checkbox");
  if (!checkbox) return;

  if (checkbox.checked) selectedProblemIds.add(checkbox.dataset.problemId);
  else selectedProblemIds.delete(checkbox.dataset.problemId);
  render();
});

document.getElementById("select-visible").addEventListener("change", event => {
  document.querySelectorAll(".row-checkbox").forEach(checkbox => {
    if (event.target.checked) selectedProblemIds.add(checkbox.dataset.problemId);
    else selectedProblemIds.delete(checkbox.dataset.problemId);
  });
  render();
});

document.getElementById("redo-tomorrow").addEventListener("click", () => {
  const problemIds = [...selectedProblemIds];
  if (!problemIds.length) return;

  const button = document.getElementById("redo-tomorrow");
  button.disabled = true;
  button.textContent = "Scheduling...";

  chrome.runtime.sendMessage({ type: "SCHEDULE_TOMORROW", problemIds }, response => {
    if (chrome.runtime.lastError || !response?.ok) {
      showDataMessage(
        `Could not schedule: ${chrome.runtime.lastError?.message || response?.error || "Unknown error"}`,
        "error"
      );
      render();
      return;
    }

    selectedProblemIds.clear();
    const label = response.updatedCount === 1 ? "problem" : "problems";
    showDataMessage(`${response.updatedCount} ${label} scheduled for tomorrow.`, "success");
    load();
  });
});

// ── Init ──────────────────────────────────────────────────────
load();
