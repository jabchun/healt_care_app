'use strict';

const SKA = {
  ACCOUNTS: 'hbp_accounts',
  SESSION:  'hbp_session',
  THEME:    'hbp_theme',
};

const SK = {
  get PROFILE()        { return `hbp_profile_${currentUser}`; },
  get DAILY_LOGS()     { return `hbp_daily_logs_${currentUser}`; },
  get WEEKLY_WEIGHTS() { return `hbp_weekly_weights_${currentUser}`; },
};

const ACTIVITY_MULT = {
  sedentary: 1.2,
  light:     1.375,
  moderate:  1.55,
  active:    1.725,
};

const EXERCISE_RECS = {
  sedentary: { freq: '주 3회부터 시작',  duration: '회당 20-30분', type: '걸기 · 가벼운 유산소' },
  light:     { freq: '주 3-4회 권장',    duration: '회당 30-40분', type: '유산소 + 기초 근력' },
  moderate:  { freq: '주 4-5회 권장',    duration: '회당 40-50분', type: '유산소 + 근력 혼합' },
  active:    { freq: '주 5-6회 유지',    duration: '회당 50-60분', type: 'HIIT · 근력 · 유산소' },
};

const CHECKLIST_KEYS = ['breakfast', 'lunch', 'dinner', 'exercise', 'water'];

let currentUser   = null;
let profile       = null;
let dailyLogs     = {};
let weeklyWeights = [];
let activeView    = 'today';
let weightChart   = null;
let nutriChart    = null;

let cameraStream     = null;
let currentMealType  = null;
let currentImageUrl  = null;
let currentNutrition = null;

function load() {
  try {
    const p = localStorage.getItem(SK.PROFILE);
    if (p) profile = JSON.parse(p);
    const d = localStorage.getItem(SK.DAILY_LOGS);
    if (d) dailyLogs = JSON.parse(d);
    const w = localStorage.getItem(SK.WEEKLY_WEIGHTS);
    if (w) weeklyWeights = JSON.parse(w);
  } catch (_) {}
}

const saveProfile       = () => localStorage.setItem(SK.PROFILE,        JSON.stringify(profile));
const saveDailyLogs     = () => localStorage.setItem(SK.DAILY_LOGS,     JSON.stringify(dailyLogs));
const saveWeeklyWeights = () => localStorage.setItem(SK.WEEKLY_WEIGHTS, JSON.stringify(weeklyWeights));

function calcBMR(gender, weight, height, age) {
  return gender === 'male'
    ? 88.362 + (13.397 * weight) + (4.799 * height) - (5.677 * age)
    : 447.593 + (9.247 * weight) + (3.098 * height) - (4.330 * age);
}
function calcTDEE(bmr, activity) { return bmr * ACTIVITY_MULT[activity]; }
function calcTargetCalories(tdee, direction) {
  if (direction === 'gain')     return Math.round(tdee + 500);
  if (direction === 'maintain') return Math.round(tdee);
  return Math.max(1200, Math.round(tdee - 500));
}
function calcMacros(kcal) {
  return {
    carb:    Math.round((kcal * 0.40) / 4),
    protein: Math.round((kcal * 0.30) / 4),
    fat:     Math.round((kcal * 0.30) / 9),
  };
}
function calcGoalWeight(startWeight, weeks, direction) {
  if (direction === 'gain') return {
    min: +(startWeight + weeks * 0.3).toFixed(1),
    max: +(startWeight + weeks * 0.5).toFixed(1),
  };
  if (direction === 'maintain') return {
    min: +(startWeight - 1.0).toFixed(1),
    max: +(startWeight + 1.0).toFixed(1),
  };
  return {
    min: +(startWeight - weeks * 0.5).toFixed(1),
    max: +(startWeight - weeks * 0.3).toFixed(1),
  };
}

function calcBMI(weight, height) {
  return weight / ((height / 100) ** 2);
}

const BMI_TABLE = [
  { max: 18.5, label: '저체중',   emoji: '📉', direction: 'gain',     colorVar: '--info-text',    bgVar: '--info-bg'    },
  { max: 23.0, label: '정상',     emoji: '✅', direction: 'maintain', colorVar: '--success-text', bgVar: '--success-bg' },
  { max: 25.0, label: '과체중',   emoji: '⚠️', direction: 'lose',     colorVar: '--warning-text', bgVar: '--warning-bg' },
  { max: 30.0, label: '비만',     emoji: '🔴', direction: 'lose',     colorVar: '--danger-text',  bgVar: '--danger-bg'  },
  { max: Infinity, label: '고도비만', emoji: '🔴', direction: 'lose', colorVar: '--danger-text',  bgVar: '--danger-bg'  },
];

function getBMIStatus(bmi) {
  return BMI_TABLE.find(s => bmi < s.max);
}

const DIRECTION_LABEL = { gain: '증량 목표 기준', maintain: '체중 유지 기준', lose: '감량 목표 기준' };

function todayKey() { return new Date().toISOString().slice(0, 10); }

function daysSinceStart() {
  if (!profile?.startDate) return 0;
  return Math.floor((Date.now() - new Date(profile.startDate)) / 86400000);
}
function currentWeek()    { return Math.floor(daysSinceStart() / 7) + 1; }
function completedWeeks() { return Math.floor(daysSinceStart() / 7); }

function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}
function todayKorean() {
  const d = new Date();
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${['일','월','화','수','목','금','토'][d.getDay()]})`;
}

function getDayKeys(startAgo, endAgo) {
  const keys = [];
  for (let i = startAgo; i <= endAgo; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}
function calcCompletionRate(keys) {
  let total = 0, checked = 0;
  keys.forEach(k => {
    const log = dailyLogs[k] || {};
    CHECKLIST_KEYS.forEach(ck => { total++; if (log[ck]) checked++; });
  });
  return total ? checked / total : 0;
}
function countExerciseDays(keys) {
  return keys.filter(k => dailyLogs[k]?.exercise).length;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const navBtn = document.getElementById('dark-mode-toggle');
  if (navBtn) navBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
  const stToggle = document.getElementById('st-dark-toggle');
  if (stToggle) stToggle.checked = theme === 'dark';
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem(SKA.THEME, next);
  if (activeView === 'report') renderWeightChart();
  if (activeView === 'today' && nutriChart) renderNutritionDoughnut();
}

function switchTab(viewName) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('visible', v.id === `view-${viewName}`);
  });
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  activeView = viewName;

  if (viewName === 'report')   setTimeout(() => renderReport(), 60);
  if (viewName === 'settings') populateSettingsForm();
}

function showOnboarding() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('onboarding').classList.remove('hidden');
  document.getElementById('dashboard').classList.add('hidden');
  if (currentUser) {
    document.getElementById('onboarding-welcome').textContent =
      `${currentUser}님, 건강한 시작을 위한 기본 정보를 입력해주세요`;
  }
}

function handleOnboardingSubmit(e) {
  e.preventDefault();
  const name      = document.getElementById('ob-name').value.trim();
  const age       = parseInt(document.getElementById('ob-age').value, 10);
  const gender    = document.getElementById('ob-gender').value;
  const height    = parseFloat(document.getElementById('ob-height').value);
  const weight    = parseFloat(document.getElementById('ob-weight').value);
  const activity  = document.getElementById('ob-activity').value;
  const goalWeeks = parseInt(document.getElementById('ob-goal-weeks').value, 10);

  const errEl = document.getElementById('form-error');
  if (!name || !gender || !activity || isNaN(age) || isNaN(height) || isNaN(weight) || isNaN(goalWeeks)) {
    errEl.classList.remove('hidden'); return;
  }
  errEl.classList.add('hidden');

  const bmr            = calcBMR(gender, weight, height, age);
  const tdee           = calcTDEE(bmr, activity);
  const bmi            = calcBMI(weight, height);
  const bmiStatus      = getBMIStatus(bmi);
  const targetCalories = calcTargetCalories(tdee, bmiStatus.direction);
  const goalWeight     = calcGoalWeight(weight, goalWeeks, bmiStatus.direction);

  document.getElementById('result-bmr').textContent         = `${Math.round(bmr).toLocaleString()} kcal`;
  document.getElementById('result-tdee').textContent        = `${Math.round(tdee).toLocaleString()} kcal`;
  document.getElementById('result-target').textContent      = `${targetCalories.toLocaleString()} kcal`;
  document.getElementById('result-goal-weight').textContent =
    bmiStatus.direction === 'maintain'
      ? `${goalWeight.min} ~ ${goalWeight.max} kg (유지)`
      : `${goalWeight.min} ~ ${goalWeight.max} kg`;

  const bmiEl = document.getElementById('result-bmi');
  if (bmiEl) {
    bmiEl.innerHTML = `<span class="bmi-badge" style="background:var(${bmiStatus.bgVar});color:var(${bmiStatus.colorVar})">${bmiStatus.emoji} ${bmiStatus.label}</span> <span style="color:var(--text-secondary);font-size:0.85em">(BMI ${bmi.toFixed(1)})</span>`;
  }

  document.getElementById('onboarding-result').classList.remove('hidden');
  e.submitter.style.display = 'none';

  window.__pendingProfile = {
    name, age, gender, height, activity, goalWeeks,
    startWeight: weight, currentWeight: weight,
    bmr: Math.round(bmr), tdee: Math.round(tdee),
    targetCalories, goalWeight,
    bmi: +bmi.toFixed(1), bmiDirection: bmiStatus.direction,
    startDate: todayKey(),
  };
}

function confirmProfile() {
  profile = window.__pendingProfile;
  saveProfile();
  document.getElementById('onboarding').classList.add('hidden');
  showDashboard();
}

function showDashboard() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('onboarding').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  renderDashboard();
  checkWeeklyModal();
}

function renderDashboard() {
  document.getElementById('greeting').textContent   = `안녕하세요, ${profile.name}님! 👋`;
  document.getElementById('week-info').textContent  = `${currentWeek()}주차 진행 중 · 시작일: ${fmtDate(profile.startDate)}`;
  document.getElementById('today-date').textContent = todayKorean();
  document.getElementById('checklist-date').textContent = todayKorean();

  document.getElementById('target-calories').textContent = profile.targetCalories.toLocaleString();

  const dirLabel = DIRECTION_LABEL[profile.bmiDirection] || '목표 기준';
  document.getElementById('calorie-note').textContent = dirLabel;

  const m = calcMacros(profile.targetCalories);
  document.getElementById('carb-g').textContent    = `${m.carb}g`;
  document.getElementById('protein-g').textContent = `${m.protein}g`;
  document.getElementById('fat-g').textContent     = `${m.fat}g`;

  const rec = EXERCISE_RECS[profile.activity];
  document.getElementById('exercise-freq').textContent     = rec.freq;
  document.getElementById('exercise-duration').textContent = rec.duration;
  document.getElementById('exercise-type').textContent     = rec.type;

  document.getElementById('start-weight-display').textContent   = `${profile.startWeight} kg`;
  document.getElementById('current-weight-display').textContent = `${profile.currentWeight} kg`;
  document.getElementById('goal-weight-display').textContent    = `${profile.goalWeight.min} ~ ${profile.goalWeight.max} kg`;

  const bmiStatus = getBMIStatus(profile.bmi || calcBMI(profile.currentWeight, profile.height));
  const bmiRowEl  = document.getElementById('bmi-status-row');
  if (bmiRowEl) {
    bmiRowEl.innerHTML = `
      <span class="weight-label">체중 상태</span>
      <span class="bmi-badge" style="background:var(${bmiStatus.bgVar});color:var(${bmiStatus.colorVar})">${bmiStatus.emoji} ${bmiStatus.label} <span style="font-weight:400;font-size:0.78em">(BMI ${(profile.bmi || calcBMI(profile.currentWeight, profile.height)).toFixed(1)})</span></span>`;
  }

  loadTodayChecklist();
  updateMealSubtitles();
  renderNutritionWidget();
}

function loadTodayChecklist() {
  const log = dailyLogs[todayKey()] || {};
  CHECKLIST_KEYS.forEach(key => {
    const cb   = document.querySelector(`input[data-key="${key}"]`);
    const item = cb?.closest('.checklist-item');
    if (!cb || !item) return;
    cb.checked = !!log[key];
    item.classList.toggle('checked', !!log[key]);
  });
  updateProgress();
}

function handleCheckboxChange(e) {
  const { key } = e.target.dataset;
  const today   = todayKey();
  if (!dailyLogs[today]) dailyLogs[today] = {};
  dailyLogs[today][key] = e.target.checked;
  saveDailyLogs();
  e.target.closest('.checklist-item').classList.toggle('checked', e.target.checked);
  updateProgress();
}

function updateProgress() {
  const log     = dailyLogs[todayKey()] || {};
  const checked = CHECKLIST_KEYS.filter(k => log[k]).length;
  const pct     = Math.round((checked / CHECKLIST_KEYS.length) * 100);
  document.getElementById('progress-bar').style.width     = `${pct}%`;
  document.getElementById('progress-percent').textContent = `${pct}%`;
}

function checkWeeklyModal() {
  const done = completedWeeks();
  if (done < 1) return;
  if (!weeklyWeights.find(w => w.week === done)) showWeightModal(done);
}

function showWeightModal(week) {
  document.getElementById('modal-week-label').textContent = `${week}주차 체중을 입력해주세요`;
  document.getElementById('modal-weight-input').value    = '';
  const overlay = document.getElementById('weight-modal');
  overlay.dataset.week = week;
  overlay.classList.remove('hidden');
  setTimeout(() => document.getElementById('modal-weight-input').focus(), 120);
}

function handleWeightSubmit() {
  const input  = document.getElementById('modal-weight-input');
  const weight = parseFloat(input.value);
  if (isNaN(weight) || weight < 20 || weight > 300) {
    input.classList.add('shake');
    input.addEventListener('animationend', () => input.classList.remove('shake'), { once: true });
    return;
  }

  const week  = parseInt(document.getElementById('weight-modal').dataset.week, 10);
  const prev  = weeklyWeights.find(w => w.week === week - 1);
  const prevW = prev ? prev.weight : profile.startWeight;

  weeklyWeights.push({ week, weight, date: todayKey() });
  saveWeeklyWeights();
  profile.currentWeight = weight;
  saveProfile();

  const rate = calcCompletionRate(getDayKeys(0, 6));
  document.getElementById('weight-modal').classList.add('hidden');

  showFeedback(buildFeedback(prevW, weight, rate));
  renderDashboard();
}

function buildFeedback(prevW, newW, rate) {
  const diff     = +(prevW - newW).toFixed(1);
  const pctStr   = `${Math.round(rate * 100)}%`;
  const statStr  = `체중 변화: ${diff >= 0 ? '-' : '+'}${Math.abs(diff)}kg  |  수행률: ${pctStr}`;
  const highPerf = rate >= 0.8;

  if (diff > 1.0 && highPerf) return {
    type: 'warning', icon: '⚠️',
    title: '감량 속도를 줄여주세요',
    msg: `이번 주 ${diff}kg 감량은 권장 속도(주 0.5kg)를 넘었어요. 근육 손실 방지를 위해 일일 칼로리를 200-300kcal 늘려보세요.`,
    stats: statStr + `\n권장 칼로리 조정: ${profile.targetCalories + 250}kcal`,
  };
  if (diff > 0 && highPerf) return {
    type: 'success', icon: '🎉',
    title: '훌륭해요! 목표 달성 중!',
    msg: `이번 주 ${diff}kg 감량 성공! 꼸준한 수행률 ${pctStr}이 빛을 발했어요. 이 페이스를 계속 유지하세요.`,
    stats: statStr,
  };
  if (diff <= 0 && highPerf) return {
    type: 'info', icon: '🤔',
    title: '전략 수정을 고려해보세요',
    msg: `수행률은 ${pctStr}로 훌륭하지만 체중이 줄지 않았어요. 식단 칼로리를 100-200kcal 줄이거나 운동 강도를 높여보세요.`,
    stats: statStr,
  };
  return {
    type: 'motivation', icon: '💪',
    title: '다시 일어서 봐요!',
    msg: `이번 주는 조금 힙드셨군요. 수행률 ${pctStr}, 완벽하지 않아도 괜썜아요. 한 가지 습관부터 다시 시작해봐요!`,
    stats: statStr,
  };
}

function showFeedback(fb) {
  document.getElementById('feedback-icon').textContent    = fb.icon;
  document.getElementById('feedback-title').textContent   = fb.title;
  document.getElementById('feedback-message').textContent = fb.msg;
  document.getElementById('feedback-stats').innerHTML     = fb.stats.replace(/\n/g, '<br>');
  document.getElementById('feedback-card').className      = `modal-card feedback-card feedback-${fb.type}`;
  document.getElementById('feedback-modal').classList.remove('hidden');
}

function buildChartData() {
  const sorted  = [...weeklyWeights].sort((a, b) => a.week - b.week);
  const maxWeek = Math.max(currentWeek(), sorted.length > 0 ? sorted[sorted.length - 1].week + 1 : 1);
  const goalMid = +((profile.goalWeight.min + profile.goalWeight.max) / 2).toFixed(1);

  const labels     = ['시작'];
  const actualData = [profile.startWeight];
  const goalLine   = [goalMid];

  for (let w = 1; w <= maxWeek; w++) {
    labels.push(`${w}주차`);
    const entry = weeklyWeights.find(e => e.week === w);
    actualData.push(entry ? entry.weight : null);
    goalLine.push(goalMid);
  }
  return { labels, actualData, goalLine };
}

function getChartColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    text:     isDark ? '#8B949E' : '#546E7A',
    grid:     isDark ? 'rgba(48,54,61,0.8)' : 'rgba(224,231,239,0.8)',
    goalLine: isDark ? '#5C6BC0' : '#1A237E',
  };
}

function renderWeightChart() {
  const canvas = document.getElementById('weight-chart');
  if (!canvas) return;
  const ctx    = canvas.getContext('2d');
  const colors = getChartColors();
  const { labels, actualData, goalLine } = buildChartData();

  if (weightChart) { weightChart.destroy(); weightChart = null; }

  weightChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '체중 (kg)',
          data: actualData,
          borderColor: '#4CAF50',
          backgroundColor: 'rgba(76,175,80,0.07)',
          borderWidth: 2.5,
          pointBackgroundColor: '#4CAF50',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 8,
          fill: true,
          tension: 0.35,
          spanGaps: false,
        },
        {
          label: '목표 체중',
          data: goalLine,
          borderColor: colors.goalLine,
          borderDash: [7, 4],
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: colors.text,
            usePointStyle: true,
            pointStyle: 'circle',
            font: { family: "'Segoe UI', sans-serif", size: 12 },
          },
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y ?? '-'} kg`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: colors.text, font: { size: 11 } },
          grid:  { color: colors.grid },
        },
        y: {
          ticks: { color: colors.text, callback: v => `${v}kg`, font: { size: 11 } },
          grid:  { color: colors.grid },
        },
      },
    },
  });

  const sorted = [...weeklyWeights].sort((a, b) => b.week - a.week);
  const badge  = document.getElementById('weight-change-badge');
  if (sorted.length === 0) {
    badge.textContent = '데이터 없음';
    badge.className   = 'change-badge change-neutral';
  } else {
    const latest = sorted[0].weight;
    const prev   = sorted.length > 1 ? sorted[1].weight : profile.startWeight;
    const diff   = +(latest - prev).toFixed(1);
    if (diff < 0) {
      badge.textContent = `이번 주 변화: ${diff}kg`;
      badge.className   = 'change-badge change-positive';
    } else if (diff > 0) {
      badge.textContent = `이번 주 변화: +${diff}kg`;
      badge.className   = 'change-badge change-negative';
    } else {
      badge.textContent = '이번 주 변화: ±0kg';
      badge.className   = 'change-badge change-neutral';
    }
  }
}

function getHeatLevel(pct) {
  if (pct === 0)   return 0;
  if (pct <= 33)   return 1;
  if (pct <= 66)   return 2;
  return 3;
}

function calcStreak() {
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const log  = dailyLogs[d.toISOString().slice(0, 10)] || {};
    const done = CHECKLIST_KEYS.filter(k => log[k]).length;
    if (done > 0) streak++;
    else break;
  }
  return streak;
}

function renderHeatmap() {
  const grid    = document.getElementById('heatmap-grid');
  const tooltip = document.getElementById('heatmap-tooltip');
  if (!grid) return;
  grid.innerHTML = '';

  for (let i = 27; i >= 0; i--) {
    const d       = new Date();
    d.setDate(d.getDate() - i);
    const key     = d.toISOString().slice(0, 10);
    const log     = dailyLogs[key] || {};
    const checked = CHECKLIST_KEYS.filter(k => log[k]).length;
    const pct     = Math.round((checked / CHECKLIST_KEYS.length) * 100);
    const level   = getHeatLevel(pct);

    const cell = document.createElement('div');
    cell.className = `heatmap-cell lv-${level}`;
    const tipText  = `${key}: ${checked}/${CHECKLIST_KEYS.length} 완료 (${pct}%)`;

    cell.addEventListener('mouseenter', e => {
      tooltip.textContent = tipText;
      tooltip.style.display = 'block';
      positionTooltip(e);
    });
    cell.addEventListener('mousemove', positionTooltip);
    cell.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

    grid.appendChild(cell);
  }

  document.getElementById('streak-count').textContent = calcStreak();
}

function positionTooltip(e) {
  const t  = document.getElementById('heatmap-tooltip');
  const vw = window.innerWidth;
  let x    = e.clientX + 14;
  if (x + 220 > vw) x = e.clientX - 220;
  t.style.left = `${x}px`;
  t.style.top  = `${e.clientY - 38}px`;
}

function renderWeeklyReport() {
  const thisKeys     = getDayKeys(0, 6);
  const lastKeys     = getDayKeys(7, 13);
  const thisRate     = calcCompletionRate(thisKeys);
  const lastRate     = calcCompletionRate(lastKeys);
  const thisExercise = countExerciseDays(thisKeys);
  const lastExercise = countExerciseDays(lastKeys);

  const sorted   = [...weeklyWeights].sort((a, b) => b.week - a.week);
  const latestW  = sorted[0]?.weight;

  const statsGrid = document.getElementById('report-stats-grid');
  statsGrid.innerHTML = [
    buildStatCard('📋 수행률',
      `${Math.round(thisRate * 100)}%`,
      `지난 주: ${Math.round(lastRate * 100)}%`,
      cmpDir(thisRate, lastRate)),
    buildStatCard('🏃 운동 횟수',
      `${thisExercise}횟`,
      `지난 주: ${lastExercise}횟`,
      cmpDir(thisExercise, lastExercise)),
    buildStatCard('⚖️ 현재 체중',
      latestW ? `${latestW}kg` : '미기록',
      `시작: ${profile.startWeight}kg`,
      latestW ? (latestW < profile.startWeight ? 'up' : latestW > profile.startWeight ? 'down' : 'neutral') : 'neutral'),
  ].join('');

  const recs    = generateRecs(thisRate, thisExercise, latestW);
  const recsEl  = document.getElementById('report-recs');
  recsEl.innerHTML = `
    <p class="recs-title">💡 다음 주 권장 조정 사항</p>
    ${recs.map(r => `<div class="rec-card">${r}</div>`).join('')}
  `;
}

function buildStatCard(title, value, compare, dir) {
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '→';
  const cls   = dir === 'up' ? 'arrow-up' : dir === 'down' ? 'arrow-down' : 'arrow-neutral';
  return `
    <div class="report-stat-card">
      <div class="rst-title">${title}</div>
      <div class="rst-value">${value}</div>
      <div class="rst-compare ${cls}">${arrow} ${compare}</div>
    </div>`;
}

function cmpDir(cur, prev) {
  if (cur > prev) return 'up';
  if (cur < prev) return 'down';
  return 'neutral';
}

function generateRecs(rate, exerciseCount, latestW) {
  const recs = [];
  if (rate < 0.6)
    recs.push('📌 수행률이 60% 미만이에요. 운동 횟수를 주 2회로 줄이거나 식단 목표를 조금 완화해 시작해보세요.');
  if (exerciseCount < 3)
    recs.push('📌 이번 주 운동이 3회 미만이에요. 짧은 10분 산책부터 매일 시작해보세요. 작은 습관이 큰 변화를 만듭니다.');
  if (!latestW)
    recs.push('📌 주간 체중이 아직 기록되지 않았어요. 매주 같은 시간에 체중을 측정하면 정확한 진행 상황을 파악할 수 있어요.');
  else if (latestW > profile.startWeight)
    recs.push('📌 체중이 시작보다 증가했어요. 하루 섭취 칼로리를 점검하고 간식 섭취를 줄여보세요.');
  if (recs.length === 0)
    recs.push('🎉 이번 주도 훌륭하게 관리했어요! 현재 루틴을 유지하되 강도를 5-10% 높여 새로운 자극을 줘보세요.');
  return recs.slice(0, 2);
}

const MEAL_KEYS = ['breakfast', 'lunch', 'dinner'];

function getTodayNutrition() {
  const log = dailyLogs[todayKey()] || {};
  let calories = 0, carbs = 0, protein = 0, fat = 0;
  const breakdown = {};
  MEAL_KEYS.forEach(m => {
    const n = log[`${m}_nut`];
    if (n) {
      calories += n.total_calories  || 0;
      carbs    += n.total_carbs_g   || 0;
      protein  += n.total_protein_g || 0;
      fat      += n.total_fat_g     || 0;
      breakdown[m] = n.total_calories || 0;
    } else {
      breakdown[m] = 0;
    }
  });
  return { calories, carbs, protein, fat, breakdown };
}

function updateMealSubtitles() {
  MEAL_KEYS.forEach(m => {
    const log  = dailyLogs[todayKey()] || {};
    const nut  = log[`${m}_nut`];
    const el   = document.getElementById(`meal-sub-${m}`);
    if (!el) return;
    el.textContent = nut
      ? `${nut.total_calories}kcal · 탄${nut.total_carbs_g}g 단${nut.total_protein_g}g 지${nut.total_fat_g}g`
      : { breakfast: '균형 잊힌 아침 식사', lunch: '영양소 균형 점심', dinner: '가병고 건강한 저녀' }[m];
  });
}

function renderNutritionWidget() {
  if (!profile) return;
  const { calories, carbs, protein, fat, breakdown } = getTodayNutrition();
  const target  = profile.targetCalories;
  const macros  = calcMacros(target);
  const remain  = Math.max(0, target - calories);

  document.getElementById('donut-consumed').textContent = calories;
  document.getElementById('cal-target').textContent     = target.toLocaleString();
  document.getElementById('cal-consumed').textContent   = calories.toLocaleString();
  document.getElementById('cal-remaining').textContent  = remain.toLocaleString();

  const setPct = (id, val, max) => {
    const pct = Math.min(100, Math.round((val / max) * 100));
    document.getElementById(id).style.width = `${pct}%`;
  };
  document.getElementById('mp-carb-text').textContent    = `${Math.round(carbs)}g / ${macros.carb}g`;
  document.getElementById('mp-protein-text').textContent = `${Math.round(protein)}g / ${macros.protein}g`;
  document.getElementById('mp-fat-text').textContent     = `${Math.round(fat)}g / ${macros.fat}g`;
  setPct('mp-carb-bar',    carbs,   macros.carb);
  setPct('mp-protein-bar', protein, macros.protein);
  setPct('mp-fat-bar',     fat,     macros.fat);

  renderNutritionDoughnut(calories, breakdown, remain);
}

function renderNutritionDoughnut(consumed, breakdown, remaining) {
  const canvas = document.getElementById('nutri-chart');
  if (!canvas) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  if (consumed === undefined) {
    const n = getTodayNutrition();
    consumed  = n.calories;
    breakdown = n.breakdown;
    remaining = Math.max(0, (profile?.targetCalories ?? 0) - consumed);
  }

  const bCal = breakdown?.breakfast || 0;
  const lCal = breakdown?.lunch     || 0;
  const dCal = breakdown?.dinner    || 0;

  if (nutriChart) { nutriChart.destroy(); nutriChart = null; }

  nutriChart = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['아침', '점심', '저녀', '잔여'],
      datasets: [{
        data: [bCal, lCal, dCal, remaining ?? profile.targetCalories],
        backgroundColor: ['#FFA726', '#42A5F5', '#AB47BC', isDark ? '#30363D' : '#E8EDF5'],
        borderWidth: 0,
        hoverOffset: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '72%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${c.label}: ${c.parsed}kcal` } },
      },
    },
  });
}

function checkAndRecommend() {
  const { calories } = getTodayNutrition();
  if (!calories) return;
  const deficit = profile.targetCalories - calories;
  if (deficit < 200) return;
  const section = document.getElementById('ai-rec-section');
  if (!section.classList.contains('hidden')) return;
  section.classList.remove('hidden');
  fetchSmartRecommendation(deficit);
}

async function fetchSmartRecommendation(deficit) {
  const macros   = calcMacros(profile.targetCalories);
  const { carbs, protein, fat } = getTodayNutrition();

  const userMsg = `당신은 헬스밸런스 플래너의 AI 영양사입니다. 아래 정보를 바탕으로 편의점이나 집에서 쉽게 구할 수 있는 음식 1~2가지를 추천하세요. 반드시 JSON 형식으로만 응답하세요: {"recommendations": [{"food": "음식명", "reason": "추천 이유", "calories": 숫자, "emoji": "이모지"}]}

오늘 목표 칼로리: ${profile.targetCalories}kcal
현재까지 섭취: ${profile.targetCalories - deficit}kcal
남은 칼로리: ${deficit}kcal
탄수화물 부족: ${Math.max(0, macros.carb - Math.round(carbs))}g
단백질 부족: ${Math.max(0, macros.protein - Math.round(protein))}g
지방 부족: ${Math.max(0, macros.fat - Math.round(fat))}g`;

  try {
    const text = await callAI({
      model: CONFIG.CLAUDE_MODEL,
      messages: [{ role: 'user', content: userMsg }],
    });
    const json = parseJSONSafe(text);
    renderRecommendations(json?.recommendations || []);
  } catch (err) {
    document.getElementById('ai-rec-cards').innerHTML =
      `<p class="rec-loading" style="color:var(--danger-text)">추천을 불러오지 못했어요: ${err.message}</p>`;
  }
}

function renderRecommendations(recs) {
  const container = document.getElementById('ai-rec-cards');
  if (!recs.length) {
    container.innerHTML = '<p class="rec-loading">추천 결과가 없어요.</p>';
    return;
  }
  container.innerHTML = recs.map(r => `
    <div class="ai-rec-card">
      <span class="ai-rec-emoji">${r.emoji || '🍱'}</span>
      <div class="ai-rec-food">${r.food}</div>
      <div class="ai-rec-reason">${r.reason}</div>
      <div class="ai-rec-cal">약 ${r.calories}kcal</div>
    </div>`).join('');
}

function openCameraModal(mealType) {
  currentMealType  = mealType;
  currentImageUrl  = null;
  currentNutrition = null;
  const labels = { breakfast: '아침 식단 분석', lunch: '점심 식단 분석', dinner: '저녀 식단 분석' };
  document.getElementById('camera-meal-label').textContent = labels[mealType] || 'AI 식단 분석';
  showCamStep('step-capture');
  document.getElementById('camera-modal').classList.remove('hidden');
  startCamera();
}

function closeCameraModal() {
  stopCamera();
  document.getElementById('camera-modal').classList.add('hidden');
  document.getElementById('upload-input').value = '';
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    document.getElementById('no-camera').classList.remove('hidden');
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
    });
    document.getElementById('cam-video').srcObject = cameraStream;
    document.getElementById('no-camera').classList.add('hidden');
  } catch (_) {
    document.getElementById('no-camera').classList.remove('hidden');
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  const video = document.getElementById('cam-video');
  if (video) video.srcObject = null;
}

async function capturePhoto() {
  const video = document.getElementById('cam-video');
  if (!video || !video.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  stopCamera();
  const resized = await resizeImage(dataUrl);
  showPreviewStep(resized);
}

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  stopCamera();
  const reader = new FileReader();
  reader.onload = async ev => {
    const resized = await resizeImage(ev.target.result);
    showPreviewStep(resized);
  };
  reader.readAsDataURL(file);
}

async function resizeImage(dataUrl, maxW = 640, maxH = 640, q = 0.7) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxW || h > maxH) {
        const r = Math.min(maxW / w, maxH / h);
        w = Math.round(w * r); h = Math.round(h * r);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', q));
    };
    img.src = dataUrl;
  });
}

function showPreviewStep(dataUrl) {
  currentImageUrl = dataUrl;
  document.getElementById('preview-img').src = dataUrl;
  showCamStep('step-preview');
}

async function runFoodAnalysis() {
  if (!currentImageUrl) return;
  showCamStep('step-loading');

  const instruction = `당신은 전문 영양사 AI입니다. 음식 사진을 분석하여 반드시 아래 JSON 형식으로만 응답하세요. JSON 외 다른 텍스트(설명, 마크다운 등)는 절대 포함하지 마세요.
{"foods": [{"name": "음식명", "amount_g": 숫자, "calories": 숫자, "carbs_g": 숫자, "protein_g": 숫자, "fat_g": 숫자}], "total_calories": 숫자, "total_carbs_g": 숫자, "total_protein_g": 숫자, "total_fat_g": 숫자}`;

  try {
    const text = await callAI({
      model: CONFIG.CLAUDE_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: currentImageUrl } },
          { type: 'text', text: instruction },
        ],
      }],
    });

    const json = parseJSONSafe(text);
    if (!json || !json.foods) throw new Error('인식된 음식이 없어요.');
    currentNutrition = json;
    showResultStep(json);
  } catch (err) {
    const msg = err.message || '분석에 실패했어요. 다시 시도해주세요.';
    document.getElementById('error-msg').textContent = msg;
    console.error('[Food Analysis Error]', err);
    showCamStep('step-error');
  }
}

function showResultStep(nutrition) {
  const foodRows = nutrition.foods.map(f => `
    <div class="ai-food-row">
      <span class="ai-food-name">${f.name} <span style="color:var(--text-secondary);font-weight:400">(${f.amount_g}g)</span></span>
      <span class="ai-food-cal">${f.calories}kcal</span>
    </div>`).join('');

  document.getElementById('ai-result-body').innerHTML = `
    <div class="ai-result-food-list">${foodRows}</div>
    <div class="ai-total-bar">
      <div class="ai-total-item"><div class="ai-total-val">${nutrition.total_calories}</div><div class="ai-total-lbl">칼로리</div></div>
      <div class="ai-total-item"><div class="ai-total-val">${nutrition.total_carbs_g}g</div><div class="ai-total-lbl">탄수화물</div></div>
      <div class="ai-total-item"><div class="ai-total-val">${nutrition.total_protein_g}g</div><div class="ai-total-lbl">단백질</div></div>
      <div class="ai-total-item"><div class="ai-total-val">${nutrition.total_fat_g}g</div><div class="ai-total-lbl">지방</div></div>
    </div>`;
  showCamStep('step-result');
}

function applyNutritionResult() {
  if (!currentNutrition || !currentMealType) return;
  const today = todayKey();
  if (!dailyLogs[today]) dailyLogs[today] = {};
  dailyLogs[today][`${currentMealType}_nut`] = currentNutrition;
  dailyLogs[today][currentMealType] = true;
  saveDailyLogs();

  loadTodayChecklist();
  updateMealSubtitles();
  renderNutritionWidget();
  checkAndRecommend();
  closeCameraModal();
}

function showCamStep(stepId) {
  ['step-capture', 'step-preview', 'step-loading', 'step-result', 'step-error'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.toggle('active-step', el.id === stepId);
  });
}

function parseJSONSafe(text) {
  try {
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function renderReport() {
  renderWeightChart();
  renderHeatmap();
  renderWeeklyReport();
}

function populateSettingsForm() {
  if (!profile) return;
  document.getElementById('st-name').value       = profile.name;
  document.getElementById('st-age').value        = profile.age;
  document.getElementById('st-gender').value     = profile.gender;
  document.getElementById('st-height').value     = profile.height;
  document.getElementById('st-weight').value     = profile.currentWeight;
  document.getElementById('st-goal-weeks').value = profile.goalWeeks;
  document.getElementById('st-activity').value   = profile.activity;
  document.getElementById('st-start-date').textContent = fmtDate(profile.startDate);

  const theme = document.documentElement.getAttribute('data-theme');
  document.getElementById('st-dark-toggle').checked = theme === 'dark';

  if (currentUser) {
    document.getElementById('account-username-display').textContent = currentUser;
    document.getElementById('account-avatar').textContent = currentUser[0].toUpperCase();
  }
}

function handleSettingsSave(e) {
  e.preventDefault();
  const name      = document.getElementById('st-name').value.trim();
  const age       = parseInt(document.getElementById('st-age').value, 10);
  const gender    = document.getElementById('st-gender').value;
  const height    = parseFloat(document.getElementById('st-height').value);
  const currW     = parseFloat(document.getElementById('st-weight').value);
  const goalWeeks = parseInt(document.getElementById('st-goal-weeks').value, 10);
  const activity  = document.getElementById('st-activity').value;

  if (!name || !gender || !activity || isNaN(age) || isNaN(height) || isNaN(currW) || isNaN(goalWeeks)) return;

  const bmr        = calcBMR(gender, currW, height, age);
  const tdee       = calcTDEE(bmr, activity);
  const bmi        = calcBMI(currW, height);
  const bmiStatus  = getBMIStatus(bmi);
  const targetCalories = calcTargetCalories(tdee, bmiStatus.direction);
  const goalWeight     = calcGoalWeight(profile.startWeight, goalWeeks, bmiStatus.direction);

  profile = { ...profile, name, age, gender, height, activity, goalWeeks, currentWeight: currW,
    bmr: Math.round(bmr), tdee: Math.round(tdee), targetCalories, goalWeight,
    bmi: +bmi.toFixed(1), bmiDirection: bmiStatus.direction };
  saveProfile();

  const ok = document.getElementById('settings-success');
  ok.classList.remove('hidden');
  setTimeout(() => ok.classList.add('hidden'), 2500);

  renderDashboard();
}

async function hashPassword(password) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getAccounts() {
  try { return JSON.parse(localStorage.getItem(SKA.ACCOUNTS) || '{}'); } catch (_) { return {}; }
}
function saveAccounts(accounts) {
  localStorage.setItem(SKA.ACCOUNTS, JSON.stringify(accounts));
}

function getSession() {
  try {
    const s = localStorage.getItem(SKA.SESSION) || sessionStorage.getItem(SKA.SESSION);
    return s ? JSON.parse(s) : null;
  } catch (_) { return null; }
}
function setSession(username, remember) {
  const data = JSON.stringify({ username });
  if (remember) localStorage.setItem(SKA.SESSION, data);
  else          sessionStorage.setItem(SKA.SESSION, data);
}
function clearSession() {
  localStorage.removeItem(SKA.SESSION);
  sessionStorage.removeItem(SKA.SESSION);
}

function migrateOldData(username) {
  const pairs = [
    ['hbp_profile',        `hbp_profile_${username}`],
    ['hbp_daily_logs',     `hbp_daily_logs_${username}`],
    ['hbp_weekly_weights', `hbp_weekly_weights_${username}`],
  ];
  pairs.forEach(([oldKey, newKey]) => {
    const val = localStorage.getItem(oldKey);
    if (val && !localStorage.getItem(newKey)) {
      localStorage.setItem(newKey, val);
      localStorage.removeItem(oldKey);
    }
  });
}

function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('onboarding').classList.add('hidden');
  document.getElementById('dashboard').classList.add('hidden');
  if (Object.keys(getAccounts()).length === 0) switchAuthTab('register');
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.auth-panel').forEach(p => p.classList.toggle('active-panel', p.id === `auth-${tab}`));
  document.getElementById('login-error').textContent = '';
  document.getElementById('register-error').textContent = '';
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const remember = document.getElementById('login-remember').checked;
  const errEl    = document.getElementById('login-error');

  if (!username || !password) { errEl.textContent = '아이디와 비밀번호를 입력해주세요.'; return; }

  const accounts = getAccounts();
  if (!accounts[username]) { errEl.textContent = '존재하지 않는 계정입니다.'; return; }

  const hash = await hashPassword(password);
  if (accounts[username].hash !== hash) { errEl.textContent = '비밀번호가 올바르지 않습니다.'; return; }

  currentUser = username;
  setSession(username, remember);
  load();
  if (!profile) showOnboarding(); else showDashboard();
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const confirm  = document.getElementById('reg-confirm').value;
  const errEl    = document.getElementById('register-error');

  if (!username || !password || !confirm) { errEl.textContent = '모든 항목을 입력해주세요.'; return; }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    errEl.textContent = '아이디는 영문·숫자·_만 사용하는 3~20자여야 합니다.'; return;
  }
  if (password.length < 6) { errEl.textContent = '비밀번호는 6자 이상이어야 합니다.'; return; }
  if (password !== confirm) { errEl.textContent = '비밀번호가 일치하지 않습니다.'; return; }

  const accounts = getAccounts();
  if (accounts[username]) { errEl.textContent = '이미 사용 중인 아이디입니다.'; return; }

  const hash = await hashPassword(password);
  accounts[username] = { hash, createdAt: new Date().toISOString() };
  saveAccounts(accounts);

  migrateOldData(username);

  currentUser = username;
  setSession(username, true);
  load();
  if (!profile) showOnboarding(); else showDashboard();
}

function logout() {
  if (!confirm('로그아웃하시겠습니까?')) return;
  clearSession();
  currentUser   = null;
  profile       = null;
  dailyLogs     = {};
  weeklyWeights = [];
  if (weightChart) { weightChart.destroy(); weightChart = null; }
  if (nutriChart)  { nutriChart.destroy();  nutriChart = null; }
  showAuth();
}

function updatePasswordStrength(password) {
  let score = 0;
  if (password.length >= 8)       score++;
  if (/[A-Z]/.test(password))     score++;
  if (/[0-9]/.test(password))     score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  const bar = document.getElementById('pw-strength-bar');
  const lbl = document.getElementById('pw-strength-label');
  if (!bar) return;

  const levels = [
    { color: '#EF5350', label: '매우 약함' },
    { color: '#FFA726', label: '약함' },
    { color: '#FFEE58', label: '보통' },
    { color: '#66BB6A', label: '강함' },
    { color: '#43A047', label: '매우 강함' },
  ];
  const level = levels[Math.min(score, 4)];
  bar.style.width      = `${(score + 1) * 20}%`;
  bar.style.background = level.color;
  if (lbl) lbl.textContent = password ? level.label : '';
}

function init() {
  applyTheme(localStorage.getItem(SKA.THEME) || 'light');

  document.querySelectorAll('.auth-tab').forEach(t => {
    t.addEventListener('click', () => switchAuthTab(t.dataset.tab));
  });
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('register-form').addEventListener('submit', handleRegister);
  document.getElementById('reg-password').addEventListener('input', e => updatePasswordStrength(e.target.value));
  document.querySelectorAll('.pw-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  document.getElementById('logout-btn').addEventListener('click', logout);

  document.getElementById('onboarding-form').addEventListener('submit', handleOnboardingSubmit);
  document.getElementById('confirm-btn').addEventListener('click', confirmProfile);

  document.getElementById('dark-mode-toggle').addEventListener('click', toggleTheme);
  document.getElementById('st-dark-toggle').addEventListener('change', toggleTheme);

  document.getElementById('st-reset-btn').addEventListener('click', () => {
    if (!confirm('모든 데이터를 초기화하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
    localStorage.removeItem(SK.PROFILE);
    localStorage.removeItem(SK.DAILY_LOGS);
    localStorage.removeItem(SK.WEEKLY_WEIGHTS);
    location.reload();
  });

  document.getElementById('settings-form').addEventListener('submit', handleSettingsSave);

  document.querySelectorAll('.checklist input[type="checkbox"]')
    .forEach(cb => cb.addEventListener('change', handleCheckboxChange));

  document.getElementById('modal-submit').addEventListener('click', handleWeightSubmit);
  document.getElementById('modal-weight-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleWeightSubmit();
  });

  document.getElementById('feedback-close').addEventListener('click', () => {
    document.getElementById('feedback-modal').classList.add('hidden');
  });

  ['weight-modal', 'feedback-modal'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
    });
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.view));
  });

  document.querySelectorAll('.ai-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openCameraModal(btn.dataset.meal);
    });
  });

  document.getElementById('camera-close-btn').addEventListener('click', closeCameraModal);
  document.getElementById('capture-btn').addEventListener('click', capturePhoto);
  document.getElementById('upload-input').addEventListener('change', handleFileUpload);
  document.getElementById('analyze-btn').addEventListener('click', runFoodAnalysis);
  document.getElementById('apply-btn').addEventListener('click', applyNutritionResult);
  document.getElementById('retake-btn').addEventListener('click', () => {
    startCamera();
    showCamStep('step-capture');
  });
  document.getElementById('retake2-btn').addEventListener('click', () => {
    startCamera();
    showCamStep('step-capture');
  });
  document.getElementById('retry-btn').addEventListener('click', runFoodAnalysis);
  document.getElementById('cancel-btn').addEventListener('click', closeCameraModal);
  document.getElementById('manual-apply-btn').addEventListener('click', () => {
    const food = document.getElementById('manual-food').value.trim() || '직접입력';
    const cal  = parseFloat(document.getElementById('manual-cal').value)  || 0;
    const carb = parseFloat(document.getElementById('manual-carb').value) || 0;
    const prot = parseFloat(document.getElementById('manual-prot').value) || 0;
    const fat  = parseFloat(document.getElementById('manual-fat').value)  || 0;
    currentNutrition = {
      foods: [{ name: food, amount_g: 0, calories: cal, carbs_g: carb, protein_g: prot, fat_g: fat }],
      total_calories: cal, total_carbs_g: carb, total_protein_g: prot, total_fat_g: fat,
    };
    applyNutritionResult();
  });

  document.getElementById('camera-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeCameraModal();
  });

  const session = getSession();
  if (session) {
    currentUser = session.username;
    load();
    if (!profile) showOnboarding(); else showDashboard();
  } else {
    showAuth();
  }
}

document.addEventListener('DOMContentLoaded', init);
