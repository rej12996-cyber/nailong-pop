import { characterMapping } from './game.js';
import { RESULT_MASCOTS } from '../assets/result-mascots/v1/mascots.js';

export { RESULT_MASCOTS };

// Level seeds are random. Keep each level's illustration stable when reopened.
export function resultMascotForSeed(seed) {
  let value = (seed >>> 0) ^ 0x9e3779b9;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  value = (value ^ (value >>> 15)) >>> 0;
  return RESULT_MASCOTS[value % RESULT_MASCOTS.length];
}

export const CHARACTERS = Object.freeze(['托腮思考', '挥手姿态', '小狗形态', '盘绕形态', '公鸡形态', '捧肚大笑', '侧身站立']);
export const TILE_SKINS = Object.freeze([
  { name: '金黄', color: '#F6C96C', file: '02' },
  { name: '草绿', color: '#A0E76F', file: '03' },
  { name: '天蓝', color: '#8CD1FA', file: '04' },
  { name: '玫红', color: '#DA7388', file: '01' },
  { name: '紫色', color: '#C270F6', file: '05' },
]);

export function levelSkins(seed) {
  return characterMapping(seed).map((character, type) => ({
    ...TILE_SKINS[type], character, characterName: CHARACTERS[character],
    image: `./assets/tiles/v1/${String(character + 1).padStart(2, '0')}/${TILE_SKINS[type].file}.png`,
  }));
}
