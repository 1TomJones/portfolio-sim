const socket = io({ transports: ['websocket','polling'], upgrade: true });

/* elements */
const joinView       = document.getElementById('joinView');
const waitView       = document.getElementById('waitView');
const gameView       = document.getElementById('gameView');
const rosterUl       = document.getElementById('roster');
const nameInput      = document.getElementById('nameInput');
const joinBtn        = document.getElementById('joinBtn');
const joinMsg        = document.getElementById('joinMsg');
const productLbl     = document.getElementById('productLbl');
const newsBar        = document.getElementById('newsBar');
const newsText       = document.getElementById('newsText');
const lastNewsHeadline = document.getElementById('lastNewsHeadline');
const priceLbl       = document.getElementById('priceLbl');
const posLbl         = document.getElementById('posLbl');
const pnlLbl         = document.getElementById('pnlLbl');
const avgLbl         = document.getElementById('avgLbl');
const chartModeBadge = document.getElementById('chartModeBadge');
const connectionBadge= document.getElementById('connectionBadge');
const phaseBadge     = document.getElementById('phaseBadge');
const pauseBadge     = document.getElementById('pauseBadge');
const bookBody       = document.getElementById('bookBody');
const darkBookBody   = document.getElementById('darkBookBody');
const myOrdersBookBody = document.getElementById('myOrdersBookBody');
const bookSpreadLbl  = document.getElementById('bookSpread');
const bookModeBadge  = document.getElementById('bookModeBadge');
const bookScrollToggle = document.getElementById('bookScrollToggle');
const bookTabs       = Array.from(document.querySelectorAll('.book-tab'));
const joinFullscreenBtn = document.getElementById('joinFullscreenBtn');
const waitFullscreenBtn = document.getElementById('waitFullscreenBtn');
const gameFullscreenBtn = document.getElementById('gameFullscreenBtn');
const fullscreenButtons = [joinFullscreenBtn, waitFullscreenBtn, gameFullscreenBtn].filter(Boolean);
const introModal     = document.getElementById('introModal');
const introOpenBtn   = document.getElementById('introOpenBtn');
const introCloseBtn  = document.getElementById('introCloseBtn');
const introDismissBtn= document.getElementById('introDismissBtn');
const taskRoleName   = document.getElementById('taskRoleName');
const taskRoleOrg    = document.getElementById('taskRoleOrg');
const taskList       = document.getElementById('taskList');
const taskEmpty      = document.getElementById('taskEmpty');
const taskNextTimer  = document.getElementById('taskNextTimer');
const taskLastResult = document.getElementById('taskLastResult');
const taskTabs       = Array.from(document.querySelectorAll('[data-task-tab]'));
const taskViews      = Array.from(document.querySelectorAll('[data-task-view]'));
const scoreboardEl   = document.getElementById('scoreboard');

const chartContainer = document.getElementById('chart');
let chartApi = null;
let candleSeriesApi = null;
let avgPriceLineCandle = null;
let chartResizeObserver = null;

const buyBtn         = document.getElementById('buyBtn');
const sellBtn        = document.getElementById('sellBtn');
const quantityInput  = document.getElementById('quantityInput');
const priceInput     = document.getElementById('priceInput');
const limitPriceRow  = document.getElementById('limitPriceRow');
const aggressivenessRow = document.getElementById('aggressivenessRow');
const aggressivenessInput = document.getElementById('aggressivenessInput');
const cancelAllBtn   = document.getElementById('cancelAllBtn');
const closeAllBtn    = document.getElementById('closeAllBtn');
const closeAllModal  = document.getElementById('closeAllModal');
const closeAllConfirmBtn = document.getElementById('closeAllConfirmBtn');
const closeAllDismissBtn = document.getElementById('closeAllDismissBtn');
const tradeStatus    = document.getElementById('tradeStatus');
const openOrdersList = document.getElementById('openOrders');
const orderTypeRadios= Array.from(document.querySelectorAll('input[name="orderType"]'));
const chatLog        = document.getElementById('chatLog');
const chatForm       = document.getElementById('chatForm');
const chatInput      = document.getElementById('chatInput');
const chatTargetList = document.getElementById('chatTargetList');
const chatChannelSummary = document.getElementById('chatChannelSummary');

/* state */
let myId = null;
let myName = '';
let myJoined = false;
let lastPhase = 'lobby';
let prices = [];
let tick = 0;
const markers = [];
let candlePlotData = [];
const MAX_POINTS = 600;
const CANDLE_DURATION_MS = 10000;
const MAX_VISIBLE_CANDLES = 120;
const MAX_CANDLES = 360;
let myAvgCost = 0;
let myPos = 0;
let currentMode = 'news';
let lastBookSnapshot = null;
let lastDarkSnapshot = null;
let lastDarkOrders = [];
let lastOrdersSnapshot = null;
let myOrders = [];
let orderType = 'market';
const chatMessages = [];
let statusTimer = null;
const MAX_BOOK_DEPTH = 30;
let autoScrollBook = true;
let lastBookLevels = new Map();
let lastTradedPrice = null;
const candleSeries = [];
let lastCandle = null;
let lastTickTimestamp = null;
let avgTickInterval = 250;
let ticksPerCandle = Math.max(1, Math.round(CANDLE_DURATION_MS / Math.max(1, avgTickInterval)));
let lastPointTime = null;
let bookTickSize = 0.25;
let currentBookView = 'dom';
let currentRole = null;
let activeTask = null;
let taskHistory = [];
let taskIndex = 0;
let taskClock = null;
let nextTaskTimeout = null;
let nextTaskAt = null;
let rosterPlayers = [];

/* ui helpers */
function show(node){ if(node) node.classList.remove('hidden'); }
function hide(node){ if(node) node.classList.add('hidden'); }
function clamp(value, min, max){ return Math.max(min, Math.min(max, value)); }
function lerp(start, end, t){ return start + (end - start) * t; }

const ROLE_PRESETS = [
  {
    id: 'broker',
    roleName: 'Broker trader',
    flavor: 'Agency execution',
    organization: 'Cantor Fitzgerald',
    contacts: [
      { name: 'Sophie Lang', title: 'Agency Head', org: 'Cantor Fitzgerald' },
      { name: 'Marcus Hill', title: 'Execution Lead', org: 'Cantor Fitzgerald' },
      { name: 'Priya Desai', title: 'Senior Broker', org: 'Cantor Fitzgerald' },
    ],
    messages: [
      'Client needs a clean print with minimal footprint.',
      'Work this order quietly and keep the spread tight.',
      'Keep slippage controlled and report progress.',
    ],
  },
  {
    id: 'investment-bank',
    roleName: 'Investment bank trader',
    flavor: 'Client flow',
    organization: 'Goldman Sachs',
    contacts: [
      { name: 'Evan Park', title: 'Flow Trader', org: 'Goldman Sachs' },
      { name: 'Lena Ortiz', title: 'Block Desk', org: 'Goldman Sachs' },
      { name: 'Chris Madsen', title: 'Client Exec', org: 'Goldman Sachs' },
    ],
    messages: [
      'Client flow incoming — keep it efficient.',
      'We need this executed with minimal drift.',
      'Stay inside the spread and move fast.',
    ],
  },
  {
    id: 'hedge-fund',
    roleName: 'Hedge fund trader',
    flavor: 'PM-driven execution',
    organization: 'Citadel',
    contacts: [
      { name: 'Ari Kaplan', title: 'Portfolio Manager', org: 'Citadel' },
      { name: 'Noah Kim', title: 'PM Associate', org: 'Citadel' },
      { name: 'Elena Ruiz', title: 'Execution Trader', org: 'Citadel' },
    ],
    messages: [
      'PM wants this filled with discretion.',
      'Stay tight on price and speed.',
      'Hit the target without tipping the market.',
    ],
  },
];

const TASK_DIFFICULTIES = [
  { key: 'Intro', qtyRange: [30, 80], timeLimitSec: 240, priceTicks: 0, requiresAvg: false },
  { key: 'Easy', qtyRange: [80, 160], timeLimitSec: 210, priceTicks: 0, requiresAvg: false },
  { key: 'Medium', qtyRange: [180, 320], timeLimitSec: 150, priceTicks: 1, requiresAvg: true },
  { key: 'Hard', qtyRange: [320, 520], timeLimitSec: 95, priceTicks: 2, requiresAvg: true },
  { key: 'Professional', qtyRange: [520, 900], timeLimitSec: 70, priceTicks: 3, requiresAvg: true },
];

const TASK_VOICE_PLACEHOLDER = 'Voice line placeholder — pending script.';

function algoSettingsFromAggressiveness(qty, aggressiveness){
  const safeAgg = clamp(Number.isFinite(aggressiveness) ? aggressiveness : 50, 0, 100);
  const normalized = safeAgg / 100;
  const passiveSlicePct = lerp(0.1, 0.03, normalized);
  const passiveSliceQty = Math.max(1, Math.round(qty * passiveSlicePct));
  const burstEveryTicks = Math.max(1, Math.round(lerp(8, 1, normalized)));
  const capPerBurst = Math.max(1, Math.round(qty * lerp(0.05, 0.4, normalized)));
  const participationRate = Number(lerp(0, 0.9, normalized).toFixed(2));

  return {
    aggressiveness: safeAgg,
    passiveSliceQty,
    burstEveryTicks,
    capPerBurst,
    participationRate,
  };
}

function isFullscreenActive(){
  return Boolean(document.fullscreenElement);
}

function syncFullscreenButtons(){
  const active = isFullscreenActive();
  fullscreenButtons.forEach((btn) => {
    btn.dataset.active = active ? 'true' : 'false';
    btn.textContent = active ? 'Exit Fullscreen' : 'Enter Fullscreen';
  });
}

async function toggleFullscreen(){
  const target = document.documentElement;
  if (!target || typeof target.requestFullscreen !== 'function') return;
  try {
    if (isFullscreenActive()) {
      if (typeof document.exitFullscreen === 'function') {
        await document.exitFullscreen();
      }
    } else {
      await target.requestFullscreen();
    }
  } catch (err) {
    console.error('Fullscreen request failed', err);
  } finally {
    syncFullscreenButtons();
  }
}

function ensureChart(){
  if (chartApi || !chartContainer || typeof LightweightCharts === 'undefined') {
    return;
  }
  chartContainer.innerHTML = '';
  chartApi = LightweightCharts.createChart(chartContainer, {
    layout: {
      background: { color: '#0d1423' },
      textColor: '#d5e7ff',
      fontSize: 12,
      fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif',
    },
    grid: {
      vertLines: { color: 'rgba(109,168,255,0.12)' },
      horzLines: { color: 'rgba(109,168,255,0.12)' },
    },
    rightPriceScale: {
      borderVisible: false,
      scaleMargins: { top: 0.1, bottom: 0.18 },
    },
    timeScale: {
      borderVisible: false,
      rightOffset: 4,
      barSpacing: 10,
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
    },
    localization: {
      priceFormatter: (price) => formatPrice(price),
    },
    autoSize: false,
  });
  candleSeriesApi = chartApi.addCandlestickSeries({
    upColor: '#2ecc71',
    downColor: '#ff5c5c',
    borderVisible: false,
    wickUpColor: '#2ecc71',
    wickDownColor: '#ff5c5c',
    priceLineVisible: false,
  });

  candleSeriesApi.setData(candlePlotData);
  updateAveragePriceLine();
  syncMarkers();

  if (!chartResizeObserver && typeof ResizeObserver === 'function') {
    chartResizeObserver = new ResizeObserver(() => {
      resizeChart();
    });
    const target = chartContainer.parentElement || chartContainer;
    chartResizeObserver.observe(target);
  }

  resizeChart();
}

function resizeChart(){
  if (!chartApi || !chartContainer) return;
  const wrap = chartContainer.parentElement || chartContainer;
  const width = Math.max(320, Math.floor(wrap.clientWidth || chartContainer.clientWidth || 320));
  const height = Math.max(260, Math.floor(width * 0.48));
  chartContainer.style.height = `${height}px`;
  chartApi.applyOptions({ width, height });
  chartApi.timeScale().scrollToRealTime();
}

function resetCandles(){
  candleSeries.length = 0;
  lastCandle = null;
  lastTickTimestamp = null;
  avgTickInterval = 250;
  ticksPerCandle = Math.max(1, Math.round(CANDLE_DURATION_MS / Math.max(1, avgTickInterval)));
}

function trimCandles(){
  if (candleSeries.length > MAX_CANDLES) {
    candleSeries.splice(0, candleSeries.length - MAX_CANDLES);
  }
  lastCandle = candleSeries.at(-1) ?? null;
}

function seedInitialCandle(price){
  resetCandles();
  if (!Number.isFinite(price)) return;
  const now = Date.now();
  lastTickTimestamp = now;
  const bucket = Math.floor(now / CANDLE_DURATION_MS);
  const startMs = bucket * CANDLE_DURATION_MS;
  const candle = {
    bucket,
    startMs,
    endMs: now,
    startTick: 0,
    endTick: 0,
    open: price,
    high: price,
    low: price,
    close: price,
    count: 1,
    complete: false,
  };
  candleSeries.push(candle);
  trimCandles();
}

function updateCandleSeries(price, tickIndex, timestamp){
  if (!Number.isFinite(price)) return { changed: false, newBucket: false };
  const now = Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now();
  if (lastTickTimestamp !== null) {
    const delta = Math.max(1, now - lastTickTimestamp);
    avgTickInterval = avgTickInterval * 0.85 + delta * 0.15;
    ticksPerCandle = Math.max(1, Math.round(CANDLE_DURATION_MS / Math.max(1, avgTickInterval)));
  }
  lastTickTimestamp = now;

  const bucket = Math.floor(now / CANDLE_DURATION_MS);
  lastCandle = candleSeries.at(-1) ?? null;
  if (!lastCandle || bucket > lastCandle.bucket) {
    if (lastCandle) {
      if (!Number.isFinite(lastCandle.endTick)) lastCandle.endTick = tickIndex - 1;
      if (!Number.isFinite(lastCandle.endMs)) lastCandle.endMs = lastCandle.startMs + CANDLE_DURATION_MS;
      lastCandle.complete = true;
    }

    let prevClose = lastCandle ? lastCandle.close : price;
    let prevEndTick = lastCandle && Number.isFinite(lastCandle.endTick)
      ? lastCandle.endTick
      : (lastCandle ? lastCandle.startTick ?? tickIndex - 1 : tickIndex - 1);

    const startBucket = lastCandle ? lastCandle.bucket + 1 : bucket;
    for (let b = startBucket; b < bucket; b += 1) {
      const fillerStartTick = prevEndTick + 1;
      const fillerEndTick = fillerStartTick + Math.max(1, ticksPerCandle) - 1;
      prevEndTick = fillerEndTick;
      const filler = {
        bucket: b,
        startMs: b * CANDLE_DURATION_MS,
        endMs: (b + 1) * CANDLE_DURATION_MS,
        startTick: fillerStartTick,
        endTick: fillerEndTick,
        open: prevClose,
        high: prevClose,
        low: prevClose,
        close: prevClose,
        count: 0,
        complete: true,
      };
      candleSeries.push(filler);
      prevClose = filler.close;
    }

    const openPrice = Number.isFinite(prevClose) ? prevClose : price;
    const high = Math.max(openPrice, price);
    const low = Math.min(openPrice, price);
    const candle = {
      bucket,
      startMs: bucket * CANDLE_DURATION_MS,
      endMs: now,
      startTick: tickIndex,
      endTick: tickIndex,
      open: openPrice,
      high,
      low,
      close: price,
      count: 1,
      complete: false,
    };
    candleSeries.push(candle);
    trimCandles();
    lastCandle = candleSeries.at(-1) ?? null;
    return { changed: true, newBucket: true };
  }

  if (bucket < lastCandle.bucket) {
    return { changed: false, newBucket: false };
  }

  lastCandle.endTick = tickIndex;
  lastCandle.endMs = now;
  lastCandle.close = price;
  lastCandle.count = (lastCandle.count || 0) + 1;
  if (price > lastCandle.high) lastCandle.high = price;
  if (price < lastCandle.low) lastCandle.low = price;
  return { changed: true, newBucket: false };
}

function tickDecimals(value){
  if (!Number.isFinite(value)) return 0;
  const text = value.toString();
  if (text.includes('e-')) {
    const [, exp] = text.split('e-');
    return Math.max(0, Number(exp) || 0);
  }
  const parts = text.split('.');
  return parts[1] ? parts[1].length : 0;
}

function getTickSize(){
  return Number.isFinite(bookTickSize) && bookTickSize > 0 ? bookTickSize : 0.25;
}

function snapPriceValue(value){
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const tickSize = getTickSize();
  const snapped = Math.round(num / tickSize) * tickSize;
  return Number(snapped.toFixed(tickDecimals(tickSize)));
}

function formatPrice(value){
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const tickSize = getTickSize();
  return snapPriceValue(num).toFixed(tickDecimals(tickSize));
}

function roundPrice(value){
  return snapPriceValue(value);
}

function nextPointTime(timestamp){
  const base = Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now();
  let seconds = Math.floor(base / 1000);
  if (lastPointTime !== null && seconds <= lastPointTime) {
    seconds = lastPointTime + 1;
  }
  lastPointTime = seconds;
  return seconds;
}

function syncCandleSeriesData(options = {}){
  if (!candleSeriesApi) return;
  const { shouldScroll = false } = options;
  const mapped = candleSeries
    .slice(-MAX_VISIBLE_CANDLES)
    .map((candle) => {
      const endMs = Number.isFinite(candle?.endMs)
        ? candle.endMs
        : (Number.isFinite(candle?.startMs) ? candle.startMs + CANDLE_DURATION_MS : Date.now());
      const time = Math.floor(endMs / 1000);
      return {
        time,
        open: roundPrice(candle.open),
        high: roundPrice(candle.high),
        low: roundPrice(candle.low),
        close: roundPrice(candle.close),
      };
  });
  candlePlotData = mapped;
  candleSeriesApi.setData(mapped);
  if (chartApi && shouldScroll) {
    chartApi.timeScale().scrollToRealTime();
  }
}

function syncMarkers(){
  if (!candleSeriesApi) return;
  let source = markers;
  const minTime = candlePlotData[0]?.time;
  if (Number.isFinite(minTime)) {
    source = markers.filter((m) => !Number.isFinite(m.time) || m.time >= minTime);
    if (source.length !== markers.length) {
      markers.length = 0;
      source.forEach((item) => markers.push(item));
    }
  }
  const mapped = source.map((m) => ({
    time: m.time,
    position: m.side > 0 ? 'belowBar' : 'aboveBar',
    color: m.side > 0 ? '#2ecc71' : '#ff5c5c',
    shape: m.side > 0 ? 'arrowUp' : 'arrowDown',
    text: `${m.side > 0 ? 'B' : 'S'} ${formatBookVolume(m.qty || 1)}`,
  }));
  candleSeriesApi.setMarkers(mapped);
}

function updateAveragePriceLine(){
  if (typeof LightweightCharts === 'undefined' || !candleSeriesApi) return;
  if (avgPriceLineCandle) {
    candleSeriesApi.removePriceLine(avgPriceLineCandle);
    avgPriceLineCandle = null;
  }
  const px = Number(myAvgCost || 0);
  if (!myPos || !Number.isFinite(px) || px <= 0) {
    return;
  }
  const color = myPos > 0 ? '#2ecc71' : '#ff5c5c';
  const options = {
    price: roundPrice(px),
    color,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    lineWidth: 1,
    axisLabelVisible: true,
    title: 'Avg',
  };
  avgPriceLineCandle = candleSeriesApi.createPriceLine(options);
}

function clearSeries(){
  prices = [];
  tick = 0;
  markers.length = 0;
  lastTradedPrice = null;
  resetCandles();
  candlePlotData = [];
  lastPointTime = null;
  if (candleSeriesApi) candleSeriesApi.setData(candlePlotData);
  syncMarkers();
}

function prepareNewRound(initialPrice){
  const px = Number.isFinite(+initialPrice) ? +initialPrice : Number(prices.at(-1) ?? 100);
  clearSeries();
  prices.push(px);
  seedInitialCandle(px);
  lastTradedPrice = px;
  lastPointTime = Math.floor(Date.now() / 1000);
  ensureChart();
  syncCandleSeriesData({ shouldScroll: true });
  myAvgCost = 0;
  myPos = 0;
  if (priceLbl) priceLbl.textContent = formatPrice(px);
  if (posLbl) posLbl.textContent = '0';
  if (pnlLbl) pnlLbl.textContent = '0.00';
  if (avgLbl) avgLbl.textContent = '—';
  updateAveragePriceLine();
}

function setTradingEnabled(enabled){
  const controls = [buyBtn, sellBtn, quantityInput, priceInput];
  controls.forEach((el) => { if (el) el.disabled = !enabled; });
  orderTypeRadios.forEach((radio) => { radio.disabled = !enabled; });
}

function showIntroModal(){
  if (introModal) introModal.classList.remove('hidden');
}
function hideIntroModal(){
  if (introModal) introModal.classList.add('hidden');
}

function goLobby(){
  show(joinView); hide(waitView); hide(gameView);
  setTradingEnabled(false);
  setPhaseBadge('lobby');
  setPauseBadge(false);
  stopTaskFlow();
}
function goWaiting(){
  hide(joinView); show(waitView); hide(gameView);
  setTradingEnabled(false);
  setPhaseBadge('lobby');
  setPauseBadge(false);
  stopTaskFlow();
}
function goGame(){
  hide(joinView); hide(waitView); show(gameView);
  setTradingEnabled(true);
  ensureChart();
  resizeChart();
  startTaskFlow();
}

window.addEventListener('resize', () => {
  resizeChart();
  renderActiveBook();
});

function describeMode(mode){
  return mode === 'orderflow' ? 'Volume' : 'News';
}

function updateModeBadges(mode){
  currentMode = mode === 'orderflow' ? 'orderflow' : 'news';
  const label = `${describeMode(currentMode)} Mode`;
  if (bookModeBadge) {
    bookModeBadge.textContent = label;
    bookModeBadge.dataset.mode = currentMode;
  }
  if (chartModeBadge) {
    chartModeBadge.textContent = label;
    chartModeBadge.dataset.mode = currentMode;
  }
}

function formatExposure(value){
  const num = Number(value || 0);
  const abs = Math.abs(num);
  if (!Number.isFinite(num) || abs < 1e-4) return '0';
  if (abs >= 100) return num.toFixed(0);
  if (abs >= 10) return num.toFixed(1);
  if (abs >= 1) return num.toFixed(2);
  return num.toFixed(3);
}

function setPhaseBadge(phase){
  if (!phaseBadge) return;
  const label = phase === 'running' ? 'Running' : phase === 'lobby' ? 'Lobby' : 'Paused';
  phaseBadge.textContent = `Phase: ${label}`;
  phaseBadge.dataset.phase = phase;
}

function setPauseBadge(paused){
  if (!pauseBadge) return;
  pauseBadge.dataset.paused = paused ? 'true' : 'false';
  pauseBadge.textContent = paused ? 'Paused' : 'Live';
}

function setConnectionBadge(state){
  if (!connectionBadge) return;
  connectionBadge.dataset.state = state;
  switch (state) {
    case 'connected':
      connectionBadge.textContent = 'Connected';
      break;
    case 'error':
      connectionBadge.textContent = 'Connection Error';
      break;
    default:
      connectionBadge.textContent = 'Connecting…';
  }
}

function formatVolume(value){
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '0.00';
  if (Math.abs(num) >= 100) return num.toFixed(0);
  if (Math.abs(num) >= 10) return num.toFixed(1);
  return num.toFixed(2);
}

function hashString(input){
  const str = String(input ?? '');
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function ownerColorFromId(ownerId){
  if (!ownerId) return '#6da8ff';
  const hue = hashString(ownerId) % 360;
  return `hsl(${hue} 70% 65%)`;
}

function formatElapsed(ms){
  const totalSeconds = Math.max(0, Math.floor((ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatBookVolume(value){
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '0';
  const rounded = Math.round(num);
  if (rounded === 0 && num > 0) return '1';
  return Math.max(0, rounded).toString();
}

function randomBetween(min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.floor(low + Math.random() * (high - low + 1));
}

function pickRandom(list = []) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function formatTaskCountdown(msRemaining) {
  if (!Number.isFinite(msRemaining)) return '—';
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function assignRoleIfNeeded() {
  if (currentRole) return;
  const role = pickRandom(ROLE_PRESETS) ?? ROLE_PRESETS[0];
  currentRole = role;
  if (taskRoleName) taskRoleName.textContent = `${role.roleName} (${role.flavor})`;
  if (taskRoleOrg) taskRoleOrg.textContent = role.organization;
}

function resetTaskState() {
  activeTask = null;
  taskHistory = [];
  taskIndex = 0;
  nextTaskAt = null;
  if (nextTaskTimeout) {
    clearTimeout(nextTaskTimeout);
    nextTaskTimeout = null;
  }
  if (taskClock) {
    clearInterval(taskClock);
    taskClock = null;
  }
  if (taskLastResult) taskLastResult.textContent = '—';
  if (taskNextTimer) taskNextTimer.textContent = '—';
  renderTaskPanel();
  renderScoreboard();
}

function startTaskFlow() {
  assignRoleIfNeeded();
  if (!taskClock) {
    taskClock = setInterval(updateTaskTimers, 1000);
  }
  if (!activeTask && !nextTaskAt && myJoined && lastPhase === 'running') {
    scheduleNextTask({ delaySec: randomBetween(5, 12) });
  }
  renderTaskPanel();
}

function stopTaskFlow() {
  if (nextTaskTimeout) {
    clearTimeout(nextTaskTimeout);
    nextTaskTimeout = null;
  }
  if (taskClock) {
    clearInterval(taskClock);
    taskClock = null;
  }
  nextTaskAt = null;
  renderTaskPanel();
}

function setTaskTab(tab) {
  taskTabs.forEach((btn) => {
    const active = btn.dataset.taskTab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  taskViews.forEach((view) => {
    view.classList.toggle('hidden', view.dataset.taskView !== tab);
  });
}

function scheduleNextTask({ delaySec } = {}) {
  if (nextTaskTimeout) clearTimeout(nextTaskTimeout);
  const delay = Number.isFinite(delaySec) ? delaySec : randomBetween(10, 30);
  nextTaskAt = Date.now() + delay * 1000;
  if (taskNextTimer) taskNextTimer.textContent = formatTaskCountdown(delay * 1000);
  nextTaskTimeout = setTimeout(() => {
    nextTaskTimeout = null;
    nextTaskAt = null;
    allocateTask();
  }, delay * 1000);
}

function pickDifficulty() {
  const index = Math.min(taskIndex, TASK_DIFFICULTIES.length - 1);
  return TASK_DIFFICULTIES[index];
}

function getArrivalPrice() {
  if (Number.isFinite(lastTradedPrice)) return lastTradedPrice;
  const labelPrice = Number(priceLbl?.textContent);
  if (Number.isFinite(labelPrice)) return labelPrice;
  return 100;
}

function buildTask() {
  const role = currentRole ?? ROLE_PRESETS[0];
  const difficulty = pickDifficulty();
  const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
  const qty = randomBetween(difficulty.qtyRange[0], difficulty.qtyRange[1]);
  const arrivalPrice = getArrivalPrice();
  const tickSize = getTickSize();
  const offset = (difficulty.priceTicks || 0) * tickSize;
  const requiredAvgPrice = difficulty.requiresAvg
    ? side === 'BUY'
      ? arrivalPrice - offset
      : arrivalPrice + offset
    : null;
  const contact = pickRandom(role.contacts) ?? role.contacts[0];
  const message = pickRandom(role.messages) ?? 'Stay tight on execution.';
  const createdAt = Date.now();
  return {
    id: `task-${createdAt}-${Math.random().toString(16).slice(2, 6)}`,
    difficulty: difficulty.key,
    sender: contact,
    message,
    side,
    targetQty: qty,
    filledQty: 0,
    avgFillPrice: null,
    arrivalPrice,
    requiredAvgPrice,
    createdAt,
    expiresAt: createdAt + difficulty.timeLimitSec * 1000,
    timeLimitSec: difficulty.timeLimitSec,
    status: 'active',
    voiceLine: TASK_VOICE_PLACEHOLDER,
  };
}

function allocateTask() {
  if (!myJoined || lastPhase !== 'running') return;
  activeTask = buildTask();
  taskIndex += 1;
  renderTaskPanel();
}

function updateTaskTimers() {
  if (activeTask && activeTask.status !== 'completed') {
    const remaining = activeTask.expiresAt - Date.now();
    if (remaining <= 0 && activeTask.status === 'active') {
      activeTask.status = 'expired';
    }
  }
  if (taskNextTimer) {
    if (nextTaskAt) {
      taskNextTimer.textContent = formatTaskCountdown(nextTaskAt - Date.now());
    } else {
      taskNextTimer.textContent = activeTask ? 'On completion' : '—';
    }
  }
  renderTaskPanel();
}

function applyTaskFill({ qty, price }) {
  if (!activeTask || activeTask.status === 'completed') return;
  const side = qty > 0 ? 'BUY' : 'SELL';
  if (side !== activeTask.side) return;
  const fillQty = Math.abs(qty);
  const prevQty = activeTask.filledQty;
  const nextQty = prevQty + fillQty;
  const prevAvg = activeTask.avgFillPrice ?? price;
  const nextAvg = ((prevAvg * prevQty) + price * fillQty) / Math.max(1, nextQty);
  activeTask.filledQty = nextQty;
  activeTask.avgFillPrice = nextAvg;
  renderTaskPanel();
}

function calculateMarketEfficiency(task) {
  if (!task) return 0;
  if (!task.requiredAvgPrice) return 100;
  if (!Number.isFinite(task.avgFillPrice)) return 0;
  if (task.side === 'BUY') {
    if (task.avgFillPrice <= task.requiredAvgPrice) return 100;
    return clamp((task.requiredAvgPrice / task.avgFillPrice) * 100, 0, 100);
  }
  if (task.avgFillPrice >= task.requiredAvgPrice) return 100;
  return clamp((task.avgFillPrice / task.requiredAvgPrice) * 100, 0, 100);
}

function calculatePerformancePnl(task) {
  if (!task?.requiredAvgPrice || !Number.isFinite(task.avgFillPrice)) return 0;
  const qty = task.filledQty;
  if (task.side === 'BUY') {
    return (task.requiredAvgPrice - task.avgFillPrice) * qty;
  }
  return (task.avgFillPrice - task.requiredAvgPrice) * qty;
}

function completeTask() {
  if (!activeTask || activeTask.status === 'completed') return;
  const now = Date.now();
  const remaining = activeTask.expiresAt - now;
  const timeLimitSec = activeTask.timeLimitSec;
  const completionScore = clamp((activeTask.filledQty / activeTask.targetQty) * 100, 0, 100);
  const speedScore = remaining > 0 ? 100 : 0;
  const marketEfficiencyScore = calculateMarketEfficiency(activeTask);
  const performancePnl = calculatePerformancePnl(activeTask);
  const commission = 0;
  const totalPnl = performancePnl + commission;
  const result = {
    id: activeTask.id,
    difficulty: activeTask.difficulty,
    completionScore,
    speedScore,
    marketEfficiencyScore,
    commission,
    pnl: totalPnl,
    filledQty: activeTask.filledQty,
    targetQty: activeTask.targetQty,
    completedAt: now,
  };
  taskHistory.push(result);
  activeTask.status = 'completed';
  activeTask = null;
  if (taskLastResult) {
    taskLastResult.textContent = `${result.difficulty} · ${completionScore.toFixed(0)}% complete · ${totalPnl.toFixed(2)} PnL`;
  }
  renderTaskPanel();
  renderScoreboard();
  const baseDelay = randomBetween(10, 30);
  const bonus = Math.round(clamp((remaining / (timeLimitSec * 1000)) * 10, 0, 10));
  const delay = clamp(baseDelay - bonus, 5, 30);
  scheduleNextTask({ delaySec: delay });
}

function renderTaskPanel() {
  if (!taskList) return;
  taskList.innerHTML = '';
  if (!activeTask) {
    if (taskEmpty) taskEmpty.classList.remove('hidden');
    return;
  }
  if (taskEmpty) taskEmpty.classList.add('hidden');
  const task = activeTask;
  const remainingMs = task.expiresAt - Date.now();
  const progressPct = clamp((task.filledQty / task.targetQty) * 100, 0, 100);
  const requiredAvgLabel = task.requiredAvgPrice ? formatPrice(task.requiredAvgPrice) : 'Not required';
  const avgFillLabel = Number.isFinite(task.avgFillPrice) ? formatPrice(task.avgFillPrice) : '—';
  const statusLabel = task.status === 'expired' ? 'Expired' : 'Active';
  const badgeClass = task.side === 'BUY' ? 'buy' : 'sell';
  const card = document.createElement('div');
  card.className = `task-card ${task.status === 'expired' ? 'expired' : ''}`;
  card.innerHTML = `
    <div class="task-card-header">
      <div class="task-card-title">
        <span>${task.sender.name} · ${task.sender.title}</span>
        <span class="muted">${task.sender.org}</span>
      </div>
      <span class="task-badge ${badgeClass}">${task.side}</span>
    </div>
    <div class="task-message">${task.message}</div>
    <div class="task-detail-grid">
      <div><span class="label">Difficulty</span><br /><strong>${task.difficulty}</strong></div>
      <div><span class="label">Status</span><br /><strong>${statusLabel}</strong></div>
      <div><span class="label">Target</span><br /><strong>${formatVolume(task.targetQty)}</strong></div>
      <div><span class="label">Filled</span><br /><strong>${formatVolume(task.filledQty)}</strong></div>
      <div><span class="label">Time left</span><br /><strong>${formatTaskCountdown(remainingMs)}</strong></div>
      <div><span class="label">Arrival</span><br /><strong>${formatPrice(task.arrivalPrice)}</strong></div>
      <div><span class="label">Required avg</span><br /><strong>${requiredAvgLabel}</strong></div>
      <div><span class="label">Avg fill</span><br /><strong>${avgFillLabel}</strong></div>
    </div>
    <div class="task-rule">Rule: ${task.side === 'BUY' ? 'Avg fill must be below required price.' : 'Avg fill must be above required price.'}</div>
    <div class="task-progress"><span style="width:${progressPct.toFixed(1)}%"></span></div>
    <div class="task-voice">${task.voiceLine}</div>
    <div class="task-actions">
      <button type="button" class="ticket-btn" data-task-complete>Complete</button>
    </div>
  `;
  taskList.appendChild(card);
}

function getScoreAverages() {
  if (!taskHistory.length) return null;
  const totals = taskHistory.reduce(
    (acc, entry) => {
      acc.completion += entry.completionScore;
      acc.speed += entry.speedScore;
      acc.efficiency += entry.marketEfficiencyScore;
      acc.commission += entry.commission;
      acc.pnl += entry.pnl;
      return acc;
    },
    { completion: 0, speed: 0, efficiency: 0, commission: 0, pnl: 0 },
  );
  const count = taskHistory.length;
  const avgCompletion = totals.completion / count;
  const avgSpeed = totals.speed / count;
  const avgEfficiency = totals.efficiency / count;
  const avgCommission = totals.commission / count;
  const finalPct = (avgCompletion + avgSpeed + avgEfficiency) / 3;
  return {
    completion: avgCompletion,
    speed: avgSpeed,
    efficiency: avgEfficiency,
    commission: avgCommission,
    finalPct,
    pnl: totals.pnl,
  };
}

function renderScoreboard() {
  if (!scoreboardEl) return;
  const humans = rosterPlayers.filter((entry) => !entry.isBot);
  if (!humans.length && !myName) {
    scoreboardEl.innerHTML = '<div class="scoreboard-empty">No human players yet.</div>';
    return;
  }
  const averages = getScoreAverages();
  const rows = (humans.length ? humans : [{ name: myName || 'You', isBot: false }]).map((player) => {
    const isMe = player.name === myName;
    if (!isMe || !averages) {
      return {
        name: player.name,
        speed: '—',
        completion: '—',
        efficiency: '—',
        commission: '—',
        finalPct: '—',
        pnl: '—',
      };
    }
    return {
      name: player.name,
      speed: `${averages.speed.toFixed(0)}%`,
      completion: `${averages.completion.toFixed(0)}%`,
      efficiency: `${averages.efficiency.toFixed(0)}%`,
      commission: `${averages.commission.toFixed(2)}`,
      finalPct: `${averages.finalPct.toFixed(0)}%`,
      pnl: `${averages.pnl.toFixed(2)}`,
    };
  });
  const header = `
    <table class="scoreboard-table">
      <thead>
        <tr>
          <th>Player</th>
          <th>Speed</th>
          <th>Completion</th>
          <th>Market efficiency</th>
          <th>Commission</th>
          <th>Final %</th>
          <th>PnL</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
          <tr>
            <td>${row.name}</td>
            <td>${row.speed}</td>
            <td>${row.completion}</td>
            <td>${row.efficiency}</td>
            <td>${row.commission}</td>
            <td>${row.finalPct}</td>
            <td>${row.pnl}</td>
          </tr>`,
          )
          .join('')}
      </tbody>
    </table>`;
  scoreboardEl.innerHTML = header;
}

function syncBookScrollToggle(){
  if (!bookScrollToggle) return;
  bookScrollToggle.textContent = autoScrollBook ? 'Auto Scroll: On' : 'Auto Scroll: Off';
  bookScrollToggle.dataset.state = autoScrollBook ? 'on' : 'off';
}

function renderDepthBook(book, { container, lastLevels, setLastLevels, isActive, emptyMessage, ownOrders, highlightPrice } = {}){
  if (!container) return;
  if (Number.isFinite(book?.tickSize)) {
    bookTickSize = book.tickSize;
    if (priceInput) priceInput.step = bookTickSize.toString();
    if (priceInput?.value && document.activeElement !== priceInput) {
      const snapped = snapPriceValue(priceInput.value);
      priceInput.value = formatPrice(snapped);
    }
  }
  if (!autoScrollBook || !isActive) {
    container.style.setProperty('--book-pad-top', '12px');
    container.style.setProperty('--book-pad-bottom', '12px');
  }
  const ownLevels = new Set((ownOrders || []).map((order) => `${order.side}:${formatPrice(order.price)}`));
  const rawAsks = Array.isArray(book?.asks) ? book.asks.slice(0, MAX_BOOK_DEPTH) : [];
  const rawBids = Array.isArray(book?.bids) ? book.bids.slice(0, MAX_BOOK_DEPTH) : [];
  const asksByPrice = new Map();
  const bidsByPrice = new Map();
  rawAsks.forEach((level) => {
    const price = snapPriceValue(level?.price);
    if (!Number.isFinite(price)) return;
    asksByPrice.set(price, { ...level, price });
  });
  rawBids.forEach((level) => {
    const price = snapPriceValue(level?.price);
    if (!Number.isFinite(price)) return;
    bidsByPrice.set(price, { ...level, price });
  });

  const depthTicks = 50;
  const tickSize = getTickSize();
  const lastReference = Number.isFinite(book?.lastPrice)
    ? book.lastPrice
    : Number.isFinite(book?.midPrice)
    ? book.midPrice
    : null;
  const fallbackBase = Number.isFinite(lastReference) ? snapPriceValue(lastReference) : null;
  const bestBidPrice = Number.isFinite(book?.bestBid)
    ? snapPriceValue(book.bestBid)
    : Number.isFinite(rawBids[0]?.price)
    ? snapPriceValue(rawBids[0].price)
    : Number.isFinite(fallbackBase)
    ? snapPriceValue(fallbackBase - tickSize)
    : null;
  const bestAskPrice = Number.isFinite(book?.bestAsk)
    ? snapPriceValue(book.bestAsk)
    : Number.isFinite(rawAsks[0]?.price)
    ? snapPriceValue(rawAsks[0].price)
    : Number.isFinite(fallbackBase)
    ? snapPriceValue(fallbackBase + tickSize)
    : null;

  if (!Number.isFinite(bestBidPrice) && !Number.isFinite(bestAskPrice)) {
    container.innerHTML = `<div class="book-empty muted">${emptyMessage || 'No resting liquidity'}</div>`;
    setLastLevels?.(new Map());
    if (isActive && bookSpreadLbl) bookSpreadLbl.textContent = 'Spread: —';
    if (autoScrollBook && isActive) {
      const pad = Math.max(32, Math.floor(container.clientHeight / 2));
      container.style.setProperty('--book-pad-top', `${pad}px`);
      container.style.setProperty('--book-pad-bottom', `${pad}px`);
    }
    return;
  }

  const asks = [];
  const bids = [];
  if (Number.isFinite(bestAskPrice)) {
    for (let i = 0; i < depthTicks; i += 1) {
      const price = snapPriceValue(bestAskPrice + i * tickSize);
      const level = asksByPrice.get(price) ?? { price, size: 0, manual: 0 };
      asks.push(level);
    }
  }
  if (Number.isFinite(bestBidPrice)) {
    for (let i = 0; i < depthTicks; i += 1) {
      const price = snapPriceValue(bestBidPrice - i * tickSize);
      const level = bidsByPrice.get(price) ?? { price, size: 0, manual: 0 };
      bids.push(level);
    }
  }

  const volumes = [...asks, ...bids].map((lvl) => Math.max(0, Number(lvl?.size || 0)));
  const maxVol = Math.max(1, ...volumes);
  const prevLevels = lastLevels ?? new Map();
  const nextLevels = new Map();
  const seenPrices = new Set();
  const fragment = document.createDocumentFragment();
  const highlightKey = highlightPrice && Number.isFinite(lastTradedPrice) ? formatPrice(lastTradedPrice) : null;
  let focusRow = null;

  const buildCell = (sideClass, { label, fill, manual, placeholder }) => {
    const span = document.createElement('span');
    span.className = `cell ${sideClass}`;
    const value = document.createElement('span');
    value.className = 'value';
    const text = (label ?? '').toString();
    if (!text || placeholder) {
      span.classList.add('placeholder');
      value.textContent = text || '—';
    } else {
      value.textContent = text;
    }
    span.appendChild(value);
    const fillValue = Number.isFinite(fill) ? Math.max(0, Math.min(100, Number(fill))) : 0;
    span.style.setProperty('--fill', fillValue.toFixed(1));
    if (!placeholder && Number.isFinite(manual) && manual > 0.01) {
      const chip = document.createElement('span');
      chip.className = 'manual-chip';
      chip.textContent = formatVolume(manual);
      span.appendChild(chip);
    }
    return span;
  };

  const appendRow = (side, level, isBest) => {
    if (!level) return;
    const priceNum = Number(level.price);
    if (!Number.isFinite(priceNum)) return;
    const priceStr = formatPrice(priceNum);
    const volume = Math.max(0, Number(level.size || 0));
    const manual = Math.max(0, Number(level.manual || 0));
    const row = document.createElement('div');
    row.className = `orderbook-row ${side}`;
    row.dataset.price = priceStr;
    if (isBest) row.classList.add('best');

    const ownKey = `${side === 'ask' ? 'SELL' : 'BUY'}:${priceStr}`;
    if (ownLevels.has(ownKey)) row.classList.add('own');

    const width = Math.min(100, (volume / maxVol) * 100);

    const sellSpan = side === 'ask'
      ? buildCell('sell', { label: formatBookVolume(volume), fill: width, manual })
      : buildCell('sell', { label: '—', fill: 0, manual: 0, placeholder: true });
    const buySpan = side === 'bid'
      ? buildCell('buy', { label: formatBookVolume(volume), fill: width, manual })
      : buildCell('buy', { label: '—', fill: 0, manual: 0, placeholder: true });

    const priceSpan = document.createElement('span');
    priceSpan.className = 'price';

    const strong = document.createElement('strong');
    strong.textContent = priceStr;
    priceSpan.appendChild(strong);

    row.append(sellSpan, priceSpan, buySpan);

    if (highlightKey && priceStr === highlightKey) {
      row.classList.add('current');
      focusRow = row;
    }

    seenPrices.add(priceStr);

    const levelKey = `${side}:${priceStr}`;
    const rounded = Math.round(volume);
    if ((prevLevels.has(levelKey) && prevLevels.get(levelKey) !== rounded) || (!prevLevels.has(levelKey) && rounded > 0)) {
      row.classList.add('flash');
    }
    nextLevels.set(levelKey, rounded);

    fragment.appendChild(row);
  };

  for (let i = asks.length - 1; i >= 0; i -= 1) {
    const level = asks[i];
    const best = snapPriceValue(level?.price) === snapPriceValue(book.bestAsk);
    appendRow('ask', level, best);
  }

  if (highlightKey && !seenPrices.has(highlightKey)) {
    const midRow = document.createElement('div');
    midRow.className = 'orderbook-row midpoint current';
    midRow.dataset.price = highlightKey;
    const sellSpan = buildCell('sell', { label: '—', fill: 0, placeholder: true });
    const priceSpan = document.createElement('span');
    priceSpan.className = 'price';
    const strong = document.createElement('strong');
    strong.textContent = highlightKey;
    priceSpan.appendChild(strong);
    const buySpan = buildCell('buy', { label: '—', fill: 0, placeholder: true });
    midRow.append(sellSpan, priceSpan, buySpan);
    fragment.appendChild(midRow);
    focusRow = midRow;
  }

  for (let i = 0; i < bids.length; i += 1) {
    const level = bids[i];
    const best = snapPriceValue(level?.price) === snapPriceValue(book.bestBid);
    appendRow('bid', level, best);
  }

  const previousScroll = autoScrollBook || !isActive ? null : container.scrollTop;
  container.innerHTML = '';
  container.appendChild(fragment);
  if (!autoScrollBook && isActive && previousScroll !== null) {
    container.scrollTop = previousScroll;
  }
  setLastLevels?.(nextLevels);

  if (isActive && bookSpreadLbl) {
    const spread = Number(book.spread);
    bookSpreadLbl.textContent = Number.isFinite(spread) && spread > 0
      ? `Spread: ${formatPrice(spread)}`
      : 'Spread: —';
  }

  if (autoScrollBook && isActive) {
    requestAnimationFrame(() => {
      const clientHeight = container.clientHeight || 0;
      const padBase = Math.max(36, Math.min(160, Math.floor(clientHeight * 0.28)));
      container.style.setProperty('--book-pad-top', `${padBase}px`);
      container.style.setProperty('--book-pad-bottom', `${padBase}px`);
      const current = focusRow || container.querySelector('.orderbook-row.current') || container.querySelector('.orderbook-row.best');
      if (current && typeof current.scrollIntoView === 'function') {
        current.scrollIntoView({ block: 'center' });
      } else {
        const midpoint = Math.max(0, (container.scrollHeight - clientHeight) / 2);
        container.scrollTop = midpoint;
      }
    });
  } else {
    container.style.setProperty('--book-pad-top', '12px');
    container.style.setProperty('--book-pad-bottom', '12px');
  }
}

function renderOrderBook(book){
  lastBookSnapshot = book;
  renderDepthBook(book, {
    container: bookBody,
    lastLevels: lastBookLevels,
    setLastLevels: (levels) => { lastBookLevels = levels; },
    isActive: currentBookView === 'dom',
    emptyMessage: 'No resting liquidity',
    ownOrders: myOrders.filter((order) => order.type !== 'dark'),
    highlightPrice: true,
  });
}

function captureActiveInput(container, selectorBuilder){
  if (!container || !container.contains(document.activeElement)) return null;
  const active = document.activeElement;
  if (!active || active.tagName !== 'INPUT') return null;
  const ticket = active.closest('[data-order-id]');
  if (!ticket) return null;
  const selector = selectorBuilder(active);
  if (!selector) return null;
  return {
    orderId: ticket.dataset.orderId,
    selector,
    value: active.value,
    selectionStart: active.selectionStart,
    selectionEnd: active.selectionEnd,
  };
}

function restoreActiveInput(container, state){
  if (!container || !state) return;
  const ticket = container.querySelector(`[data-order-id="${state.orderId}"]`);
  if (!ticket) return;
  const input = ticket.querySelector(state.selector);
  if (!input) return;
  input.value = state.value;
  input.focus({ preventScroll: true });
  if (state.selectionStart != null && typeof input.setSelectionRange === 'function') {
    input.setSelectionRange(state.selectionStart, state.selectionEnd ?? state.selectionStart);
  }
}

function renderDarkBook(book){
  lastDarkSnapshot = book;
  if (!darkBookBody) return;
  const focusState = captureActiveInput(darkBookBody, (active) => {
    if (active.dataset.darkEdit) return `input[data-dark-edit="${active.dataset.darkEdit}"]`;
    if (active.dataset.darkTakeQty != null) return 'input[data-dark-take-qty]';
    return null;
  });
  const incomingOrders = Array.isArray(book?.orders) ? book.orders : null;
  if (incomingOrders) lastDarkOrders = incomingOrders;
  const orders = (incomingOrders ?? lastDarkOrders).filter((order) => Number(order?.remaining ?? 0) > 0);
  darkBookBody.innerHTML = '';
  if (!orders.length) {
    const empty = document.createElement('div');
    empty.className = 'dark-ticket-empty';
    empty.textContent = 'No dark pool orders';
    darkBookBody.appendChild(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'dark-ticket-list';
  orders.forEach((order) => {
    const sideLabel = order.side === 'BUY' ? 'Buy' : 'Sell';
    const sideClass = order.side === 'BUY' ? 'buy' : 'sell';
    const isOwn = order.ownerId && order.ownerId === myId;
    const ownerName = order.ownerName || 'Player';
    const ownerLabel = isOwn ? 'You' : ownerName;
    const ownerColor = isOwn ? 'rgba(255,223,120,0.9)' : ownerColorFromId(order.ownerId);
    const priceLabel = Number.isFinite(order.price) ? formatPrice(order.price) : '—';
    const qtyLabel = formatVolume(order.remaining);
    const ageLabel = order.createdAt ? formatElapsed(Date.now() - order.createdAt) : '—';

    const ticket = document.createElement('div');
    ticket.className = `dark-ticket ${sideClass}${isOwn ? ' own' : ''}`;
    ticket.dataset.orderId = order.id;
    ticket.dataset.side = order.side;
    ticket.dataset.price = order.price;
    ticket.dataset.remaining = order.remaining;
    ticket.style.setProperty('--owner-color', ownerColor);

    const header = document.createElement('div');
    header.className = 'dark-ticket-header';
    const heading = document.createElement('div');
    heading.className = 'dark-ticket-heading';
    const sideBadge = document.createElement('span');
    sideBadge.className = `dark-side-badge ${sideClass}`;
    sideBadge.textContent = sideLabel;
    const owner = document.createElement('span');
    owner.className = 'dark-ticket-owner';
    owner.textContent = ownerLabel;
    heading.append(sideBadge, owner);
    const price = document.createElement('span');
    price.textContent = `@ ${priceLabel}`;
    header.append(heading, price);

    const body = document.createElement('div');
    body.className = 'dark-ticket-body';
    const volume = document.createElement('span');
    volume.textContent = `Volume ${qtyLabel}`;
    const idLabel = document.createElement('span');
    idLabel.textContent = `#${order.id} · ${ageLabel}`;
    body.append(volume, idLabel);

    const actions = document.createElement('div');
    actions.className = 'dark-ticket-actions';
    if (isOwn) {
      actions.innerHTML = `
        <label>
          Price
          <input type="number" step="0.25" min="0" value="${Number.isFinite(order.price) ? order.price : ''}" data-dark-edit="price" />
        </label>
        <label>
          Volume
          <input type="number" step="1" min="1" value="${order.remaining}" data-dark-edit="volume" />
        </label>
        <button type="button" class="ticket-btn full-width" data-dark-update>Update Order</button>
        <button type="button" class="ticket-btn secondary full-width" data-dark-cancel>Close Order</button>
      `;
    } else {
      const maxQty = Math.max(1, Math.round(order.remaining));
      actions.innerHTML = `
        <label>
          Take Volume
          <input type="number" step="1" min="1" max="${maxQty}" value="${maxQty}" data-dark-take-qty />
        </label>
        <button type="button" class="ticket-btn" data-dark-take>Take</button>
      `;
    }

    ticket.append(header, body, actions);
    list.appendChild(ticket);
  });
  darkBookBody.appendChild(list);
  restoreActiveInput(darkBookBody, focusState);
}

function renderMyOrders(orders){
  lastOrdersSnapshot = orders;
  if (!myOrdersBookBody) return;
  const focusState = captureActiveInput(myOrdersBookBody, (active) => {
    if (active.dataset.orderEdit) return `input[data-order-edit="${active.dataset.orderEdit}"]`;
    return null;
  });
  const openOrders = Array.isArray(orders) ? orders : [];
  myOrdersBookBody.innerHTML = '';
  if (!openOrders.length) {
    const empty = document.createElement('div');
    empty.className = 'dark-ticket-empty';
    empty.textContent = 'No open orders';
    myOrdersBookBody.appendChild(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'iceberg-ticket-list';
  openOrders.forEach((order) => {
    const sideLabel = order.side === 'BUY' ? 'Buy' : 'Sell';
    const sideClass = order.side === 'BUY' ? 'buy' : 'sell';
    const priceLabel = Number.isFinite(order.price) ? formatPrice(order.price) : 'Market';
    const remaining = Number(order.remaining ?? 0);
    const totalQty = Number(order.totalQty ?? order.remaining ?? 0);
    const totalLabel = formatVolume(totalQty);
    const remainingLabel = formatVolume(remaining);
    const typeLabel = order.type === 'algo'
      ? 'Bot'
      : order.type === 'iceberg'
        ? 'Iceberg'
        : order.type === 'dark'
          ? 'Dark Pool'
          : order.type === 'market'
            ? 'Market'
            : 'Limit';

    const ticket = document.createElement('div');
    ticket.className = `iceberg-ticket ${sideClass} own`;
    ticket.dataset.orderId = order.id;
    ticket.dataset.side = order.side;
    ticket.dataset.price = Number.isFinite(order.price) ? order.price : '';
    ticket.dataset.orderType = order.type ?? 'limit';
    if (order.type === 'algo') {
      ticket.dataset.passiveSliceQty = order.passiveSliceQty ?? '';
      ticket.dataset.burstEveryTicks = order.burstEveryTicks ?? '';
      ticket.dataset.capPerBurst = order.capPerBurst ?? '';
      ticket.dataset.participationRate = order.participationRate ?? '';
    }

    const header = document.createElement('div');
    header.className = 'dark-ticket-header';
    const side = document.createElement('span');
    side.className = order.side === 'BUY' ? 'side-buy' : 'side-sell';
    side.textContent = `${typeLabel} ${sideLabel}`;
    const price = document.createElement('span');
    price.textContent = `@ ${priceLabel}`;
    header.append(side, price);

    const body = document.createElement('div');
    body.className = 'dark-ticket-body';
    const volume = document.createElement('span');
    volume.textContent = `Initial ${totalLabel} · Remaining ${remainingLabel}`;
    const idLabel = document.createElement('span');
    idLabel.textContent = `#${order.id}`;
    body.append(volume, idLabel);

    const actions = document.createElement('div');
    actions.className = 'dark-ticket-actions';
    const priceInput = Number.isFinite(order.price)
      ? `
        <label>
          Price
          <input type="number" step="0.25" min="0" value="${order.price}" data-order-edit="price" />
        </label>
      `
      : '';
    actions.innerHTML = `
      ${priceInput}
      <label>
        Volume
        <input type="number" step="1" min="1" value="${remaining}" data-order-edit="volume" />
      </label>
      <button type="button" class="ticket-btn full-width" data-order-update>Update Order</button>
      <button type="button" class="ticket-btn secondary full-width" data-order-cancel>Close Order</button>
    `;

    ticket.append(header, body, actions);
    list.appendChild(ticket);
  });
  myOrdersBookBody.appendChild(list);
  restoreActiveInput(myOrdersBookBody, focusState);
}

function renderActiveBook(){
  if (currentBookView === 'dark') {
    renderDarkBook(lastDarkSnapshot);
  } else if (currentBookView === 'orders') {
    renderMyOrders(lastOrdersSnapshot);
  } else {
    renderOrderBook(lastBookSnapshot);
  }
}

function setBookView(view){
  const next = view === 'dark' ? 'dark' : view === 'orders' ? 'orders' : 'dom';
  currentBookView = next;
  bookTabs.forEach((tab) => {
    const active = tab.dataset.view === next;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  if (bookBody) bookBody.classList.toggle('hidden', next !== 'dom');
  if (darkBookBody) darkBookBody.classList.toggle('hidden', next !== 'dark');
  if (myOrdersBookBody) myOrdersBookBody.classList.toggle('hidden', next !== 'orders');
  renderActiveBook();
}

function renderOrders(orders){
  myOrders = Array.isArray(orders) ? orders.filter((order) => order.type !== 'dark') : [];
  lastOrdersSnapshot = myOrders;
  if (currentBookView === 'orders') {
    renderMyOrders(lastOrdersSnapshot);
  }
  if (cancelAllBtn) cancelAllBtn.disabled = !myOrders.length;
  if (!openOrdersList) return;
  if (!myOrders.length) {
    openOrdersList.innerHTML = '<li class="muted empty-order">No resting orders</li>';
    return;
  }
  const rows = myOrders.map((order) => {
    const sideLabel = order.side === 'BUY' ? 'Bid' : 'Ask';
    const sideClass = order.side === 'BUY' ? 'side-buy' : 'side-sell';
    const qty = formatVolume(order.remaining);
    const isIceberg = order.type === 'iceberg';
    const isAlgo = order.type === 'algo';
    const price = Number.isFinite(order.price) ? formatPrice(order.price) : '—';
    const venue = isIceberg ? 'Iceberg' : isAlgo ? 'Algo' : order.type === 'dark' ? 'Dark' : 'Lit';
    const displayQty = isIceberg ? formatVolume(order.displayQty || 0) : null;
    const executed = isIceberg ? formatVolume(order.executed || 0) : null;
    const avgFill = isIceberg && Number.isFinite(order.avgFillPrice) ? formatPrice(order.avgFillPrice) : '—';
    const age = isIceberg && order.createdAt ? formatElapsed(Date.now() - order.createdAt) : null;
    const algoExecuted = isAlgo ? formatVolume(order.executed || 0) : null;
    const algoPassive = isAlgo ? formatVolume(order.executedPassive || 0) : null;
    const algoAggressive = isAlgo ? formatVolume(order.executedAggressive || 0) : null;
    const algoAvg = isAlgo && Number.isFinite(order.avgFillPrice) ? formatPrice(order.avgFillPrice) : '—';
    const algoAge = isAlgo && order.createdAt ? formatElapsed(Date.now() - order.createdAt) : null;
    const meta = isIceberg
      ? `Exec ${executed} · Rem ${qty} · Avg ${avgFill} · ${age}`
      : isAlgo
        ? `Exec ${algoExecuted} · Rem ${qty} · Pass ${algoPassive} · Agg ${algoAggressive} · Avg ${algoAvg} · ${algoAge}`
        : `Remaining ${qty}`;
    return `
      <li class="active-order">
        <div class="order-info">
          <span class="${sideClass}">${venue} ${sideLabel} ${isIceberg ? `${displayQty} shown` : qty}</span>
          <span class="order-meta">${meta}</span>
        </div>
        <span>${price}</span>
        <button type="button" class="order-cancel" data-cancel="${order.id}">✕</button>
      </li>
    `;
  }).join('');
  openOrdersList.innerHTML = rows;
}

function updateTradeStatus(message, tone = 'info'){
  if (!tradeStatus) return;
  tradeStatus.textContent = message || '';
  tradeStatus.dataset.tone = tone;
  if (statusTimer) clearTimeout(statusTimer);
  if (message) {
    statusTimer = setTimeout(() => {
      tradeStatus.textContent = '';
      tradeStatus.dataset.tone = 'info';
    }, 5000);
  }
}

function explainReason(reason){
  switch (reason) {
    case 'position-limit': return 'Position limit reached.';
    case 'bad-price': return 'Enter a valid limit price.';
    case 'bad-quantity': return 'Enter a positive quantity.';
    case 'no-liquidity': return 'No liquidity at that price.';
    case 'not-active': return 'Market is not active.';
    default: return 'Order rejected.';
  }
}

function inferredLimitPrice(side){
  if (lastBookSnapshot) {
    if (side === 'BUY') {
      return Number(lastBookSnapshot.bestBid ?? lastBookSnapshot.midPrice ?? lastBookSnapshot.lastPrice ?? prices.at(-1) ?? 100);
    }
    return Number(lastBookSnapshot.bestAsk ?? lastBookSnapshot.midPrice ?? lastBookSnapshot.lastPrice ?? prices.at(-1) ?? 100);
  }
  return Number(prices.at(-1) ?? 100);
}

function throttleButtons(){
  [buyBtn, sellBtn].forEach((btn) => {
    if (!btn) return;
    btn.disabled = true;
    setTimeout(() => {
      if (myJoined && lastPhase === 'running') btn.disabled = false;
    }, 220);
  });
}

function submitOrder(side){
  if (!myJoined || lastPhase !== 'running') return;
  const qty = Number(quantityInput?.value || 0);
  if (!Number.isFinite(qty) || qty <= 0) {
    updateTradeStatus('Enter a positive quantity.', 'error');
    return;
  }

  const payload = { side, quantity: qty, type: orderType };
  if (orderType === 'limit' || orderType === 'dark' || orderType === 'iceberg') {
    let px = Number(priceInput?.value || 0);
    if (!Number.isFinite(px) || px <= 0) {
      px = inferredLimitPrice(side);
      if (Number.isFinite(px)) {
        priceInput.value = formatPrice(px);
      }
    }
    if (!Number.isFinite(px) || px <= 0) {
      updateTradeStatus('Set a valid limit price.', 'error');
      return;
    }
    px = snapPriceValue(px);
    if (priceInput) priceInput.value = formatPrice(px);
    payload.price = px;
  }
  if (orderType === 'algo') {
    const aggressiveness = Number(aggressivenessInput?.value ?? 50);
    const settings = algoSettingsFromAggressiveness(qty, aggressiveness);
    payload.passiveSliceQty = settings.passiveSliceQty;
    payload.burstEveryTicks = settings.burstEveryTicks;
    payload.capPerBurst = settings.capPerBurst;
    payload.participationRate = settings.participationRate;
    if (aggressivenessInput) aggressivenessInput.value = String(settings.aggressiveness);
  }

  updateTradeStatus('Submitting…', 'info');
  throttleButtons();

  socket.emit('submitOrder', payload, (resp) => {
    if (!resp || !resp.ok) {
      updateTradeStatus(explainReason(resp?.reason), 'error');
      return;
    }

    if (resp.type === 'market') {
      if (resp.filled > 0) {
        const px = formatPrice(resp.price || 0);
        updateTradeStatus(`Filled ${formatVolume(resp.filled)} @ ${px}`, 'success');
      } else if (resp.queued) {
        updateTradeStatus('Order queued.', 'info');
      } else {
        updateTradeStatus('Order completed.', 'success');
      }
      quantityInput.value = '1';
    } else {
      if (resp.filled > 0) {
        const px = formatPrice(resp.price || 0);
        updateTradeStatus(`Filled ${formatVolume(resp.filled)} @ ${px}`, 'success');
      } else {
        const restingLabel = resp.type === 'dark'
          ? 'Dark order resting.'
          : resp.type === 'iceberg'
            ? 'Iceberg resting.'
            : resp.type === 'algo'
              ? 'Algo order live.'
              : 'Order resting.';
        updateTradeStatus(restingLabel, 'info');
      }
      if (resp.resting?.price) {
        priceInput.value = formatPrice(resp.resting.price);
      }
    }
  });
}

function submitDarkOrder(side, price, qty){
  if (!myJoined || lastPhase !== 'running') return;
  const numericQty = Number(qty || 0);
  if (!Number.isFinite(numericQty) || numericQty <= 0) {
    updateTradeStatus('Enter a positive quantity.', 'error');
    return;
  }
  const numericPrice = Number(price || 0);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    updateTradeStatus('Set a valid dark pool price.', 'error');
    return;
  }
  const snapped = snapPriceValue(numericPrice);
  updateTradeStatus('Submitting…', 'info');
  throttleButtons();
  socket.emit('submitOrder', {
    side,
    quantity: numericQty,
    type: 'dark',
    price: snapped,
  }, (resp) => {
    if (!resp || !resp.ok) {
      updateTradeStatus(explainReason(resp?.reason), 'error');
      return;
    }
    if (resp.filled > 0) {
      updateTradeStatus(`Filled ${formatVolume(resp.filled)} @ ${formatPrice(resp.price || snapped)}`, 'success');
    } else {
      updateTradeStatus(resp.resting ? 'Dark order resting.' : 'Order completed.', 'info');
    }
  });
}

function submitIcebergOrder(side, price, qty){
  if (!myJoined || lastPhase !== 'running') return;
  const numericQty = Number(qty || 0);
  if (!Number.isFinite(numericQty) || numericQty <= 0) {
    updateTradeStatus('Enter a positive quantity.', 'error');
    return;
  }
  const numericPrice = Number(price || 0);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    updateTradeStatus('Set a valid iceberg price.', 'error');
    return;
  }
  const snapped = snapPriceValue(numericPrice);
  updateTradeStatus('Submitting…', 'info');
  throttleButtons();
  socket.emit('submitOrder', {
    side,
    quantity: numericQty,
    type: 'iceberg',
    price: snapped,
  }, (resp) => {
    if (!resp || !resp.ok) {
      updateTradeStatus(explainReason(resp?.reason), 'error');
      return;
    }
    if (resp.filled > 0) {
      updateTradeStatus(`Filled ${formatVolume(resp.filled)} @ ${formatPrice(resp.price || snapped)}`, 'success');
    } else {
      updateTradeStatus(resp.resting ? 'Iceberg resting.' : 'Order completed.', 'info');
    }
  });
}

function submitLimitOrder(side, price, qty){
  if (!myJoined || lastPhase !== 'running') return;
  const numericQty = Number(qty || 0);
  if (!Number.isFinite(numericQty) || numericQty <= 0) {
    updateTradeStatus('Enter a positive quantity.', 'error');
    return;
  }
  const numericPrice = Number(price || 0);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    updateTradeStatus('Set a valid limit price.', 'error');
    return;
  }
  const snapped = snapPriceValue(numericPrice);
  updateTradeStatus('Submitting…', 'info');
  throttleButtons();
  socket.emit('submitOrder', {
    side,
    quantity: numericQty,
    type: 'limit',
    price: snapped,
  }, (resp) => {
    if (!resp || !resp.ok) {
      updateTradeStatus(explainReason(resp?.reason), 'error');
      return;
    }
    if (resp.filled > 0) {
      updateTradeStatus(`Filled ${formatVolume(resp.filled)} @ ${formatPrice(resp.price || snapped)}`, 'success');
    } else {
      updateTradeStatus(resp.resting ? 'Order resting.' : 'Order completed.', 'info');
    }
  });
}

function submitMarketOrder(side, qty){
  if (!myJoined || lastPhase !== 'running') return;
  const numericQty = Number(qty || 0);
  if (!Number.isFinite(numericQty) || numericQty <= 0) {
    updateTradeStatus('Enter a positive quantity.', 'error');
    return;
  }
  updateTradeStatus('Submitting…', 'info');
  throttleButtons();
  socket.emit('submitOrder', {
    side,
    quantity: numericQty,
    type: 'market',
  }, (resp) => {
    if (!resp || !resp.ok) {
      updateTradeStatus(explainReason(resp?.reason), 'error');
      return;
    }
    if (resp.filled > 0) {
      updateTradeStatus(`Filled ${formatVolume(resp.filled)} @ ${formatPrice(resp.price || 0)}`, 'success');
    } else if (resp.queued) {
      updateTradeStatus('Order queued.', 'info');
    } else {
      updateTradeStatus('Order completed.', 'success');
    }
  });
}

function submitAlgoOrder(side, qty, settings){
  if (!myJoined || lastPhase !== 'running') return;
  const numericQty = Number(qty || 0);
  if (!Number.isFinite(numericQty) || numericQty <= 0) {
    updateTradeStatus('Enter a positive quantity.', 'error');
    return;
  }
  const defaults = algoSettingsFromAggressiveness(numericQty, Number(aggressivenessInput?.value ?? 50));
  const passiveSliceQty = Number(settings?.passiveSliceQty ?? 0) || defaults.passiveSliceQty;
  const burstEveryTicks = Number(settings?.burstEveryTicks ?? 0) || defaults.burstEveryTicks;
  const capPerBurst = Number(settings?.capPerBurst ?? 0) || defaults.capPerBurst;
  const participationRate = Number.isFinite(Number(settings?.participationRate))
    ? Number(settings?.participationRate)
    : defaults.participationRate;

  updateTradeStatus('Submitting…', 'info');
  throttleButtons();
  socket.emit('submitOrder', {
    side,
    quantity: numericQty,
    type: 'algo',
    passiveSliceQty,
    burstEveryTicks,
    capPerBurst,
    participationRate,
  }, (resp) => {
    if (!resp || !resp.ok) {
      updateTradeStatus(explainReason(resp?.reason), 'error');
      return;
    }
    updateTradeStatus('Algo order live.', 'info');
  });
}

function takeIcebergOrder(side, price, qty){
  if (!myJoined || lastPhase !== 'running') return;
  const numericQty = Number(qty || 0);
  if (!Number.isFinite(numericQty) || numericQty <= 0) {
    updateTradeStatus('Enter a positive quantity.', 'error');
    return;
  }
  const numericPrice = Number(price || 0);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    updateTradeStatus('Set a valid price.', 'error');
    return;
  }
  const snapped = snapPriceValue(numericPrice);
  updateTradeStatus('Submitting…', 'info');
  throttleButtons();
  socket.emit('submitOrder', {
    side,
    quantity: numericQty,
    type: 'limit',
    price: snapped,
  }, (resp) => {
    if (!resp || !resp.ok) {
      updateTradeStatus(explainReason(resp?.reason), 'error');
      return;
    }
    if (resp.filled > 0) {
      updateTradeStatus(`Filled ${formatVolume(resp.filled)} @ ${formatPrice(resp.price || snapped)}`, 'success');
    } else {
      updateTradeStatus('Order resting.', 'info');
    }
  });
}

function cancelOrders(ids){
  socket.emit('cancelOrders', ids || [], (resp) => {
    if (resp?.canceled?.length) {
      updateTradeStatus(`Cancelled ${resp.canceled.length} order(s).`, 'info');
    } else {
      updateTradeStatus('No orders to cancel.', 'error');
    }
  });
}

function cancelAllOrders(){
  socket.emit('cancelAll', (resp) => {
    if (!resp?.ok) {
      updateTradeStatus('Unable to cancel orders.', 'error');
      return;
    }
    const canceledCount = resp?.canceled?.length || 0;
    if (canceledCount) {
      updateTradeStatus(`Cancelled ${canceledCount} order(s).`, 'info');
      return;
    }
    updateTradeStatus('No orders to cancel.', 'error');
  });
}

function closeAllOrders(){
  socket.emit('closeAll', (resp) => {
    if (!resp?.ok) {
      updateTradeStatus('Unable to close out.', 'error');
      return;
    }
    const canceledCount = resp?.canceled?.length || 0;
    const flattenedQty = Math.abs(Number(resp?.flatten?.qty ?? 0));
    if (flattenedQty > 0) {
      updateTradeStatus(`Closed out ${formatVolume(flattenedQty)}.`, 'success');
      return;
    }
    if (resp?.flatten?.queued) {
      updateTradeStatus('Close-out queued.', 'info');
      return;
    }
    if (canceledCount) {
      updateTradeStatus(`Cancelled ${canceledCount} order(s).`, 'info');
      return;
    }
    updateTradeStatus('Nothing to close out.', 'error');
  });
}

function addChatMessage(message){
  if (!message) return;
  chatMessages.push(message);
  if (chatMessages.length > 150) chatMessages.shift();
  renderChat();
}

function renderChat(){
  if (!chatLog) return;
  chatLog.innerHTML = '';
  chatMessages.forEach((msg) => {
    const row = document.createElement('div');
    row.className = 'msg';
    const strong = document.createElement('strong');
    strong.textContent = msg.from || 'Player';
    const span = document.createElement('span');
    span.textContent = `: ${msg.text || ''}`;
    row.appendChild(strong);
    row.appendChild(span);
    chatLog.appendChild(row);
  });
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderChatTargets(){
  if (!chatTargetList || !chatChannelSummary) return;
  chatTargetList.innerHTML = '';
  const allOption = document.createElement('button');
  allOption.type = 'button';
  allOption.className = 'chip-btn';
  allOption.textContent = 'All';
  allOption.dataset.channel = 'all';
  chatTargetList.appendChild(allOption);
  chatChannelSummary.textContent = 'All';
}

/* draw */
/* socket events */
socket.on('connect', ()=>{
  myId = socket.id;
  setConnectionBadge('connected');
  if (myJoined && myName) {
    joinGame(myName, { showPending: false });
  }
});

socket.on('connect_error', ()=>{ setConnectionBadge('error'); });
socket.on('disconnect', ()=>{
  setConnectionBadge('error');
  setTradingEnabled(false);
});

socket.on('phase', (phase)=>{
  lastPhase = phase;
  setPhaseBadge(phase);
  if (!myJoined) { goLobby(); return; }
  if (phase==='running') goGame();
  else if (phase==='lobby') goWaiting();
  else goLobby();
});

function handleJoinAck(ack, { resetButton = true } = {}){
  if (ack && ack.ok) {
    myJoined = true;
    if (ack.orders) renderOrders(ack.orders);
    renderScoreboard();
    if (ack.phase === 'lobby') {
      joinMsg.textContent='Joined — waiting for host…';
      goWaiting();
      setPhaseBadge('lobby');
      setPauseBadge(false);
    } else {
      productLbl.textContent = ack.productName || 'Demo Asset';
      prepareNewRound(ack.price ?? ack.fairValue ?? 100);
      setPhaseBadge('running');
      setPauseBadge(Boolean(ack.paused));
      if (ack.paused) setTradingEnabled(false); else setTradingEnabled(true);
      goGame();
    }
    return;
  }
  myJoined = false;
  if (resetButton) {
    joinBtn.disabled=false; joinBtn.textContent='Join';
  }
  joinMsg.textContent='Join failed. Try again.';
  goLobby();
}

function joinGame(name, { showPending = true } = {}){
  const nm = String(name || nameInput?.value || 'Player').trim() || 'Player';
  myName = nm;
  if (showPending && joinBtn) {
    joinBtn.disabled = true;
    joinBtn.textContent = 'Joining…';
  }
  socket.emit('join', nm, (ack)=>handleJoinAck(ack, { resetButton: showPending }));
}

joinBtn.onclick = ()=> joinGame();

socket.on('playerList', (rows = [])=>{
  const roster = Array.isArray(rows)
    ? rows.map((entry) => ({
        name: entry?.name || 'Player',
        isBot: Boolean(entry?.isBot),
      }))
    : [];
  rosterPlayers = roster;
  renderScoreboard();
  if (rosterUl) {
    rosterUl.innerHTML = '';
    roster.forEach((r)=>{
      const li = document.createElement('li');
      li.textContent = r.isBot ? `${r.name} 🤖` : r.name;
      rosterUl.appendChild(li);
    });
  }
});

socket.on('priceMode', (mode)=>{ updateModeBadges(mode); });

socket.on('orderBook', (book)=>{ renderOrderBook(book); });

socket.on('gameStarted', ({ fairValue, productName, paused, price })=>{
  if (!myJoined) return;
  productLbl.textContent = productName || 'Demo Asset';
  prepareNewRound(price ?? fairValue ?? 100);
  setPhaseBadge('running');
  setPauseBadge(Boolean(paused));
  if (paused) setTradingEnabled(false); else setTradingEnabled(true);
  resetTaskState();
  goGame();
  ensureChart();
  resizeChart();
  renderOrderBook(null);
  renderMyOrders(null);
  renderOrders([]);
});

socket.on('gameReset', ()=>{
  myJoined = false;
  myName = '';
  clearSeries();
  myAvgCost=0; myPos=0;
  setPhaseBadge('lobby');
  setPauseBadge(false);
  currentRole = null;
  if (taskRoleName) taskRoleName.textContent = '—';
  if (taskRoleOrg) taskRoleOrg.textContent = '—';
  resetTaskState();
  if (lastNewsHeadline) lastNewsHeadline.textContent = 'Waiting for news…';
  nameInput.value = '';
  joinBtn.disabled = false; joinBtn.textContent = 'Join';
  if (priceLbl) priceLbl.textContent = '—';
  if (posLbl) posLbl.textContent = '0';
  if (pnlLbl) pnlLbl.textContent = '0.00';
  if (avgLbl) avgLbl.textContent = '—';
  renderOrderBook(null);
  renderMyOrders(null);
  renderOrders([]);
  updateTradeStatus('');
  goLobby();
  ensureChart();
  syncCandleSeriesData({ shouldScroll: true });
  updateAveragePriceLine();
  resizeChart();
});

socket.on('paused', (isPaused)=>{
  setTradingEnabled(!isPaused && myJoined && lastPhase==='running');
  setPauseBadge(Boolean(isPaused));
});

socket.on('news', ({ text, delta })=>{
  if (!newsText || !newsBar) return;
  newsText.textContent = text || '';
  if (lastNewsHeadline) lastNewsHeadline.textContent = text || '—';
  newsBar.style.background = (delta>0) ? '#12361f' : (delta<0) ? '#3a1920' : '#121a2b';
  newsBar.style.transition = 'opacity .3s ease';
  newsBar.style.opacity = '1';
  setTimeout(()=>{ newsBar.style.opacity='0.85'; }, 16000);
});

socket.on('priceUpdate', ({ price, priceMode, t: stamp })=>{
  if (!myJoined) return;
  tick++;
  const numeric = Number(price);
  const timestamp = Number.isFinite(Number(stamp)) ? Number(stamp) : undefined;
  ensureChart();
  nextPointTime(timestamp);
  let candleUpdate = { changed: false, newBucket: false };
  if (Number.isFinite(numeric)) {
    prices.push(numeric);
    if(prices.length>MAX_POINTS) prices.shift();
    lastTradedPrice = numeric;
    if (priceLbl) priceLbl.textContent = formatPrice(numeric);
    candleUpdate = updateCandleSeries(numeric, tick, timestamp) || candleUpdate;
  } else if (prices.length) {
    lastTradedPrice = Number(prices.at(-1));
    if (priceLbl && Number.isFinite(lastTradedPrice)) priceLbl.textContent = formatPrice(lastTradedPrice);
    if (Number.isFinite(lastTradedPrice)) {
      const fallback = updateCandleSeries(lastTradedPrice, tick, timestamp);
      if (fallback) candleUpdate = fallback;
    }
  }
  if (candleUpdate && candleUpdate.changed) {
    syncCandleSeriesData({ shouldScroll: Boolean(candleUpdate.newBucket) });
  }
  if (priceMode) updateModeBadges(priceMode);
  if (lastBookSnapshot || lastDarkSnapshot || lastOrdersSnapshot) renderActiveBook();
  syncMarkers();
});

socket.on('you', ({ position, pnl, avgCost })=>{
  myPos = Number(position || 0);
  myAvgCost = Number(avgCost || 0);
  posLbl.textContent = formatExposure(myPos);
  pnlLbl.textContent = Number(pnl || 0).toFixed(2);
  if (avgLbl) {
    avgLbl.textContent = myAvgCost ? formatPrice(myAvgCost) : '—';
  }
  updateAveragePriceLine();
});

socket.on('execution', ({ qty, price })=>{
  const signedQty = Number(qty || 0);
  const execPrice = Number(price || 0);
  if (!Number.isFinite(signedQty) || !Number.isFinite(execPrice)) return;
  applyTaskFill({ qty: signedQty, price: execPrice });
});

socket.on('tradeMarker', ({ side, px, qty })=>{
  if (!myJoined) return;
  const s = (side==='BUY') ? +1 : -1;
  const time = lastPointTime ?? Math.floor(Date.now()/1000);
  markers.push({ time, price: roundPrice(px), side: s, qty: qty || 1 });
  if (markers.length > 160) markers.shift();
  syncMarkers();
});

socket.on('openOrders', (orders)=>{
  renderOrders(orders || []);
  renderActiveBook();
});

socket.on('chatHistory', (history)=>{
  chatMessages.length = 0;
  (history || []).forEach((msg) => chatMessages.push(msg));
  renderChat();
});

socket.on('chatMessage', (message)=>{
  addChatMessage(message);
});

socket.on('darkBook', (book)=>{
  lastDarkSnapshot = book;
  if (Array.isArray(book?.orders)) lastDarkOrders = book.orders;
  renderDarkBook(book);
});
socket.on('darkOrders', (payload)=>{
  const orders = Array.isArray(payload?.orders)
    ? payload.orders
    : Array.isArray(payload)
      ? payload
      : [];
  lastDarkOrders = orders;
  if (currentBookView === 'dark') {
    renderDarkBook({ ...(lastDarkSnapshot ?? {}), orders });
  }
});

/* form interactions */
orderTypeRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    if (radio.checked) {
      orderType = radio.value;
      if (orderType === 'limit' || orderType === 'dark' || orderType === 'iceberg') {
        limitPriceRow?.classList.remove('hidden');
      } else {
        limitPriceRow?.classList.add('hidden');
        if (tradeStatus) tradeStatus.dataset.tone = 'info';
      }
      if (orderType === 'algo') {
        aggressivenessRow?.classList.remove('hidden');
      } else {
        aggressivenessRow?.classList.add('hidden');
      }
    }
  });
});

bookTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const view = tab.dataset.view;
    if (view) setBookView(view);
  });
});

taskTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const view = tab.dataset.taskTab;
    if (view) setTaskTab(view);
  });
});

if (taskList) {
  taskList.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-task-complete]');
    if (!btn) return;
    completeTask();
  });
}

setTaskTab('tasks');

if (buyBtn) buyBtn.addEventListener('click', () => submitOrder('BUY'));
if (sellBtn) sellBtn.addEventListener('click', () => submitOrder('SELL'));
if (cancelAllBtn) cancelAllBtn.addEventListener('click', () => cancelAllOrders());
if (closeAllBtn) closeAllBtn.addEventListener('click', () => show(closeAllModal));
if (closeAllDismissBtn) closeAllDismissBtn.addEventListener('click', () => hide(closeAllModal));
if (closeAllConfirmBtn) closeAllConfirmBtn.addEventListener('click', () => {
  hide(closeAllModal);
  closeAllOrders();
});

if (openOrdersList) {
  openOrdersList.addEventListener('click', (ev) => {
    const target = ev.target.closest('[data-cancel]');
    if (!target) return;
    const id = target.getAttribute('data-cancel');
    if (id) cancelOrders([id]);
  });
}

if (darkBookBody) {
  darkBookBody.addEventListener('click', (ev) => {
    const takeBtn = ev.target.closest('[data-dark-take]');
    const cancelBtn = ev.target.closest('[data-dark-cancel]');
    const updateBtn = ev.target.closest('[data-dark-update]');
    const ticket = ev.target.closest('.dark-ticket');
    if (!ticket) return;
    const orderId = ticket.dataset.orderId;
    const side = ticket.dataset.side;
    const price = Number(ticket.dataset.price || 0);
    if (takeBtn) {
      const qtyInput = ticket.querySelector('input[data-dark-take-qty]');
      const qty = Number(qtyInput?.value || 0);
      const takeSide = side === 'BUY' ? 'SELL' : 'BUY';
      submitDarkOrder(takeSide, price, qty);
      return;
    }
    if (cancelBtn && orderId) {
      cancelOrders([orderId]);
      return;
    }
    if (updateBtn && orderId) {
      if (!myJoined || lastPhase !== 'running') {
        updateTradeStatus('Market is not active.', 'error');
        return;
      }
      const priceInputEl = ticket.querySelector('input[data-dark-edit="price"]');
      const volumeInputEl = ticket.querySelector('input[data-dark-edit="volume"]');
      const nextPrice = Number(priceInputEl?.value || 0);
      const nextVolume = Number(volumeInputEl?.value || 0);
      if (!Number.isFinite(nextPrice) || nextPrice <= 0 || !Number.isFinite(nextVolume) || nextVolume <= 0) {
        updateTradeStatus('Set a valid price and volume.', 'error');
        return;
      }
      socket.emit('cancelOrders', [orderId], (resp) => {
        if (!resp?.canceled?.length) {
          updateTradeStatus('Unable to update order.', 'error');
          return;
        }
        submitDarkOrder(side, nextPrice, nextVolume);
      });
    }
  });
}

if (myOrdersBookBody) {
  myOrdersBookBody.addEventListener('click', (ev) => {
    const cancelBtn = ev.target.closest('[data-order-cancel]');
    const updateBtn = ev.target.closest('[data-order-update]');
    const ticket = ev.target.closest('.iceberg-ticket');
    if (!ticket) return;
    const orderId = ticket.dataset.orderId;
    const side = ticket.dataset.side;
    const orderType = ticket.dataset.orderType || 'limit';
    const priceInputEl = ticket.querySelector('input[data-order-edit="price"]');
    const volumeInputEl = ticket.querySelector('input[data-order-edit="volume"]');
    const nextPrice = Number(priceInputEl?.value || 0);
    const nextVolume = Number(volumeInputEl?.value || 0);
    if (cancelBtn && orderId) {
      cancelOrders([orderId]);
      return;
    }
    if (updateBtn && orderId) {
      if (!myJoined || lastPhase !== 'running') {
        updateTradeStatus('Market is not active.', 'error');
        return;
      }
      if (!Number.isFinite(nextVolume) || nextVolume <= 0) {
        updateTradeStatus('Set a valid volume.', 'error');
        return;
      }
      if (priceInputEl && (!Number.isFinite(nextPrice) || nextPrice <= 0)) {
        updateTradeStatus('Set a valid price.', 'error');
        return;
      }
      socket.emit('cancelOrders', [orderId], (resp) => {
        if (!resp?.canceled?.length) {
          updateTradeStatus('Unable to update order.', 'error');
          return;
        }
        if (orderType === 'dark') {
          submitDarkOrder(side, nextPrice, nextVolume);
        } else if (orderType === 'iceberg') {
          submitIcebergOrder(side, nextPrice, nextVolume);
        } else if (orderType === 'algo') {
          submitAlgoOrder(side, nextVolume, {
            passiveSliceQty: ticket.dataset.passiveSliceQty,
            burstEveryTicks: ticket.dataset.burstEveryTicks,
            capPerBurst: ticket.dataset.capPerBurst,
            participationRate: ticket.dataset.participationRate,
          });
        } else if (orderType === 'market') {
          submitMarketOrder(side, nextVolume);
        } else {
          submitLimitOrder(side, nextPrice, nextVolume);
        }
      });
    }
  });
}

if (chatForm) {
  chatForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = (chatInput?.value || '').trim();
    if (!text) return;
    const payload = { text };
    socket.emit('chatMessage', payload, (ack) => {
      if (ack?.ok) {
        chatInput.value = '';
      }
    });
  });
}

if (bookScrollToggle) {
  bookScrollToggle.addEventListener('click', () => {
    autoScrollBook = !autoScrollBook;
    syncBookScrollToggle();
    if (autoScrollBook) {
      renderActiveBook();
    }
  });
}

if (introOpenBtn) introOpenBtn.addEventListener('click', showIntroModal);
if (introCloseBtn) introCloseBtn.addEventListener('click', hideIntroModal);
if (introDismissBtn) introDismissBtn.addEventListener('click', hideIntroModal);
if (introModal) {
  introModal.addEventListener('click', (ev) => {
    if (ev.target === introModal) hideIntroModal();
  });
}
if (closeAllModal) {
  closeAllModal.addEventListener('click', (ev) => {
    if (ev.target === closeAllModal) hide(closeAllModal);
  });
}

fullscreenButtons.forEach((btn) => {
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    toggleFullscreen();
  });
});

document.addEventListener('fullscreenchange', () => {
  syncFullscreenButtons();
});

document.addEventListener('fullscreenerror', () => {
  syncFullscreenButtons();
});

/* init */
goLobby();
ensureChart();
resizeChart();
updateModeBadges('news');
renderOrderBook(null);
renderDarkBook(null);
renderMyOrders(null);
renderOrders([]);
renderChat();
renderChatTargets();
updateTradeStatus('');
syncFullscreenButtons();
syncBookScrollToggle();
setConnectionBadge('connecting');
setPhaseBadge('lobby');
setPauseBadge(false);
if (lastNewsHeadline && newsText) lastNewsHeadline.textContent = newsText.textContent || 'Waiting for news…';
setBookView('dom');
setTimeout(showIntroModal, 300);
