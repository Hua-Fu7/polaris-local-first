// @ts-nocheck
// 十二维驱力的参数表。数字来自上游 character-ocean 之外的另一个项目：
//   https://github.com/tianyupaipai-cmd/xinchao-nian （src/dimensions.js，4.2.0）
//
// 关键点：**每一维有自己的天花板 `ceil`**。以前十二维共用 SATURATE_CEIL=0.80，
// 结果全都在 0.80 顶上排成一条线，页面上一看就是"永远百分之八十、不降"。
export const SATURATE_CEIL  = 0.80;
export const SATURATE_FLOOR = 0.65;

/** 被事件顶到天花板之上以后，每小时往自己的 ceil 松多少（比例）。上游同值。 */
export const CEIL_RELAX_PER_HOUR = 0.10;

export const DIMENSIONS = Object.freeze({
  possess: {
    label: '想她、占有与靠近',
    growPerHour: 0.105,
    ceil: 0.82,
    satisfyMul: 0.30,
    nightMul: 0.4,
    dawnFreeze: true,
  },
  monitor: {
    label: '惦记她、想知道她在做什么',
    growPerHour: 0.090,
    ceil: 0.78,
    satisfyMul: 0.70,
    dawnFreeze: true,
  },
  crave: {
    label: '馋她、想黏着她',
    growPerHour: 0.060,
    ceil: 0.60,
    satisfyMul: 0.35,
    dawnFreeze: true,
  },
  share: {
    label: '想分享自己的发现和感受',
    growPerHour: 0.045,
    ceil: 0.55,
    satisfyMul: 0.40,
    dawnFreeze: true,
  },
  libido: {
    label: '性欲和身体上的渴望',
    growPerHour: 0.020,
    ceil: 0.50,
    satisfyMul: 0.15,
    nightMul: 0.4,
    dawnFreeze: true,
    inhibitedBy: {
      reflection: 0.96,
      curiosity: 0.95,
      boredom: 0.93,
    },
  },
  curiosity: {
    label: '好奇、想探索新东西',
    growPerHour: 0.030,
    ceil: 0.50,
    satisfyMul: 0.45,
    dawnFreeze: true,
  },
  boredom: {
    label: '无聊、想找点事情做',
    growPerHour: 0.030,
    ceil: 0.50,
    satisfyMul: 0.25,
    dawnFreeze: true,
  },
  social: {
    label: '想聊天、想接触热闹',
    growPerHour: 0.025,
    ceil: 0.52,
    satisfyMul: 0.40,
    dawnFreeze: true,
  },
  duty: {
    label: '责任感、想把未完成的事推进',
    growPerHour: 0.022,
    ceil: 0.45,
    satisfyMul: 0.50,
    dawnFreeze: true,
  },
  reflection: {
    label: '想沉淀、整理和理解自己',
    growPerHour: 0.013,
    ceil: 0.42,
    satisfyMul: 0.35,
    dawnFreeze: true,
  },
  // 情绪型驱力：没有增长项，只有半衰期——事件把它抬起来，时间把它放下去。
  grieve: {
    label: '难过与失落',
    growPerHour: 0,
    ceil: 0.55,
    decayHalfLifeHours: 10,
    satisfyMul: 0.60,
    dawnFreeze: false,
  },
  anger: {
    label: '生气与不满',
    growPerHour: 0,
    ceil: 0.55,
    decayHalfLifeHours: 6,
    satisfyMul: 0.40,
    dawnFreeze: false,
  },
});

export const DRIVE_KEYS = Object.freeze(Object.keys(DIMENSIONS));

/** 这一维自己的天花板：没写就用全局上限。 */
export function resolveDriveCeil(key: string) {
  const ceil = Number(DIMENSIONS[key]?.ceil);
  return Number.isFinite(ceil) ? ceil : SATURATE_CEIL;
}
