/**
 * 星球类型与 terraform 环。
 * 数据核对：reference/gaia-engine/src/planets.ts + 官方规则书。
 */
import type { HomePlanetType, PlanetType } from '../types.js';

/** terraform 环（相邻=1 步，最远 3 步）。 */
export const TERRAFORM_CYCLE: readonly HomePlanetType[] = [
  'terra',
  'oxide',
  'volcanic',
  'desert',
  'swamp',
  'titanium',
  'ice',
];

export const HOME_PLANET_TYPES = TERRAFORM_CYCLE;

/** 两母星类型间的 terraform 步数（0–3）。非母星类型返回 0。 */
export function terraformingSteps(from: HomePlanetType, to: PlanetType): number {
  const cycle = TERRAFORM_CYCLE as readonly string[];
  const fi = cycle.indexOf(from);
  const ti = cycle.indexOf(to);
  if (fi < 0 || ti < 0) {
    return 0;
  }
  let dist = ti - fi;
  if (dist > 3) {
    dist -= 7;
  } else if (dist < -3) {
    dist += 7;
  }
  return Math.abs(dist);
}

export const PLANET_NAMES: Record<PlanetType, string> = {
  terra: '大地(蓝)',
  desert: '沙漠(黄)',
  swamp: '沼泽(棕)',
  oxide: '氧化物(红)',
  volcanic: '火山(橙)',
  titanium: '钛(灰)',
  ice: '冰(白)',
  gaia: '盖亚(绿)',
  transdim: '跨维(紫)',
  lost: '失落星球',
  asteroid: '小行星',
  proto: '原行星',
  empty: '太空',
};
