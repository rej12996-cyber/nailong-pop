// IDs are permanent: new artwork is appended; existing IDs must not be reassigned.
const poses = ['托腮思考', '挥手姿态', '小狗形态', '盘绕形态', '公鸡形态', '捧肚大笑', '侧身站立'];
const colors = ['玫红', '金黄', '草绿', '天蓝', '紫色'];
const originalAvatars = poses.flatMap((pose, p) => colors.map((color, c) => {
  const id = `${String(p + 1).padStart(2, '0')}-${String(c + 1).padStart(2, '0')}`;
  return Object.freeze({ id, label: `${color}${pose}`, image: `./assets/tiles/v1/${id.replace('-', '/')}.png` });
}));
const additionalAvatars = [
  { id: '08-01', label: '袋鼠', image: './assets/avatars/v1/08-01.png' },
  { id: '08-02', label: '牛来', image: './assets/avatars/v1/08-02.png' },
  { id: '08-03', label: '吐舌双V奶蛙', image: './assets/avatars/v1/08-03.png' },
  { id: '08-04', label: '花合斗奶蛙', image: './assets/avatars/v1/08-04.png' },
].map(avatar => Object.freeze(avatar));
export const AVATARS = Object.freeze([...originalAvatars, ...additionalAvatars]);
