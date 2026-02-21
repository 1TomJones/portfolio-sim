const tbody = document.getElementById("leaderboardTbody");
const updatedAtEl = document.getElementById("leaderboardUpdatedAt");
const countEl = document.getElementById("leaderboardCount");
const headRow = document.getElementById("leaderboardHeadRow");

const socket = io({ transports: ["websocket", "polling"], query: { role: "leaderboard" } });

const METRIC_COLUMNS = [
  { key: "returnPct", label: "Return %", digits: 2, defaultDir: "desc" },
  { key: "sharpe", label: "Sharpe", digits: 3, defaultDir: "desc" },
  { key: "avgInvested", label: "Invest %", digits: 2, defaultDir: "desc" },
  { key: "allocationScore", label: "Allocation %", digits: 2, defaultDir: "desc" },
  { key: "finalScore", label: "Score", digits: 4, defaultDir: "desc" },
];

const ALL_COLUMNS = [
  { key: "rank", label: "Rank", type: "number", defaultDir: "asc" },
  { key: "playerName", label: "Player", type: "text", defaultDir: "asc" },
  ...METRIC_COLUMNS.map((metric) => ({ ...metric, type: "number", metric: true })),
];

let previousRanks = new Map();
let sortKey = "finalScore";
let sortDir = "desc";
let lastRows = [];

const storedHidden = localStorage.getItem("leaderboard-hidden-metrics");
let hiddenMetrics = new Set(storedHidden ? JSON.parse(storedHidden) : []);

function persistHiddenMetrics() {
  localStorage.setItem("leaderboard-hidden-metrics", JSON.stringify([...hiddenMetrics]));
}

function fmt(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return Number(value).toFixed(digits);
}

function compareRows(a, b, column) {
  const aValue = a?.[column.key];
  const bValue = b?.[column.key];

  if (column.type === "text") {
    const result = String(aValue || "").localeCompare(String(bValue || ""));
    return sortDir === "asc" ? result : -result;
  }

  const aNum = Number.isFinite(Number(aValue)) ? Number(aValue) : -Infinity;
  const bNum = Number.isFinite(Number(bValue)) ? Number(bValue) : -Infinity;
  const result = aNum === bNum ? 0 : aNum > bNum ? 1 : -1;
  return sortDir === "asc" ? result : -result;
}

function sortRows(rows) {
  const column = ALL_COLUMNS.find((entry) => entry.key === sortKey) || ALL_COLUMNS[ALL_COLUMNS.length - 1];
  return [...rows].sort((a, b) => compareRows(a, b, column));
}

function metricDisplay(row, metric) {
  if (hiddenMetrics.has(metric.key)) return "—";
  return fmt(row?.[metric.key], metric.digits);
}

function toggleSort(columnKey) {
  const column = ALL_COLUMNS.find((entry) => entry.key === columnKey);
  if (!column) return;

  if (sortKey === columnKey) {
    sortDir = sortDir === "asc" ? "desc" : "asc";
  } else {
    sortKey = columnKey;
    sortDir = column.defaultDir || "desc";
  }

  renderHeader();
  renderRows();
}

function toggleMetricVisibility(metricKey) {
  if (hiddenMetrics.has(metricKey)) hiddenMetrics.delete(metricKey);
  else hiddenMetrics.add(metricKey);
  persistHiddenMetrics();
  renderHeader();
  renderRows();
}

function renderHeader() {
  if (!headRow) return;
  headRow.innerHTML = "";

  ALL_COLUMNS.forEach((column) => {
    const th = document.createElement("th");
    const wrap = document.createElement("div");
    wrap.className = "leaderboard-th-wrap";

    const sortBtn = document.createElement("button");
    sortBtn.type = "button";
    sortBtn.className = "leaderboard-sort-btn";
    const isActive = sortKey === column.key;
    sortBtn.textContent = `${column.label}${isActive ? (sortDir === "asc" ? " ▲" : " ▼") : ""}`;
    sortBtn.addEventListener("click", () => toggleSort(column.key));
    wrap.appendChild(sortBtn);

    if (column.metric) {
      const eyeBtn = document.createElement("button");
      eyeBtn.type = "button";
      eyeBtn.className = "leaderboard-eye-btn";
      const hidden = hiddenMetrics.has(column.key);
      eyeBtn.title = hidden ? `Show ${column.label}` : `Hide ${column.label}`;
      eyeBtn.textContent = hidden ? "🙈" : "👁";
      eyeBtn.addEventListener("click", () => toggleMetricVisibility(column.key));
      wrap.appendChild(eyeBtn);
    }

    th.appendChild(wrap);
    headRow.appendChild(th);
  });
}

function renderRows() {
  const rows = sortRows(lastRows || []);
  const nextRanks = new Map();
  tbody.innerHTML = "";

  rows.forEach((row) => {
    nextRanks.set(row.playerId, row.rank);
    const prevRank = previousRanks.get(row.playerId);
    const rankDelta = Number.isFinite(prevRank) ? prevRank - row.rank : 0;

    const tr = document.createElement("tr");
    if (rankDelta > 0) tr.classList.add("rank-up");
    if (rankDelta < 0) tr.classList.add("rank-down");

    const awardBadges = (row.awards || []).map((award) => `<span class="award-badge" title="${award.label}">${award.label}</span>`).join(" ");

    tr.innerHTML = `
      <td>${row.rank}</td>
      <td>
        <div class="leaderboard-player">${row.playerName || "Player"}</div>
        <div class="leaderboard-awards">${awardBadges || ""}</div>
      </td>
      <td>${metricDisplay(row, METRIC_COLUMNS[0])}</td>
      <td>${metricDisplay(row, METRIC_COLUMNS[1])}</td>
      <td>${metricDisplay(row, METRIC_COLUMNS[2])}</td>
      <td>${metricDisplay(row, METRIC_COLUMNS[3])}</td>
      <td><strong>${metricDisplay(row, METRIC_COLUMNS[4])}</strong></td>
    `;

    tbody.appendChild(tr);
  });

  previousRanks = nextRanks;
}

function renderLeaderboard(payload) {
  lastRows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (countEl) countEl.textContent = `Players: ${lastRows.length}`;
  if (updatedAtEl) {
    const updated = Number(payload?.updatedAt || Date.now());
    updatedAtEl.textContent = `Updated: ${new Date(updated).toLocaleTimeString()}`;
  }
  renderRows();
}

async function hydrate() {
  try {
    const response = await fetch("/api/leaderboard", { cache: "no-store" });
    if (!response.ok) return;
    renderLeaderboard(await response.json());
  } catch {
    // no-op
  }
}

renderHeader();
socket.on("leaderboard", (payload) => renderLeaderboard(payload));
setInterval(() => hydrate(), 10000);
hydrate();
