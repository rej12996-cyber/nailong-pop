// Columns run left to right; tiles in each column run bottom to top.
// Rendering and skins never determine whether two tiles can be matched.
export const SIZE = 10;
export const TYPE_COUNT = 5;
export const RULES_VERSION = 'popstar-target-v3';
export const SCHEMA_VERSION = 2;
export const GENERATION_VERSION = 3;
const FIRST_TARGETS = [1000, 3000, 5200, 7500, 10000];
export function targetScore(level) {
  if (level <= FIRST_TARGETS.length) return FIRST_TARGETS[level - 1];
  if (level <= 8) return 10000 + 3000 * (level - 5);
  const steps = level - 8;
  return 19000 + 3000 * steps + 50 * steps * (steps + 1);
}
const previousTarget = (level, version) => version === 'popstar-v1'
  ? 1000 + 2000 * (level - 1)
  : version === 'popstar-target-v2'
    ? (level <= FIRST_TARGETS.length ? FIRST_TARGETS[level - 1] : 10000 + 2500 * (level - 5))
    : targetScore(level);
export const eliminationScore = (count) => count >= 2 ? 5 * count * count : 0;
export const remainderBonus = (count) => Math.max(0, 2000 - 20 * count * count);
export const tileCount = (board) => board.reduce((sum, column) => sum + column.length, 0);
export const totalScore = (game) => game.priorScore + game.levelScore + game.bonus;

export function randomFromSeed(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

export function shuffle(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function dominantColors(seed) {
  const random = randomFromSeed(seed ^ 0xA341316C);
  const count = random() < 0.5 ? 1 : 2;
  return shuffle([0, 1, 2, 3, 4], random).slice(0, count);
}

export const levelDominantColors = (seed, level) => targetScore(level) >= 19000 ? [] : dominantColors(seed);

export function characterMapping(seed) {
  // Separate random streams: changing skins must never change the playable board.
  return shuffle([0, 1, 2, 3, 4, 5, 6], randomFromSeed(seed ^ 0xC8013EA4)).slice(0, TYPE_COUNT);
}

export function generateBoard(seed, dominantTypes = dominantColors(seed), version = GENERATION_VERSION) {
  const random = randomFromSeed(seed);
  let board;
  do {
    if (version === 1 || (version >= 3 && dominantTypes.length === 0)) {
      // Legacy saves and later levels use independent equal-probability draws.
      board = Array.from({ length: SIZE }, (_, x) => Array.from({ length: SIZE }, (_, y) => ({
        id: `${x}-${y}`, type: Math.floor(random() * TYPE_COUNT),
      })));
    } else {
      const dominantCount = dominantTypes.length === 1 ? 28 : 26;
      const otherCount = dominantTypes.length === 1 ? 18 : 16;
      const bag = shuffle(Array.from({ length: TYPE_COUNT }, (_, type) =>
        Array(dominantTypes.includes(type) ? dominantCount : otherCount).fill(type)).flat(), random);
      board = Array.from({ length: SIZE }, (_, x) => Array.from({ length: SIZE }, (_, y) => ({
        id: `${x}-${y}`, type: bag[x * SIZE + y],
      })));
    }
  } while (!hasMoves(board));
  return board;
}

export function positions(board) {
  return new Map(board.flatMap((column, x) => column.map((tile, y) => [tile.id, { x, y, tile }])));
}

export function connectedGroup(board, id) {
  const all = positions(board);
  const start = all.get(id);
  if (!start) return [];
  const visited = new Set([id]);
  const pending = [start];
  while (pending.length) {
    const { x, y } = pending.pop();
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      const tile = board[nx]?.[ny];
      if (tile?.type !== start.tile.type || visited.has(tile.id)) continue;
      visited.add(tile.id);
      pending.push({ x: nx, y: ny });
    }
  }
  return [...visited];
}

export function hasMoves(board) {
  return board.some((column, x) => column.some((tile, y) =>
    column[y + 1]?.type === tile.type || board[x + 1]?.[y]?.type === tile.type));
}

export function removeGroup(board, id) {
  const group = connectedGroup(board, id);
  if (group.length < 2) return null;
  const removed = new Set(group);
  // Retaining the intermediate columns lets the UI animate gravity before sliding.
  const fallen = board.map((column) => column.filter((tile) => !removed.has(tile.id)));
  const collapsed = fallen.filter((column) => column.length > 0);
  return { group, fallen, board: collapsed, count: group.length, score: eliminationScore(group.length) };
}

export function createGame(seed, runId = 'local', options = {}) {
  const generationVersion = options.generationVersion ?? GENERATION_VERSION;
  const dominantTypes = options.dominantTypes ?? levelDominantColors(seed, 1);
  return {
    schemaVersion: SCHEMA_VERSION, rulesVersion: RULES_VERSION, runId,
    generationVersion, dominantTypes,
    level: 1, seed: seed >>> 0, priorScore: 0, levelScore: 0, bonus: 0,
    phase: 'playing', board: generateBoard(seed, dominantTypes, generationVersion), moves: [], completed: [], lastMove: null,
  };
}

export function settleGame(game) {
  if (game.phase !== 'playing' || hasMoves(game.board)) return game;
  const bonus = remainderBonus(tileCount(game.board));
  const passed = game.priorScore + game.levelScore + bonus >= targetScore(game.level);
  return { ...game, bonus, phase: passed ? 'passed' : 'failed' };
}

export function playMove(game, id) {
  if (game.phase !== 'playing') return null;
  const result = removeGroup(game.board, id);
  if (!result) return null;
  const move = { id, count: result.count, score: result.score };
  const updated = {
    ...game, board: result.board, levelScore: game.levelScore + result.score,
    moves: [...game.moves, move], lastMove: move,
  };
  return { ...result, game: settleGame(updated) };
}

export function nextLevel(game, seed) {
  if (game.phase !== 'passed') return game;
  const level = game.level + 1;
  const dominantTypes = levelDominantColors(seed, level);
  return {
    ...game, level, seed: seed >>> 0, priorScore: totalScore(game),
    rulesVersion: RULES_VERSION, generationVersion: GENERATION_VERSION, dominantTypes,
    levelScore: 0, bonus: 0, phase: 'playing', board: generateBoard(seed, dominantTypes), moves: [], lastMove: null,
    completed: [...game.completed, {
      seed: game.seed, moves: game.moves, score: game.levelScore, bonus: game.bonus,
      generationVersion: game.generationVersion, dominantTypes: game.dominantTypes,
    }],
  };
}

const countValue = (value) => Number.isSafeInteger(value) && value >= 0;
const seedValue = (value) => countValue(value) && value <= 0xFFFFFFFF;
const movesValue = (moves) => Array.isArray(moves) && moves.length <= 50 && moves.every((move) =>
  move && typeof move.id === 'string' && Number.isInteger(move.count) && move.count >= 2 && move.count <= 100 && move.score === eliminationScore(move.count));

// A save is accepted only when its current board and scores reproduce from its seed.
// This is corruption detection, not a trusted online leaderboard protocol.
export function restoreGame(saved) {
  try {
    if (!saved || saved.schemaVersion !== SCHEMA_VERSION || ![RULES_VERSION, 'popstar-target-v2', 'popstar-v1'].includes(saved.rulesVersion) ||
      typeof saved.runId !== 'string' || !saved.runId || !seedValue(saved.seed) ||
      !countValue(saved.level) || saved.level < 1 || !countValue(saved.priorScore) ||
      !countValue(saved.levelScore) || !countValue(saved.bonus) || !movesValue(saved.moves) ||
      !Array.isArray(saved.completed) || saved.completed.length !== saved.level - 1) return null;
    let previousScore = 0;
    for (const entry of saved.completed) {
      if (!entry || !seedValue(entry.seed) || !movesValue(entry.moves) || !countValue(entry.score) ||
        entry.score !== entry.moves.reduce((sum, move) => sum + move.score, 0)) return null;
      const remaining = 100 - entry.moves.reduce((sum, move) => sum + move.count, 0);
      if (remaining < 0 || entry.bonus !== remainderBonus(remaining)) return null;
      previousScore += entry.score + entry.bonus;
    }
    if (previousScore !== saved.priorScore) return null;
    const generationVersion = saved.generationVersion ?? 1;
    if (![1, 2, GENERATION_VERSION].includes(generationVersion)) return null;
    const dominantTypes = saved.dominantTypes ?? (generationVersion === 1 ? dominantColors(saved.seed) : null);
    if (!Array.isArray(dominantTypes) || !(generationVersion >= 3 ? [0, 1, 2] : [1, 2]).includes(dominantTypes.length) ||
      new Set(dominantTypes).size !== dominantTypes.length || dominantTypes.some((type) => !Number.isInteger(type) || type < 0 || type >= TYPE_COUNT)) return null;
    if (generationVersion >= 3 && JSON.stringify(dominantTypes) !== JSON.stringify(levelDominantColors(saved.seed, saved.level))) return null;
    let replay = { ...createGame(saved.seed, saved.runId, { generationVersion, dominantTypes }), level: saved.level, priorScore: previousScore, completed: saved.completed };
    for (const move of saved.moves) {
      const result = playMove(replay, move.id);
      if (!result || result.count !== move.count || result.score !== move.score) return null;
      replay = result.game;
    }
    // Validate old results against their original threshold, then return the current
    // threshold's outcome. Scores, board and previously completed levels stay intact.
    const expectedSavedPhase = replay.phase !== 'playing'
      ? (totalScore(replay) >= previousTarget(replay.level, saved.rulesVersion) ? 'passed' : 'failed') : replay.phase;
    if (replay.levelScore !== saved.levelScore || replay.bonus !== saved.bonus || expectedSavedPhase !== saved.phase ||
      JSON.stringify(replay.board) !== JSON.stringify(saved.board) || !countValue(totalScore(replay))) return null;
    if (saved.cloudRun && typeof saved.cloudRun.ticket === 'string' && Number.isInteger(saved.cloudRun.seed)) replay.cloudRun = { ...saved.cloudRun };
    return replay;
  } catch { return null; }
}
