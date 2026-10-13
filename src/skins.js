import { characterMapping } from './game.js';

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
