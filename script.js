/**
 * Flag Master - Country Flag Spaced Repetition Game
 * SM-2 algorithm, multiple game modes, full persistence
 */

// ==================== Constants ====================
const FLAG_CDN = 'https://flagcdn.com/w320';
const STORAGE_KEYS = {
  cards: 'flagmaster_cards',
  stats: 'flagmaster_stats',
  settings: 'flagmaster_settings',
};
const XP_BASE = 10;
const XP_STREAK_BONUS = 5;
const XP_PENALTY = -5;
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
let gameState = {
  queue: [],
  currentCountry: null,
  options: [],
  score: 0,
  streak: 0,
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
  if (!card.nextReviewDate) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return card.nextReviewDate <= today.getTime() || card.repetitions === 0;
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
  if (currentMode === 'continent') {
    const continent = gameState.selectedContinent;
    const filtered = countries.filter((c) => c.continent === continent);
    return shuffleArray(filtered);
  }
  // Normal & Hard: SRS
  const due = countries.filter((c) => isDue(c.code));
  const newCards = countries.filter((c) => getCard(c.code).repetitions === 0);
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
  const newPerSession = 5;
  for (let i = 0; i < newPerSession && queue.length < 20; i++) {
    if (newCards[i] && !used.has(newCards[i].code)) {
      queue.push(newCards[i]);
      used.add(newCards[i].code);
    }
  }
  return queue;
}

function getNextCountry() {
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

function showResult(correct, xpGained, correctAnswer) {
  const overlay = $('#round-result');
  overlay.classList.remove('show-correct', 'show-wrong');
  overlay.classList.add('active');
  if (correct) {
    overlay.classList.add('show-correct');
    $('#correct-xp').text(`+${xpGained} XP`);
  } else {
    overlay.classList.add('show-wrong');
    $('#wrong-answer').text(`Correct: ${correctAnswer}`);
  }
  // Advance first (updates DOM with next question), then hide overlay to reveal it
  const advance = () => {
    nextRound();
    overlay.classList.remove('active', 'show-correct', 'show-wrong');
  };
  setTimeout(advance, 850);
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
  img.src = `${FLAG_CDN}/${country.code.toLowerCase()}.png`;
  img.alt = `${country.name} flag`;

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

    if (currentMode !== 'hard') {
      const idx = gameState.options.findIndex((o) => o.name === correct);
      const btns = $('#options-container').querySelectorAll('.option-btn');
      btns[idx]?.classList.add('correct');
    }
    $('#flag-wrapper').classList.add('correct');
  } else {
    stats.currentStreak = 0;
    gameState.streak = 0;
    addXP(XP_PENALTY);
    gameState.score += XP_PENALTY;

    if (currentMode !== 'hard') {
      const btns = $('#options-container').querySelectorAll('.option-btn');
      btns.forEach((btn, i) => {
        if (gameState.options[i].name === correct) btn.classList.add('correct');
        else if (btn.textContent === selectedName) btn.classList.add('wrong');
      });
    }
    $('#flag-wrapper').classList.add('wrong');
  }

  saveData();
  if (isCorrect && STREAK_MILESTONES.includes(gameState.streak)) {
    showStreakMilestone(gameState.streak, () => showResult(isCorrect, xpGained > 0 ? xpGained : 0, correct));
  } else {
    showResult(isCorrect, xpGained > 0 ? xpGained : 0, correct);
  }
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

  $('#game-back').addEventListener('click', () => {
    if (currentMode === 'timed') stopTimer();
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
    currentCountry: null,
    options: [],
    score: 0,
    streak: 0,
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
