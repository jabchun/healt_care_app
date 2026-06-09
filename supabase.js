'use strict';

const SUPABASE_URL      = 'https://opdbyslqcpjnihetcddf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wZGJ5c2xxY3BqbmloZXRjZGRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMDAwNDMsImV4cCI6MjA5NjU3NjA0M30.aCWUyIqW6u5hiR0fQAXfsKKXQp8yMxdItnojd6HoN0M';

const _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Auth ──────────────────────────────────────────────────────────────────────

async function dbGetUser(username) {
  const { data, error } = await _sb
    .from('users')
    .select('username, password_hash')
    .eq('username', username)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function dbCreateUser(username, passwordHash) {
  const { error } = await _sb
    .from('users')
    .insert({ username, password_hash: passwordHash });
  if (error) throw error;
}

// ── Profile ───────────────────────────────────────────────────────────────────

async function dbSaveProfile(username, profileData) {
  const { error } = await _sb
    .from('profiles')
    .upsert({ username, data: profileData, updated_at: new Date().toISOString() });
  if (error) console.error('[Supabase] saveProfile:', error.message);
}

async function dbLoadProfile(username) {
  const { data, error } = await _sb
    .from('profiles')
    .select('data')
    .eq('username', username)
    .single();
  if (error && error.code !== 'PGRST116') console.error('[Supabase] loadProfile:', error.message);
  return data?.data ?? null;
}

// ── Daily Logs ────────────────────────────────────────────────────────────────

async function dbSaveDailyLog(username, date, logData) {
  const { error } = await _sb
    .from('daily_logs')
    .upsert(
      { username, log_date: date, data: logData, updated_at: new Date().toISOString() },
      { onConflict: 'username,log_date' }
    );
  if (error) console.error('[Supabase] saveDailyLog:', error.message);
}

async function dbLoadDailyLogs(username) {
  const { data, error } = await _sb
    .from('daily_logs')
    .select('log_date, data')
    .eq('username', username);
  if (error) { console.error('[Supabase] loadDailyLogs:', error.message); return {}; }
  return Object.fromEntries((data || []).map(r => [r.log_date, r.data]));
}

// ── Weekly Weights ────────────────────────────────────────────────────────────

async function dbSaveWeeklyWeights(username, weights) {
  if (!weights.length) return;
  const rows = weights.map(w => ({ username, week: w.week, weight: w.weight, log_date: w.date }));
  const { error } = await _sb
    .from('weekly_weights')
    .upsert(rows, { onConflict: 'username,week' });
  if (error) console.error('[Supabase] saveWeeklyWeights:', error.message);
}

async function dbLoadWeeklyWeights(username) {
  const { data, error } = await _sb
    .from('weekly_weights')
    .select('week, weight, log_date')
    .eq('username', username)
    .order('week');
  if (error) { console.error('[Supabase] loadWeeklyWeights:', error.message); return []; }
  return (data || []).map(r => ({ week: r.week, weight: +r.weight, date: r.log_date }));
}

// ── Delete user data ──────────────────────────────────────────────────────────

async function dbDeleteUserData(username) {
  await Promise.all([
    _sb.from('daily_logs').delete().eq('username', username),
    _sb.from('weekly_weights').delete().eq('username', username),
    _sb.from('profiles').delete().eq('username', username),
  ]);
}
