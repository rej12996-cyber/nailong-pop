import { createGame, playMove, nextLevel, connectedGroup, positions, tileCount, totalScore, targetScore, eliminationScore, remainderBonus, restoreGame } from './game.js';
import { levelSkins, resultMascotForSeed } from './skins.js';
import { EliminationAudio } from './audio.js';
import { setupLeaderboard } from './leaderboard.js';
import { competitionSeed } from './competition.js';

const KEYS = { settings: 'nailong.settings.v1', records: 'nailong.records.v1', session: 'nailong.session.v2' };
const DEFAULT_RECORDS = { bestScore: 0, bestLevel: 0, totalCleared: 0 };
const $ = (selector) => document.querySelector(selector);
const format = (value) => value.toLocaleString('zh-CN');
const safeCount = (value) => Number.isSafeInteger(value) && value >= 0;
const sanitizeRecords = (value) => Object.fromEntries(Object.entries(DEFAULT_RECORDS).map(([key, fallback]) => [key, safeCount(value?.[key]) ? value[key] : fallback]));
let toastTimer;
let storageWarningShown = false;
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2800);
}
function storageWarning() {
  if (storageWarningShown) return;
  storageWarningShown = true;
  toast('浏览器暂时无法保存进度，关闭页面后可能丢失。');
}
function readStorage(key) {
  try { return JSON.parse(localStorage.getItem(key)); }
  catch (error) { if (!(error instanceof SyntaxError)) storageWarning(); return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { storageWarning(); }
}
function readSettings() {
  const saved = readStorage(KEYS.settings);
  return {
    confirm: saved?.confirm === true, reducedMotion: saved?.reducedMotion === true,
    sound: saved?.sound !== false,
    volume: Number.isFinite(saved?.volume) && saved.volume >= 0 && saved.volume <= 1 ? saved.volume : 0.6,
  };
}
let settings = readSettings();
const sounds = new EliminationAudio({ onError: () => toast('音效暂时无法播放，游戏可以继续。') });
const savedSession = readStorage(KEYS.session);
let records = sanitizeRecords(savedSession?.records ?? readStorage(KEYS.records));
let game = restoreGame(savedSession?.game);
let skins = levelSkins(game?.seed ?? 0);
let showingGame = false;
let busy = false;
let animationRevision = 0;
let selectedIds = [];
let focusedId = null;
let skipSettlement = false;
let rewardFlight = null;
const nodes = new Map();
const reducedMotion = () => settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
function persist() {
  // One write owns both scores and the stable board; reload cannot count a move twice.
  writeStorage(KEYS.session, { game, records });
  syncRecords();
}
function updateRecords(cleared = 0) {
  records.bestScore = Math.max(records.bestScore, totalScore(game));
  if (game.phase === 'passed') records.bestLevel = Math.max(records.bestLevel, game.level);
  records.totalCleared += cleared;
}
function syncRecords() {
  $('#best-score').textContent = format(records.bestScore);
  $('#best-level').textContent = records.bestLevel ? `第 ${format(records.bestLevel)} 关` : '暂无纪录';
  $('#total-cleared').textContent = format(records.totalCleared);
  $('#ranking-empty').hidden = records.bestScore > 0;
  $('#ranking-record').hidden = !records.bestScore;
  $('#rank-level').textContent = records.bestLevel ? `最高通过第 ${format(records.bestLevel)} 关` : '挑战纪录';
  $('#rank-score').replaceChildren(document.createTextNode(format(records.bestScore)));
  const unit = document.createElement('span');
  unit.textContent = '分';
  $('#rank-score').append(unit);
  $('#continue-game').disabled = !game;
  $('#continue-detail').textContent = game ? `第 ${game.level} 关 · ${format(totalScore(game))} 分${game.phase !== 'playing' ? ' · 已结算' : ''}` : '暂无存档';
  $('#restart-message').textContent = game ? `重新开始将替换第 ${game.level} 关的当前进度，从第 1 关、0 分开始。历史最高分会保留。` : '新的一局将从第 1 关、0 分开始，历史最高分会保留。';
}
function syncSettings() {
  $('#setting-confirm').checked = settings.confirm;
  $('#setting-motion').checked = settings.reducedMotion;
  $('#setting-sound').checked = settings.sound;
  $('#setting-volume').value = settings.volume;
  $('#setting-volume-label').textContent = `${Math.round(settings.volume * 100)}%`;
  $('#music-toggle').setAttribute('aria-label', settings.sound ? '关闭音效' : '开启音效');
  $('#music-toggle').setAttribute('aria-pressed', String(settings.sound));
  $('#music-toggle').title = settings.sound ? '关闭音效' : '开启音效';
  $('#music-label').textContent = settings.sound ? '音效开' : '音效关';
  $('#music-icon').setAttribute('href', settings.sound ? '#i-music' : '#i-music-off');
  sounds.configure({ enabled: settings.sound, volume: settings.volume });
  document.body.classList.toggle('reduced-motion', settings.reducedMotion);
  $('#input-mode').textContent = settings.confirm ? '先选中，再点一次' : '点击消除';
}
function closeDialog(dialog) { if (dialog?.open) dialog.close(); }
function closeAllDialogs() { document.querySelectorAll('dialog[open]').forEach(closeDialog); }
function openDialog(id) {
  const dialog = document.getElementById(id);
  if (!dialog || dialog.open) return false;
  if (id !== 'result-dialog') sounds.stop();
  closeAllDialogs();
  dialog.showModal();
  return true;
}
function showHome() {
  if (busy) return;
  sounds.stop();
  closeAllDialogs();
  showingGame = false;
  $('#game-screen').hidden = true;
  $('#home-screen').hidden = false;
  document.body.classList.remove('playing');
  syncRecords();
  $('#continue-game').focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}
function showGame() {
  sounds.stop();
  void sounds.warmup();
  hideSettlement();
  closeAllDialogs();
  skins = levelSkins(game.seed);
  prepareResultIllustration();
  showingGame = true;
  $('#home-screen').hidden = true;
  $('#game-screen').hidden = false;
  document.body.classList.add('playing');
  clearSelection();
  nodes.forEach((node) => node.remove());
  nodes.clear();
  focusedId = null;
  renderBoard(game.board);
  renderScore();
  window.scrollTo({ top: 0 });
  if (game.phase !== 'playing') showResult();
  else nodes.get(focusedId)?.focus({ preventScroll: true });
}
async function startGame() {
  if (busy) return;
  setBusy(true);
  $('#confirm-restart').disabled = true;
  const cloudRun = await cloud.client.beginRun();
  game = createGame(cloudRun ? competitionSeed(cloudRun.seed, 1) : newSeed(), cloudRun?.id || `run-${Date.now()}-${newSeed().toString(16)}`);
  if (cloudRun) game.cloudRun = cloudRun;
  else if (cloud.client.enabled) toast(cloud.client.lastRunError || '暂时无法领取联网对局，本局保留本机纪录。');
  persist();
  setBusy(false);
  $('#confirm-restart').disabled = false;
  showGame();
}
function requestRestart() { if (!busy) openDialog('restart-dialog'); }
function setBusy(value) {
  busy = value;
  $('#board').setAttribute('aria-busy', String(value));
  $('#board').classList.toggle('busy', value);
  for (const id of ['game-home', 'pause-game', 'game-restart']) $(`#${id}`).disabled = value;
  document.querySelectorAll('.header-tools button[data-open]').forEach((button) => { button.disabled = value; });
}
function placeTile(element, x, y) {
  element.style.left = `${x * 10}%`;
  element.style.top = `${(9 - y) * 10}%`;
}
function renderBoard(board, intermediate = false) {
  const all = positions(board);
  const nextIds = new Set(all.keys());
  for (const [id, node] of nodes) {
    if (!nextIds.has(id)) { node.remove(); nodes.delete(id); }
  }
  if (!nextIds.has(focusedId)) focusedId = nextIds.values().next().value ?? null;
  for (const [id, { x, y, tile }] of all) {
    let element = nodes.get(id);
    if (!element) {
      element = document.createElement('button');
      element.type = 'button';
      element.className = 'tile';
      element.dataset.tileId = id;
      element.dataset.type = String(tile.type);
      const face = document.createElement('span');
      face.className = 'tile-face';
      face.style.backgroundColor = skins[tile.type].color;
      if (skins[tile.type].image) {
        const image = document.createElement('img');
        image.src = skins[tile.type].image;
        image.alt = '';
        image.draggable = false;
        image.addEventListener('load', () => face.classList.add('has-art'), { once: true });
        image.addEventListener('error', () => image.remove(), { once: true });
        face.append(image);
      }
      element.append(face);
      nodes.set(id, element);
      $('#board').append(element);
    }
    element.dataset.x = String(x);
    element.dataset.y = String(y);
    element.setAttribute('aria-label', `${skins[tile.type].name}${skins[tile.type].characterName}奶龙，第 ${x + 1} 列，从下数第 ${y + 1} 格`);
    element.tabIndex = id === focusedId ? 0 : -1;
    element.classList.remove('removing', 'selected', 'settling-remove');
    element.setAttribute('aria-pressed', 'false');
    placeTile(element, x, y);
  }
  if (!intermediate) $('#board').dataset.remaining = String(tileCount(board));
}
function renderScore(displayBonus = game.bonus, displayBest = records.bestScore) {
  const total = game.priorScore + game.levelScore + displayBonus;
  const target = targetScore(game.level);
  const reached = total >= target;
  $('#level-heading').textContent = `第 ${format(game.level)} 关`;
  $('#game-total').textContent = format(total);
  $('#game-target').textContent = format(target);
  $('#game-prior').textContent = format(game.priorScore);
  $('#game-level-score').textContent = format(game.levelScore);
  $('#game-best').textContent = format(displayBest);
  $('#game-level-total').textContent = format(game.levelScore + displayBonus);
  $('#target-gap').textContent = reached ? '已达标' : `还差 ${format(target - total)}`;
  $('#target-status').textContent = reached ? '已达标' : '未达标';
  $('#target-status').classList.toggle('reached', reached);
  $('#target-progress').value = Math.min(100, total / target * 100);
  $('#remaining-count').textContent = String(tileCount(game.board));
  const count = tileCount(game.board);
  $('#remaining-count').textContent = String(game.phase !== 'playing' && nodes.size === 0 ? 0 : count);
  $('#bonus-preview').textContent = count < 10 ? `当前剩余奖励 ${format(remainderBonus(count))} 分 · 结算发放` : '剩余少于 10 块时有结算奖励';
  resetFeedback();
}
function resetFeedback() {
  $('#move-feedback').textContent = game?.lastMove ? `上次消除 ${game.lastMove.count} 块，获得 ${format(game.lastMove.score)} 分` : '点击两个及以上相连的同色方块';
}
function clearSelection() {
  selectedIds = [];
  nodes.forEach((node) => { node.classList.remove('selected'); node.setAttribute('aria-pressed', 'false'); });
  if (game) resetFeedback();
}
function previewGroup(id) {
  if (busy || !showingGame || game.phase !== 'playing') return;
  clearSelection();
  selectedIds = connectedGroup(game.board, id);
  if (selectedIds.length < 2) { selectedIds = []; return; }
  for (const tileId of selectedIds) {
    nodes.get(tileId)?.classList.add('selected');
    nodes.get(tileId)?.setAttribute('aria-pressed', 'true');
  }
  $('#move-feedback').textContent = `${selectedIds.length} 块相连 · 可得 ${format(eliminationScore(selectedIds.length))} 分${settings.confirm ? ' · 再点一次消除' : ''}`;
}
const delay = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
async function activateTile(id) {
  if (busy || !showingGame || game?.phase !== 'playing' || document.querySelector('dialog[open]')) return;
  const group = connectedGroup(game.board, id);
  if (group.length < 2) { clearSelection(); $('#move-feedback').textContent = '至少两个相连的同色方块才能消除'; return; }
  if (settings.confirm && !selectedIds.includes(id)) { previewGroup(id); return; }
  const result = playMove(game, id);
  if (!result) return;
  const hadBoardFocus = $('#board').contains(document.activeElement);
  const oldPosition = positions(game.board).get(id);
  void sounds.play(oldPosition.tile.type, result.count);
  const revision = ++animationRevision;
  setBusy(true);
  clearSelection();
  game = result.game;
  const previousBest = records.bestScore;
  updateRecords(result.count);
  persist();
  renderScore(0, Math.max(previousBest, game.priorScore + game.levelScore));
  $('#move-feedback').textContent = `消除 ${result.count} 块，获得 ${format(result.score)} 分`;
  if (!reducedMotion()) {
    const pop = $('#score-pop');
    pop.textContent = `+${format(result.score)}`;
    pop.style.left = `${Math.min(80, Math.max(10, oldPosition.x * 10 + 5))}%`;
    pop.style.top = `${Math.max(10, (9 - oldPosition.y) * 10)}%`;
    pop.classList.remove('visible');
    void pop.offsetWidth;
    pop.classList.add('visible');
    result.group.forEach((tileId) => nodes.get(tileId)?.classList.add('removing'));
    await delay(140);
    if (revision !== animationRevision) return;
    renderBoard(result.fallen, true);
    await delay(180);
    if (revision !== animationRevision) return;
    renderBoard(game.board);
    await delay(180);
    if (revision !== animationRevision) return;
  } else renderBoard(game.board);
  if (game.phase !== 'playing') {
    if (!reducedMotion()) await animateSettlement(revision);
    if (revision !== animationRevision) return;
    renderScore();
    setBusy(false);
    showResult();
  } else {
    setBusy(false);
    if (hadBoardFocus) nodes.get(focusedId)?.focus({ preventScroll: true });
  }
}
function hideSettlement() {
  $('#settlement-overlay').hidden = true;
  $('#reward-card').classList.remove('flying');
  rewardFlight?.cancel();
  rewardFlight = null;
}

async function animateSettlement(revision) {
  skipSettlement = false;
  const overlay = $('#settlement-overlay');
  const card = $('#reward-card');
  const reward = $('#reward-value');
  const remaining = [...positions(game.board).values()].sort((a, b) => b.y - a.y || a.x - b.x);
  const count = remaining.length;
  const stillCurrent = () => revision === animationRevision;
  overlay.hidden = false;
  $('#settlement-skip').focus({ preventScroll: true });
  reward.textContent = format(2000);
  $('#reward-step').textContent = count ? `剩余 ${count} 块，依次清除` : '全部消除';
  $('#move-feedback').textContent = '盘面已结束，正在结算奖励';
  await delay(320);
  const interval = Math.max(32, Math.min(140, 1900 / Math.max(1, count)));
  for (let i = 0; i < count && stillCurrent() && !skipSettlement; i += 1) {
    const node = nodes.get(remaining[i].tile.id);
    node?.classList.add('settling-remove');
    reward.textContent = format(remainderBonus(i + 1));
    $('#remaining-count').textContent = String(count - i - 1);
    $('#reward-step').textContent = `剩余 ${count - i - 1} 块${i >= 9 ? ' · 奖励已扣至 0' : ''}`;
    await delay(interval);
    if (!stillCurrent()) return;
    node?.remove();
    nodes.delete(remaining[i].tile.id);
  }
  if (!stillCurrent()) return;
  // This cleanup is visual; the saved board retains the actual terminal remainder.
  nodes.forEach((node) => node.remove());
  nodes.clear();
  reward.textContent = format(game.bonus);
  $('#remaining-count').textContent = '0';
  $('#reward-step').textContent = game.bonus ? '奖励加入本关得分' : '本关无剩余奖励';
  if (!skipSettlement) await delay(320);
  if (!stillCurrent()) return;
  if (!skipSettlement) {
    const from = reward.getBoundingClientRect();
    const to = $('#game-level-total').getBoundingClientRect();
    card.classList.add('flying');
    rewardFlight = reward.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${to.x + to.width / 2 - from.x - from.width / 2}px, ${to.y + to.height / 2 - from.y - from.height / 2}px) scale(.4)`, opacity: 0.3 },
    ], { duration: 520, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    try { await rewardFlight.finished; } catch { /* A skip or newer saved state canceled presentation. */ }
  }
  if (!stillCurrent()) return;
  hideSettlement();
  const line = $('.level-total-line');
  line.classList.remove('reward-added');
  void line.offsetWidth;
  line.classList.add('reward-added');
  if (!skipSettlement && game.bonus) {
    for (let i = 1; i <= 10 && stillCurrent() && !skipSettlement; i += 1) {
      renderScore(Math.round(game.bonus * i / 10));
      await delay(30);
    }
  }
}

function prepareResultIllustration() {
  const mascot = resultMascotForSeed(game.seed);
  const dialog = $('#result-dialog');
  dialog.style.setProperty('--mascot-crop', mascot.cropFraction);
  dialog.style.setProperty('--mascot-fit', mascot.fit);
  dialog.dataset.mascotId = mascot.id;
  const image = $('#result-mascot');
  if (image.dataset.mascotId === mascot.id) return;
  image.dataset.mascotId = mascot.id;
  image.alt = `${mascot.color}${mascot.pose}奶龙`;
  image.hidden = true;
  image.onload = () => { image.hidden = false; };
  image.src = mascot.image;
  if (image.complete && image.naturalWidth) image.hidden = false;
}

function showResult() {
  prepareResultIllustration();
  const passed = game.phase === 'passed';
  if (!passed) cloud.client.remember(game);
  $('#result-upload').hidden = passed;
  $('#result-upload').disabled = !game.cloudRun || !cloud.client.enabled;
  $('#result-upload-note').hidden = passed;
  $('#result-upload-note').textContent = game.cloudRun ? '可稍后在排行榜中补传战绩。' : cloud.client.enabled ? '此局为本地对局；联网开始的新对局可以上榜。' : '云端排行榜尚未开放，本机纪录已保留。';
  const total = totalScore(game);
  $('#result-stage').textContent = `第 ${format(game.level)} 关结算`;
  $('#result-title').textContent = passed ? '本关通过' : '奶龙吃掉了你的脑子';
  for (const [id, value] of [
    ['result-total', total], ['result-prior', game.priorScore], ['result-score', game.levelScore],
    ['result-remaining', tileCount(game.board)], ['result-bonus', game.bonus],
    ['result-level-total', game.levelScore + game.bonus], ['result-best', records.bestScore],
  ]) $(`#${id}`).textContent = format(value);
  $('#result-target').textContent = `本关目标 ${format(targetScore(game.level))}`;
  $('#result-action').textContent = passed ? `进入第 ${format(game.level + 1)} 关` : '重新开始';
  $('#result-dialog').classList.toggle('passed', passed);
  if (openDialog('result-dialog')) void sounds.playResult();
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.open) openDialog(button.dataset.open);
  if (button.hasAttribute('data-close')) closeDialog(button.closest('dialog'));
});
for (const dialog of document.querySelectorAll('dialog')) {
  let backdropPressed = false;
  const outside = (event) => {
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  };
  dialog.addEventListener('pointerdown', (event) => { backdropPressed = event.target === dialog && outside(event); });
  dialog.addEventListener('click', (event) => {
    if (!dialog.hasAttribute('data-persistent') && backdropPressed && event.target === dialog && outside(event)) closeDialog(dialog);
    backdropPressed = false;
  });
  if (dialog.hasAttribute('data-persistent')) dialog.addEventListener('cancel', (event) => event.preventDefault());
}
for (const [id, field] of [['setting-confirm', 'confirm'], ['setting-motion', 'reducedMotion'], ['setting-sound', 'sound']]) {
  $(`#${id}`).addEventListener('change', (event) => {
    settings[field] = event.target.checked;
    clearSelection();
    syncSettings();
    writeStorage(KEYS.settings, settings);
    if (field === 'sound' && settings.sound) void sounds.warmup();
  });
}
$('#music-toggle').addEventListener('click', () => {
  settings.sound = !settings.sound;
  syncSettings();
  writeStorage(KEYS.settings, settings);
  if (settings.sound) void sounds.warmup();
});
$('#setting-volume').addEventListener('input', (event) => {
  settings.volume = Number(event.target.value);
  syncSettings();
  writeStorage(KEYS.settings, settings);
});
function selectRankingTab(tab) {
  const local = tab.id === 'local-tab';
  for (const [id, selected] of [['local-tab', local], ['online-tab', !local]]) {
    $(`#${id}`).setAttribute('aria-selected', String(selected));
    $(`#${id}`).tabIndex = selected ? 0 : -1;
  }
  $('#local-ranking').hidden = !local;
  $('#online-ranking').hidden = local;
  if (!local) void cloud.refresh();
}
for (const tab of document.querySelectorAll('.ranking-tabs [role="tab"]')) {
  tab.addEventListener('click', () => selectRankingTab(tab));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? $('#local-tab') : event.key === 'End' ? $('#online-tab') : tab.id === 'local-tab' ? $('#online-tab') : $('#local-tab');
    selectRankingTab(next);
    next.focus();
  });
}
$('#start-game').addEventListener('click', () => game ? requestRestart() : startGame());
$('#continue-game').addEventListener('click', () => { if (game) showGame(); });
for (const id of ['restart-game', 'game-restart', 'pause-restart']) $(`#${id}`).addEventListener('click', requestRestart);
$('#confirm-restart').addEventListener('click', startGame);
for (const id of ['game-home', 'pause-home', 'result-home']) $(`#${id}`).addEventListener('click', showHome);
$('.brand').addEventListener('click', (event) => { event.preventDefault(); showHome(); });
$('#pause-game').addEventListener('click', () => { if (!busy) openDialog('pause-dialog'); });
$('#result-action').addEventListener('click', () => {
  if (game.phase === 'passed') { game = nextLevel(game, game.cloudRun ? competitionSeed(game.cloudRun.seed, game.level + 1) : newSeed()); persist(); showGame(); }
  else if (game.phase === 'failed') startGame();
});
$('#settlement-skip').addEventListener('click', () => { skipSettlement = true; rewardFlight?.cancel(); });
$('#board').addEventListener('click', (event) => {
  const tile = event.target.closest('.tile');
  if (tile) void activateTile(tile.dataset.tileId);
});
$('#board').addEventListener('pointerover', (event) => {
  if (settings.confirm || event.pointerType !== 'mouse') return;
  const tile = event.target.closest('.tile');
  if (tile && !tile.contains(event.relatedTarget)) previewGroup(tile.dataset.tileId);
});
$('#board').addEventListener('pointerleave', () => { if (!settings.confirm && !busy) clearSelection(); });
$('#board').addEventListener('keydown', (event) => {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) || busy) return;
  const tile = event.target.closest('.tile');
  if (!tile) return;
  event.preventDefault();
  const all = positions(game.board);
  const position = all.get(tile.dataset.tileId);
  const [dx, dy] = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[event.key];
  const next = [...all.entries()].find(([, p]) => p.x === position.x + dx && p.y === position.y + dy);
  if (next) {
    focusedId = next[0];
    nodes.forEach((node, id) => { node.tabIndex = id === focusedId ? 0 : -1; });
    nodes.get(focusedId).focus();
    if (!settings.confirm) previewGroup(focusedId);
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && showingGame && !busy && game.phase === 'playing' && !document.querySelector('dialog[open]')) openDialog('pause-dialog');
});
window.addEventListener('storage', (event) => {
  if (event.key === KEYS.settings || event.key === null) { settings = readSettings(); syncSettings(); clearSelection(); }
  if (event.key === KEYS.session || event.key === null) {
    sounds.stop();
    const updated = readStorage(KEYS.session);
    animationRevision += 1;
    hideSettlement();
    setBusy(false);
    game = restoreGame(updated?.game);
    records = sanitizeRecords(updated?.records);
    syncRecords();
    if (showingGame) { if (game) showGame(); else showHome(); toast('进度已在另一个页面更新。'); }
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) sounds.stop(); });
const cloud = setupLeaderboard({ toast, openDialog, onUploaded: () => { openDialog('ranking-dialog'); selectRankingTab($('#online-tab')); } });
$('#result-upload').addEventListener('click', () => { if (game?.phase === 'failed') void cloud.upload(game); });
syncSettings();
syncRecords();
if (savedSession?.game && !game) toast('存档无法恢复，历史纪录已保留。可以开始新的一局。');
