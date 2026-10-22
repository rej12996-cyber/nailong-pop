import { AVATARS } from './avatars.js';
import { CLOUD_API_BASE } from './cloud-config.js';
import { replayPayload } from './competition.js';
import { isBeta, storageKey } from './environment.js';

const KEY = storageKey('nailong.cloud.v1');
const QUEUE_KEY = storageKey('nailong.pending.v1');
const randomKey = () => [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
export const beijingDate = timestamp => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));

export class CloudClient {
  constructor({ base = CLOUD_API_BASE, storage, fetcher = (url, options) => globalThis.fetch(url, options) } = {}) {
    if (!storage) { try { storage = globalThis.localStorage; } catch { /* Private browsing can disable storage. */ } }
    storage ||= { getItem: () => null, setItem: () => { throw new Error('Storage unavailable'); } };
    this.base = base.replace(/\/$/, ''); this.storage = storage; this.fetcher = fetcher;
    this.state = this.read(KEY, {});
    if (!this.state || typeof this.state !== 'object' || Array.isArray(this.state)) this.state = {};
    if (!/^[a-f0-9]{64}$/.test(this.state.clientKey || '')) this.state.clientKey = randomKey();
    this.save();
  }
  get enabled() { return !!this.base; }
  read(key, fallback) { try { return JSON.parse(this.storage.getItem(key)) ?? fallback; } catch { return fallback; } }
  write(key, value) { this.storage.setItem(key, JSON.stringify(value)); }
  save() { try { this.write(KEY, this.state); this.persistent = true; } catch { this.persistent = false; } }
  async request(endpoint, { method = 'GET', data, auth = true } = {}) {
    if (!this.enabled) throw new Error('云端排行榜尚未开放，本机游戏和纪录照常保留。');
    const headers = {};
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && this.state.token) headers.Authorization = `Bearer ${this.state.token}`;
    let response;
    try { response = await this.fetcher(`${this.base}${endpoint}`, { method, headers, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(20000), credentials: 'omit', cache: 'no-store' }); }
    catch { throw new Error('暂时连不上排行榜服务器，请稍后重试。'); }
    let result;
    try { result = await response.json(); } catch { throw new Error('排行榜响应异常，请稍后重试。'); }
    if (!response.ok) {
      if (response.status === 401 && auth) { delete this.state.token; delete this.state.player; this.save(); }
      const error = new Error(result.error || '操作失败，请稍后重试。'); error.status = response.status; throw error;
    }
    return result;
  }
  async beginRun() {
    this.lastRunError = '';
    if (!this.enabled) return null;
    if (!this.persistent) { this.lastRunError = '浏览器无法保存联网身份，本局仅保留本机纪录。'; return null; }
    try { return await this.request('/runs', { method: 'POST', data: { clientKey: this.state.clientKey }, auth: false }); }
    catch (error) { this.lastRunError = error.message; return null; }
  }
  remember(game) {
    const payload = replayPayload(game);
    if (!payload) return false;
    if (this.state.uploaded?.includes(game.runId)) return true;
    const queue = this.pending().filter(entry => entry.runId !== game.runId);
    queue.push({ runId: game.runId, payload, clientKey: this.state.clientKey, score: game.priorScore + game.levelScore + game.bonus, level: game.level, endedAt: Date.now() });
    try { this.write(QUEUE_KEY, queue.slice(-10)); return true; } catch { return false; }
  }
  pending() {
    const queue = this.read(QUEUE_KEY, []);
    return Array.isArray(queue) ? queue.filter(entry => entry && typeof entry.runId === 'string' && Number.isSafeInteger(entry.score) && Number.isInteger(entry.level) && !this.state.uploaded?.includes(entry.runId)) : [];
  }
  async profile() {
    if (!this.state.token) return null;
    const { player } = await this.request('/me'); this.state.player = player; this.save(); return player;
  }
  async saveProfile(data) {
    let result;
    if (this.state.token) result = await this.request('/me', { method: 'PATCH', data });
    else {
      this.state.creationToken ||= randomKey(); this.save();
      result = await this.request('/players', { method: 'POST', data: { ...data, token: this.state.creationToken }, auth: false });
      this.state.token = this.state.creationToken; delete this.state.creationToken;
    }
    this.state.player = result.player; this.save(); return result.player;
  }
  async recover(code) {
    const result = await this.request('/recover', { method: 'POST', data: { code }, auth: false });
    this.state.token = result.token; this.state.player = result.player; delete this.state.creationToken; this.save(); return result.player;
  }
  async upload(runId) {
    const entry = this.pending().find(item => item.runId === runId);
    if (!entry) throw new Error('待上传战绩不存在。');
    const result = await this.request('/scores', { method: 'POST', data: { ...entry.payload, clientKey: entry.clientKey } });
    this.state.uploaded = [...(Array.isArray(this.state.uploaded) ? this.state.uploaded : []), runId].slice(-200); this.save();
    try { this.write(QUEUE_KEY, this.pending().filter(item => item.runId !== runId)); } catch { /* The server has already accepted the replay. */ }
    return result;
  }
}

export function setupLeaderboard({ toast, openDialog, onUploaded }) {
  const client = new CloudClient();
  const $ = id => document.getElementById(id);
  let selectedAvatar = AVATARS[0].id;
  let uploadRunId = null;
  let operating = false;
  const boardName = isBeta ? '内测总榜' : '永久总榜';
  document.querySelector('#online-tab span').textContent = client.enabled ? boardName : '待开放';
  function notice(text) { $('cloud-message').textContent = text; }
  function makeRow(row, mine = false) {
    const element = document.createElement('div'); element.className = `cloud-rank-row${mine ? ' is-me' : ''}`;
    const rank = document.createElement('strong'); rank.className = 'cloud-rank'; rank.textContent = String(row.rank);
    const image = document.createElement('img'); image.src = AVATARS.find(item => item.id === row.avatar)?.image || AVATARS[0].image; image.alt = ''; image.loading = 'lazy';
    const info = document.createElement('div'); info.className = 'cloud-rank-info';
    const name = document.createElement('strong'); name.textContent = row.name;
    const detail = document.createElement('small'); detail.textContent = `到达第 ${row.level} 关 · ${beijingDate(row.submittedAt)}`;
    info.append(name, detail);
    const score = document.createElement('strong'); score.className = 'cloud-rank-score'; score.textContent = row.score.toLocaleString('zh-CN');
    element.append(rank, image, info, score); return element;
  }
  function renderPending() {
    $('cloud-pending').replaceChildren();
    for (const entry of client.pending().slice().reverse()) {
      const row = document.createElement('div'); row.className = 'cloud-pending-row';
      const label = document.createElement('span'); label.textContent = `${entry.score.toLocaleString('zh-CN')} 分 · 第 ${entry.level} 关`;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'cloud-text-button'; button.textContent = '上传';
      button.addEventListener('click', () => void editProfile(entry.runId)); row.append(label, button); $('cloud-pending').append(row);
    }
    $('cloud-pending-section').hidden = !client.pending().length;
  }
  function renderProfile() {
    const player = client.state.player;
    $('cloud-profile-label').textContent = player ? `${player.name} · 修改资料` : '设置玩家资料';
    $('cloud-code-button').hidden = !player;
    $('cloud-code-button').textContent = player?.hasRecovery ? '更换恢复码（旧码失效）' : '生成身份恢复码';
    $('cloud-identity-note').textContent = (player ? '身份保存在当前浏览器。更换设备或域名前，请保存恢复码。' : '首次上传时设置头像和昵称；有恢复码可先找回原身份。') + (isBeta ? ' 内测身份与战绩不带入正式服。' : '');
    renderPending();
  }
  async function refresh() {
    renderProfile();
    if (!client.enabled) { notice('云端排行榜尚未开放。正式入口就绪后启用，本机纪录继续保留。'); return; }
    notice('正在读取排行榜…');
    try {
      if (client.state.token) await client.profile();
      const result = await client.request('/leaderboard');
      $('cloud-top').replaceChildren(...result.top.map(row => makeRow(row, row.id === client.state.player?.id)));
      $('cloud-my-rank').replaceChildren();
      if (result.me) $('cloud-my-rank').append(makeRow(result.me, true));
      else $('cloud-my-rank').textContent = '我的排名：尚未上传有效战绩';
      notice(result.totalPlayers ? `${boardName} · ${result.totalPlayers.toLocaleString('zh-CN')} 人上榜 · 前100名` : '暂无云端战绩，等待第一位玩家。');
      renderProfile();
    } catch (error) { notice(error.message); renderProfile(); }
  }
  const avatarButtons = new Map();
  function pickAvatar(id) {
    selectedAvatar = id;
    for (const [value, button] of avatarButtons) button.setAttribute('aria-pressed', String(value === id));
  }
  for (const avatar of AVATARS) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'avatar-option';
    button.setAttribute('aria-label', avatar.label); button.title = avatar.label;
    const image = document.createElement('img'); image.src = avatar.image; image.alt = ''; image.loading = 'lazy';
    button.append(image); button.addEventListener('click', () => pickAvatar(avatar.id));
    avatarButtons.set(avatar.id, button); $('cloud-avatars').append(button);
  }
  async function editProfile(runId = null) {
    if (!client.enabled) { toast('云端排行榜尚未开放，本机纪录已保留。'); return; }
    uploadRunId = runId;
    $('cloud-profile-error').textContent = '';
    $('cloud-name').value = client.state.player?.name || '';
    pickAvatar(client.state.player?.avatar || selectedAvatar);
    $('cloud-profile-submit').textContent = runId ? '保存资料并上传战绩' : '保存玩家资料';
    openDialog('cloud-profile-dialog');
  }
  $('cloud-profile-form').addEventListener('submit', async event => {
    event.preventDefault(); if (operating) return;
    operating = true; $('cloud-profile-submit').disabled = true; $('cloud-profile-error').textContent = '正在提交…';
    try {
      await client.saveProfile({ name: $('cloud-name').value, avatar: selectedAvatar });
      if (uploadRunId) {
        const result = await client.upload(uploadRunId);
        toast(result.duplicate ? '这局战绩已经上传。' : result.improved ? '战绩已上榜！' : '上传成功，榜单保留你的最高分。');
      } else toast('玩家资料已保存。');
      $('cloud-profile-dialog').close(); renderProfile(); onUploaded(); void refresh();
      if (!client.persistent) toast('当前浏览器无法保存身份，请立即生成并保存恢复码。');
    } catch (error) { $('cloud-profile-error').textContent = error.message; }
    finally { operating = false; $('cloud-profile-submit').disabled = false; }
  });
  $('cloud-profile-button').addEventListener('click', () => void editProfile());
  $('cloud-refresh').addEventListener('click', () => void refresh());
  $('cloud-recover-button').addEventListener('click', () => { $('cloud-recover-error').textContent = ''; openDialog('cloud-recover-dialog'); });
  $('cloud-profile-recover').addEventListener('click', () => { $('cloud-recover-error').textContent = ''; openDialog('cloud-recover-dialog'); });
  $('cloud-recover-form').addEventListener('submit', async event => {
    event.preventDefault(); if (operating) return;
    operating = true; $('cloud-recover-submit').disabled = true;
    try {
      await client.recover($('cloud-recover-input').value); $('cloud-recover-input').value = '';
      $('cloud-recover-dialog').close(); toast('已找回玩家身份。'); onUploaded(); void refresh();
    } catch (error) { $('cloud-recover-error').textContent = error.message; }
    finally { operating = false; $('cloud-recover-submit').disabled = false; }
  });
  $('cloud-code-button').addEventListener('click', async () => {
    if (operating) return; operating = true; $('cloud-code-button').disabled = true;
    try {
      const result = await client.request('/recovery-code', { method: 'POST', data: {} });
      client.state.player.hasRecovery = true; client.save();
      $('cloud-recovery-code').value = result.code; openDialog('cloud-code-dialog'); renderProfile();
    } catch (error) { toast(error.message); }
    finally { operating = false; $('cloud-code-button').disabled = false; }
  });
  $('cloud-copy-code').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('cloud-recovery-code').value); toast('恢复码已复制，请妥善保存。'); }
    catch { $('cloud-recovery-code').select(); toast('请手动复制恢复码。'); }
  });
  $('cloud-code-dialog').addEventListener('close', () => { $('cloud-recovery-code').value = ''; });
  renderProfile();
  return { client, refresh, upload: game => { client.remember(game); return editProfile(game.runId); } };
}
