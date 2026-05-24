# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## App Overview

Single-page health management web app: **HealthBalance Planner**. Pure HTML5 + CSS3 + Vanilla JS, no build tools, no dependencies. `localStorage` is the only data store.

## File Structure

| File | Role |
|---|---|
| `index.html` | Full SPA — three views: onboarding, dashboard, modals |
| `style.css` | All styles + CSS variable theming (light/dark) |
| `main.js` | All app logic (calculations, state, event handlers) |
| `config.js` | `CONFIG.OPENROUTER_API_KEY` + `CONFIG.BASE_URL` (gitignored) |
| `api.js` | `callOpenRouter(messages, model)` — fetch wrapper |

## Running

Open `index.html` directly in a browser — no server needed.

## localStorage Keys (prefix `hbp_`)

- `hbp_profile` — user profile, BMR/TDEE, goal weight, `startDate`
- `hbp_daily_logs` — `{ "YYYY-MM-DD": { breakfast, lunch, dinner, exercise, water } }`
- `hbp_weekly_weights` — `[{ week, weight, date }]`
- `hbp_theme` — `"light"` | `"dark"`

## Key Calculations (`main.js`)

- **BMR**: Revised Harris-Benedict formula (separate for male/female)
- **TDEE**: `BMR × activityMultiplier` (1.2 / 1.375 / 1.55 / 1.725)
- **Target calories**: `TDEE − 500` (floor 1200 kcal), targets 0.5 kg/week loss
- **Macros**: 40% carb / 30% protein / 30% fat of target calories
- **Goal weight range**: `currentWeight − (weeks × 0.5)` to `currentWeight − (weeks × 0.3)`

## Weekly Feedback Logic

After `completedWeeks() >= 1` and no weight entry for that week, the weight modal fires. Four feedback scenarios based on `(weightDiff, completionRate >= 80%)`:

1. `diff > 1.0 kg` + high perf → warning (too fast)
2. `diff > 0` + high perf → success
3. `diff ≤ 0` + high perf → strategy suggestion
4. `diff ≤ 0` + low perf → motivation

## Stage 3: AI Diet Features

### API (`api.js`)
- `callAI({ model, system, messages })` — unified fetch wrapper; supports system prompt and vision content blocks
- `callOpenRouter(messages, model)` — backward-compatible wrapper

### AI Food Vision (`main.js`)
- **Camera modal** — 5 steps: `step-capture → step-preview → step-loading → step-result → step-error`
- `openCameraModal(mealType)` → `startCamera()` → `capturePhoto()` / `handleFileUpload()`
- `runFoodAnalysis()` — sends `image_url` base64 to Claude Vision; expects strict JSON back
- `applyNutritionResult()` — saves `breakfast_nut / lunch_nut / dinner_nut` into `dailyLogs[todayKey()]`

### Nutrition Widget
- `getTodayNutrition()` — sums `*_nut` fields across meals
- `renderNutritionWidget()` — updates calorie trio, macro bars, and doughnut chart
- `renderNutritionDoughnut()` — Chart.js doughnut (breakfast=orange, lunch=blue, dinner=purple, remaining=grey)

### Smart Recommendation
- `checkAndRecommend()` — triggered after each meal log; fires if deficit ≥ 200 kcal
- `fetchSmartRecommendation(deficit)` — sends deficit + macro shortfall to Claude; expects `{recommendations:[]}` JSON
- Renders slide cards in `#ai-rec-section`

### System Prompts (hardcoded in `main.js`)
- Vision prompt: instructs strict JSON with `foods[]` + totals
- Recommendation prompt: asks for 1-2 realistic convenience food suggestions

## Environment

- `CONFIG.OPENROUTER_API_KEY` — OpenRouter key (also in `.env`, both gitignored)
- `CONFIG.CLAUDE_MODEL` — defaults to `anthropic/claude-sonnet-4-5` (vision-capable); change in `config.js`
