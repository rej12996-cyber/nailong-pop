// IDs are permanent: new artwork is appended; existing IDs must not be reassigned.
const poses = ['托腮思考', '挥手姿态', '小狗形态', '盘绕形态', '公鸡形态', '捧肚大笑', '侧身站立'];
const colors = ['玫红', '金黄', '草绿', '天蓝', '紫色'];
export const AVATARS = Object.freeze(poses.flatMap((pose, p) => colors.map((color, c) => {
  const id = `${String(p + 1).padStart(2, '0')}-${String(c + 1).padStart(2, '0')}`;
  return Object.freeze({ id, label: `${color}${pose}`, image: `./assets/tiles/v1/${id.replace('-', '/')}.png` });
})));
