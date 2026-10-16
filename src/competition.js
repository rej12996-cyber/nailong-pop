// This protocol is versioned independently of presentation, audio and local saves.
export const COMPETITION_VERSION = 'nailong-ranked-v1';
export function competitionSeed(rootSeed, level) {
  let x = (rootSeed >>> 0) ^ Math.imul(level, 0x9e3779b9);
  x = Math.imul(x ^ x >>> 16, 0x21f0aaad);
  x = Math.imul(x ^ x >>> 15, 0x735a2d97);
  return (x ^ x >>> 15) >>> 0;
}
export function replayPayload(game) {
  if (game?.phase !== 'failed' || !game.cloudRun?.ticket) return null;
  return { ticket: game.cloudRun.ticket, levels: [...game.completed, game].map(entry => entry.moves.map(move => move.id)) };
}
