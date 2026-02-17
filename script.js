/**
 * Mo Flag Knowledge - Country Flag Spaced Repetition Game
 * SM-2 algorithm, multiple game modes, full persistence
 */

// ==================== Constants ====================
const FLAG_CDNS = [
  'https://flagcdn.com/w320',
  'https://flagcdn.com/256x192',
  'https://flagcdn.com/w160',
];
const STORAGE_KEYS = {
  cards: 'flagmaster_cards',
  stats: 'flagmaster_stats',
  settings: 'flagmaster_settings',
};
const XP_BASE = 10;
const XP_STREAK_BONUS = 5;
const XP_PENALTY = -5;
const NEW_CARDS_PER_SESSION = 15;
const CONTINENT_NEW_CARDS_PER_SESSION = 8;
const SESSION_RETRY_GAPS = [2, 5, 9];
const LEVEL_XP = [0, 100, 250, 500, 850, 1300, 1850, 2500, 3250, 4100, 5050];
const STREAK_MILESTONES = [5, 10, 20, 50, 100, 150];

// ==================== State ====================
let countries = [];
let cards = {}; // code -> SRS card data
let stats = {
  totalScore: 0,
  currentStreak: 0,
  longestStreak: 0,
  totalCorrect: 0,
  totalWrong: 0,
  xp: 0,
  level: 1,
};
let settings = { soundEnabled: true };
let currentMode = 'normal';
let activeImageRequestId = 0;
let gameState = {
  queue: [],
  retryQueue: [],
  currentCountry: null,
  options: [],
  score: 0,
  streak: 0,
  questionCount: 0,
  timer: null,
  timerSeconds: 0,
  answered: false,
};

// ==================== SM-2 Algorithm ====================

/**
 * Initialize or get card data for a country
 */
function getCard(code) {
  if (!cards[code]) {
    cards[code] = {
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      nextReviewDate: null,
      lapses: 0,
    };
  }
  return cards[code];
}

/**
 * SM-2: Process correct answer
 * quality: 3-5 (3=hard, 4=good, 5=easy)
 */
function processCorrect(code, quality = 4) {
  const card = getCard(code);
  const ef = card.easeFactor;
  const q = quality;

  // Ease factor formula
  const newEF = Math.max(
    1.3,
    ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  );
  card.easeFactor = Math.round(newEF * 100) / 100;

  let newInterval;
  if (card.repetitions === 0) {
    newInterval = 1;
  } else if (card.repetitions === 1) {
    newInterval = 6;
  } else {
    newInterval = Math.round(card.interval * card.easeFactor);
  }

  card.interval = newInterval;
  card.repetitions += 1;
  card.nextReviewDate = addDays(new Date(), newInterval);
  return card;
}

/**
 * SM-2: Process incorrect answer
 */
function processIncorrect(code) {
  const card = getCard(code);
  card.repetitions = 0;
  card.interval = 1;
  card.lapses += 1;
  card.easeFactor = Math.max(1.3, card.easeFactor - 0.2);
  card.nextReviewDate = addDays(new Date(), 1);
  return card;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isDue(code) {
  const card = getCard(code);
  if (card.repetitions === 0) return false;
  if (!card.nextReviewDate) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return card.nextReviewDate <= today.getTime();
}

function getDueCount() {
  return countries.filter((c) => isDue(c.code)).length;
}

// ==================== Smart Distractor Selection ====================

/**
 * Get similarity score between two countries (higher = more similar)
 * Heavily favors similar flags (Indonesia/Poland, Chad/Romania, etc.)
 */
function getSimilarityScore(a, b) {
  let score = 0;
  if (a.continent === b.continent) score += 2;
  const aColors = new Set(a.colors.map((c) => c.toLowerCase()));
  const bColors = new Set(b.colors.map((c) => c.toLowerCase()));
  const sharedColors = [...aColors].filter((c) => bColors.has(c)).length;
  score += sharedColors * 2;
  // Same exact color set = very similar flags (Indonesia/Poland/Monaco, etc.)
  if (aColors.size === bColors.size && sharedColors === aColors.size) score += 6;
  if (a.layout === b.layout) score += 3;
  return score;
}

/**
 * Select 3 difficult distractors - prioritizes similar flags (e.g. Indonesia + Poland)
 */
function getDistractors(correctCountry, count = 3) {
  const others = countries.filter((c) => c.code !== correctCountry.code);
  const scored = others.map((c) => ({
    country: c,
    score: getSimilarityScore(correctCountry, c),
  }));
  scored.sort((a, b) => b.score - a.score);
  // Strongly prefer top similar (e.g. Indonesia gets Poland, Monaco)
  const topSimilar = scored.filter((s) => s.score >= 5);
  const pool = topSimilar.length >= count ? topSimilar : scored.slice(0, 25);
  shuffleArray(pool);
  return pool.slice(0, count).map((s) => s.country);
}

/** Fuzzy match for Hard mode: allows "USA" for "United States", minor typos */
function fuzzyMatch(input, correct) {
  if (input === correct) return true;
  const aliases = {
    'usa': 'united states',
    'us': 'united states',
    'uk': 'united kingdom',
    'uae': 'united arab emirates',
    'drc': 'dr congo',
    'car': 'central african republic',
  };
  if (aliases[input] === correct) return true;
  if (correct.includes(input) && input.length >= 4) return true;
  return false;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ==================== Game Logic ====================

function buildQueue() {
  if (currentMode === 'endless' || currentMode === 'timed') {
    return shuffleArray([...countries]);
  }

  const buildSrsQueue = (pool, newPerSession) => {
    const due = pool.filter((c) => isDue(c.code));
    const newCards = pool.filter((c) => getCard(c.code).repetitions === 0);
    shuffleArray(due);
    shuffleArray(newCards);
    const queue = [];
    const used = new Set();
    for (const c of due) {
      if (!used.has(c.code)) {
        queue.push(c);
        used.add(c.code);
      }
    }
    for (let i = 0; i < newPerSession && i < newCards.length; i++) {
      const card = newCards[i];
      if (!used.has(card.code)) {
        queue.push(card);
        used.add(card.code);
      }
    }
    return queue;
  };

  if (currentMode === 'continent') {
    const continent = gameState.selectedContinent;
    const filtered = countries.filter((c) => c.continent === continent);
    return buildSrsQueue(filtered, CONTINENT_NEW_CARDS_PER_SESSION);
  }
  // Normal & Hard: SRS - due cards first, then limited new cards.
  return buildSrsQueue(countries, NEW_CARDS_PER_SESSION);
}

function scheduleSessionRetry(country) {
  const existing = gameState.retryQueue.find((r) => r.code === country.code);
  if (existing) {
    existing.step = 0;
    existing.nextAt = gameState.questionCount + 1;
    return;
  }
  gameState.retryQueue.push({
    code: country.code,
    country,
    step: 0,
    nextAt: gameState.questionCount + SESSION_RETRY_GAPS[0],
  });
}

function popDueRetryCountry() {
  if (!gameState.retryQueue.length) return null;
  gameState.retryQueue.sort((a, b) => a.nextAt - b.nextAt);
  const idx = gameState.retryQueue.findIndex((r) => r.nextAt <= gameState.questionCount);
  if (idx === -1) return null;

  const item = gameState.retryQueue[idx];
  const selected = item.country;
  if (item.step >= SESSION_RETRY_GAPS.length - 1) {
    gameState.retryQueue.splice(idx, 1);
  } else {
    item.step += 1;
    item.nextAt = gameState.questionCount + SESSION_RETRY_GAPS[item.step];
  }
  return selected;
}

function getNextCountry() {
  const retryCountry = popDueRetryCountry();
  if (retryCountry) return retryCountry;

  if (gameState.queue.length === 0) {
    if (currentMode === 'endless' || currentMode === 'timed') {
      gameState.queue = buildQueue();
    } else if (gameState.retryQueue.length > 0) {
      gameState.retryQueue.sort((a, b) => a.nextAt - b.nextAt);
      gameState.retryQueue[0].nextAt = gameState.questionCount;
      return popDueRetryCountry();
    }
  }
  if (gameState.queue.length === 0) return null;
  return gameState.queue.shift();
}

function buildOptions(correct) {
  const distractors = getDistractors(correct);
  const opts = [correct, ...distractors];
  shuffleArray(opts);
  return opts;
}

// ==================== XP & Level ====================

function addXP(amount, isStreakBonus = false) {
  stats.xp += amount;
  if (amount > 0) {
    stats.totalScore += amount;
    if (stats.xp < 0) stats.xp = 0;
  }
  const prevLevel = stats.level;
  stats.level = 1;
  for (let i = LEVEL_XP.length - 1; i >= 0; i--) {
    if (stats.xp >= LEVEL_XP[i]) {
      stats.level = i + 1;
      break;
    }
  }
  return { gained: amount, leveledUp: stats.level > prevLevel };
}

// ==================== Persistence ====================

function loadData() {
  try {
    const c = localStorage.getItem(STORAGE_KEYS.cards);
    if (c) cards = JSON.parse(c);
    const s = localStorage.getItem(STORAGE_KEYS.stats);
    if (s) stats = { ...stats, ...JSON.parse(s) };
    const set = localStorage.getItem(STORAGE_KEYS.settings);
    if (set) settings = { ...settings, ...JSON.parse(set) };
  } catch (e) {
    console.warn('Load failed', e);
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEYS.cards, JSON.stringify(cards));
    localStorage.setItem(STORAGE_KEYS.stats, JSON.stringify(stats));
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  } catch (e) {
    console.warn('Save failed', e);
  }
}

// ==================== DOM & UI ====================

function $(sel) {
  return document.querySelector(sel);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const el = $(`#${id}`);
  if (el) el.classList.add('active');
}

/**
 * In-place feedback: red border on wrong, green on correct. Show correct answer.
 * After ~1s, invoke callback to advance.
 */
function showAnswerFeedback(isCorrect, correctAnswer, selectedName, onComplete) {
  const wrapper = $('#flag-wrapper');
  const optsContainer = $('#options-container');
  const btns = optsContainer?.querySelectorAll('.option-btn');

  if (btns) {
    btns.forEach((btn, i) => {
      if (gameState.options[i]?.name === correctAnswer) {
        btn.classList.add('correct');
      } else if (btn.textContent === selectedName && !isCorrect) {
        btn.classList.add('wrong');
      }
    });
  }
  wrapper.classList.add(isCorrect ? 'correct' : 'wrong');

  setTimeout(() => {
    wrapper.classList.remove('correct', 'wrong');
    if (btns) btns.forEach((b) => { b.classList.remove('correct', 'wrong'); b.disabled = false; });
    const inp = $('#answer-input');
    if (inp) inp.disabled = false;
    onComplete();
  }, 1000);
}

function showCorrectCelebration(xpGained) {
  const container = $('.flag-container');
  if (!container) return;

  const streakEl = $('#game-streak');
  if (streakEl) {
    streakEl.classList.remove('pop');
    void streakEl.offsetWidth;
    streakEl.classList.add('pop');
  }

  const toast = document.createElement('div');
  toast.className = 'xp-toast';
  toast.textContent = `+${xpGained} XP`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 850);

  const burst = document.createElement('div');
  burst.className = 'confetti-burst';
  for (let i = 0; i < 12; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.setProperty('--angle', `${(360 / 12) * i}deg`);
    piece.style.setProperty('--distance', `${56 + Math.floor(Math.random() * 44)}px`);
    piece.style.setProperty('--delay', `${Math.random() * 0.08}s`);
    piece.style.setProperty('--hue', `${Math.floor(Math.random() * 90) + 90}`);
    burst.appendChild(piece);
  }
  container.appendChild(burst);
  setTimeout(() => burst.remove(), 900);
}

function advanceToNextQuestion() {
  nextRound();
}

function updateMenuStats() {
  $('#stat-level').textContent = stats.level;
  $('#stat-xp').textContent = stats.xp;
  $('#stat-streak').textContent = stats.currentStreak;
  $('#stat-due').textContent = getDueCount();
}

function updateGameStats() {
  $('#game-score').textContent = `Score: ${gameState.score}`;
  $('#game-streak').textContent = `Streak: ${gameState.streak}`;
}

function renderRound() {
  const country = gameState.currentCountry;
  if (!country) {
    showComplete();
    return;
  }

  const img = $('#flag-img');
  const code = country.code.toLowerCase();
  const requestId = ++activeImageRequestId;
  img.alt = `${country.name} flag`;
  img.removeAttribute('style');
  img.onload = null;
  img.onerror = null;
  const state = { index: 0 };
  img.onerror = function() {
    if (requestId !== activeImageRequestId) return;
    state.index++;
    if (state.index < FLAG_CDNS.length) {
      this.src = `${FLAG_CDNS[state.index]}/${code}.png`;
    } else {
      this.src = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="192"><rect fill="#21262d" width="320" height="192"/><text x="50%" y="50%" fill="#8b949e" font-size="14" text-anchor="middle" dy=".3em">${country.name}</text></svg>`);
    }
  };
  img.onload = function() {
    if (requestId !== activeImageRequestId) return;
    state.index = 0;
  };
  img.src = `${FLAG_CDNS[0]}/${code}.png`;

  const wrapper = $('#flag-wrapper');
  wrapper.classList.remove('correct', 'wrong', 'flip-in');
  void wrapper.offsetWidth;
  wrapper.classList.add('flip-in');

  const optsContainer = $('#options-container');
  const hardContainer = $('#hard-mode-container');
  const isHard = currentMode === 'hard';

  optsContainer.style.display = isHard ? 'none' : 'grid';
  hardContainer.style.display = isHard ? 'flex' : 'none';

  if (!isHard) {
    const buttons = optsContainer.querySelectorAll('.option-btn');
    gameState.options.forEach((opt, i) => {
      const btn = buttons[i];
      btn.textContent = opt.name;
      btn.disabled = false;
      btn.classList.remove('correct', 'wrong');
    });
  } else {
    const input = $('#answer-input');
    input.value = '';
    input.focus();
  }

  gameState.answered = false;
  updateGameStats();

  if (currentMode === 'timed' && gameState.timerSeconds > 0) {
    startTimer();
  }
}

function nextRound() {
  gameState.currentCountry = getNextCountry();
  if (gameState.currentCountry) {
    gameState.questionCount++;
    if (currentMode !== 'hard') {
      gameState.options = buildOptions(gameState.currentCountry);
    }
    renderRound();
  } else {
    showComplete();
  }
}

function showComplete() {
  if (currentMode === 'timed') stopTimer();
  const overlay = $('#complete-overlay');
  overlay.classList.add('active');
  const title = $('#complete-title');
  const msg = $('#complete-message');
  const contStats = overlay.querySelector('.complete-stats');

  if (currentMode === 'normal' && gameState.queue.length === 0 && getDueCount() === 0) {
    title.textContent = 'Daily Goal Complete!';
    msg.textContent = 'All due cards reviewed. Come back tomorrow!';
  } else {
    title.textContent = 'Session Complete!';
    msg.textContent = 'Great work. Keep the streak going!';
  }

  const xpChange = gameState.score >= 0 ? `+${gameState.score}` : `${gameState.score}`;
  contStats.textContent = `Score: ${xpChange} | Streak: ${gameState.streak}`;
}

function startTimer() {
  stopTimer();
  const el = $('#game-timer');
  let remaining = gameState.timerSeconds;
  el.textContent = `${remaining}s`;
  gameState.timer = setInterval(() => {
    remaining--;
    el.textContent = `${remaining}s`;
    if (remaining <= 0) {
      stopTimer();
      showComplete();
    }
  }, 1000);
}

function stopTimer() {
  if (gameState.timer) {
    clearInterval(gameState.timer);
    gameState.timer = null;
  }
}

// ==================== Answer Handling ====================

function checkAnswer(selectedName) {
  if (gameState.answered) return;
  gameState.answered = true;

  // Disable options during feedback
  document.querySelectorAll('.option-btn').forEach((b) => (b.disabled = true));
  const input = $('#answer-input');
  if (input) input.disabled = true;

  const correct = gameState.currentCountry.name;
  const normalized = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const isCorrect = fuzzyMatch(normalized(selectedName), normalized(correct));

  if (currentMode === 'normal' || currentMode === 'hard') {
    if (isCorrect) {
      processCorrect(gameState.currentCountry.code);
      stats.totalCorrect++;
    } else {
      processIncorrect(gameState.currentCountry.code);
      stats.totalWrong++;
    }
  }

  let xpGained = 0;
  if (isCorrect) {
    stats.currentStreak++;
    if (stats.currentStreak > stats.longestStreak) {
      stats.longestStreak = stats.currentStreak;
    }
    gameState.streak++;
    xpGained = XP_BASE + (gameState.streak > 1 ? XP_STREAK_BONUS : 0);
    addXP(xpGained);
    gameState.score += xpGained;
    showCorrectCelebration(xpGained);
  } else {
    stats.currentStreak = 0;
    gameState.streak = 0;
    addXP(XP_PENALTY);
    gameState.score += XP_PENALTY;

    // Reinforcement loop: wrong answers return multiple times this session.
    scheduleSessionRetry(gameState.currentCountry);
  }

  saveData();

  // In-place feedback: show red/green on options for ~1s, then auto-advance
  showAnswerFeedback(isCorrect, correct, selectedName, () => {
    if (isCorrect && STREAK_MILESTONES.includes(gameState.streak)) {
      showStreakMilestone(gameState.streak, () => advanceToNextQuestion());
    } else {
      advanceToNextQuestion();
    }
  });
}

const STREAK_MESSAGES = {
  5: 'On Fire!',
  10: 'Unstoppable!',
  20: 'Legendary!',
  50: 'Master!',
  100: 'Ultimate!',
  150: 'Champion!',
};

function showStreakMilestone(streak, onComplete) {
  const overlay = $('#streak-milestone');
  const text = $('#streak-milestone-text');
  const sub = $('#streak-milestone-sub');
  if (!overlay || !text) {
    onComplete();
    return;
  }
  text.textContent = `${streak} Streak!`;
  if (sub) sub.textContent = STREAK_MESSAGES[streak] || 'Amazing!';
  overlay.classList.add('active');
  setTimeout(() => {
    overlay.classList.remove('active');
    onComplete();
  }, 1100);
}

// ==================== Dashboard ====================

function getMasteredCount() {
  return countries.filter(
    (c) => getCard(c.code).repetitions >= 3 && getCard(c.code).interval >= 21
  ).length;
}

function getLearningCount() {
  return countries.filter(
    (c) => getCard(c.code).repetitions > 0 && getCard(c.code).interval < 21
  ).length;
}

function getStrugglingCount() {
  return countries.filter((c) => getCard(c.code).lapses >= 3).length;
}

function getAccuracy() {
  const total = stats.totalCorrect + stats.totalWrong;
  if (total === 0) return '—';
  return Math.round((stats.totalCorrect / total) * 100) + '%';
}

function renderDashboard() {
  $('#dash-mastered').textContent = getMasteredCount();
  $('#dash-learning').textContent = getLearningCount();
  $('#dash-struggling').textContent = getStrugglingCount();
  $('#dash-longest').textContent = stats.longestStreak;
  $('#dash-accuracy').textContent = getAccuracy();
  $('#dash-due').textContent = getDueCount();

  const continents = [...new Set(countries.map((c) => c.continent))];
  const container = $('#continent-stats');
  container.innerHTML = continents
    .map(
      (cont) =>
        `<div class="continent-stat">${cont}: ${countries.filter((c) => c.continent === cont).length} countries</div>`
    )
    .join('');
}

// ==================== Init & Event Listeners ====================

async function init() {
  const res = await fetch('data/countries.json');
  countries = await res.json();
  loadData();

  updateMenuStats();
  $('#loading-overlay').classList.remove('active');

  // Mode buttons
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === 'continent') {
        showScreen('continent-select');
      } else if (mode === 'timed') {
        showScreen('timed-select');
      } else {
        startGame(mode);
      }
    });
  });

  document.querySelectorAll('.continent-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      gameState.selectedContinent = btn.dataset.continent;
      startGame('continent');
    });
  });

  document.querySelectorAll('.timed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      gameState.timerSeconds = parseInt(btn.dataset.seconds, 10);
      startGame('timed');
    });
  });

  document.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => showScreen(btn.dataset.back));
  });

  $('#btn-dashboard').addEventListener('click', () => {
    renderDashboard();
    showScreen('dashboard');
  });

  $('#btn-settings').addEventListener('click', () => showScreen('settings'));

  $('#sound-toggle').checked = settings.soundEnabled;
  $('#sound-toggle').addEventListener('change', (e) => {
    settings.soundEnabled = e.target.checked;
    saveData();
  });

  $('#reset-progress').addEventListener('click', () => {
    if (confirm('Reset all progress? This cannot be undone.')) {
      cards = {};
      stats = {
        totalScore: 0,
        currentStreak: 0,
        longestStreak: 0,
        totalCorrect: 0,
        totalWrong: 0,
        xp: 0,
        level: 1,
      };
      saveData();
      updateMenuStats();
      showScreen('main-menu');
    }
  });

  $('#game-back').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentMode === 'timed') stopTimer();
    document.querySelectorAll('.overlay').forEach((o) => o.classList.remove('active'));
    $('#round-result').classList.remove('show-correct', 'show-wrong');
    updateMenuStats();
    showScreen('main-menu');
  });

  document.querySelectorAll('.option-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      checkAnswer(btn.textContent);
    });
  });

  $('#submit-answer').addEventListener('click', () => {
    checkAnswer($('#answer-input').value);
  });

  $('#answer-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') checkAnswer($('#answer-input').value);
  });

  document.addEventListener('keydown', (e) => {
    if (!$('#game-screen').classList.contains('active')) return;
    if (currentMode === 'hard') return;
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 4) {
      const btn = $(`.option-btn[data-index="${num - 1}"]`);
      if (btn && !btn.disabled) btn.click();
    }
  });

  $('#complete-continue').addEventListener('click', () => {
    $('#complete-overlay').classList.remove('active');
    updateMenuStats();
    showScreen('main-menu');
  });
}

function startGame(mode) {
  currentMode = mode;
  const prevContinent = gameState?.selectedContinent;
  const prevTimerSeconds = gameState?.timerSeconds || 0;
  gameState = {
    queue: buildQueue(),
    retryQueue: [],
    currentCountry: null,
    options: [],
    score: 0,
    streak: 0,
    questionCount: 0,
    timer: null,
    timerSeconds: prevTimerSeconds,
    answered: false,
    selectedContinent: prevContinent,
  };
  $('#game-timer').textContent = '';
  showScreen('game-screen');
  nextRound();
}

init();
