import type { GameState } from '@gaia/engine';

/**
 * FilteredState：盖亚计划无隐藏信息（全部信息公开），客户端裁剪只做一件事——
 * 去掉 rngState（防客户端推算引擎后续随机流）。其余字段与 GameState 完全一致。
 * rngState?: never 让"误把 FilteredState 当 GameState 用"在编译期报错。
 */
export type FilteredState = Omit<GameState, 'rngState'> & { rngState?: never };

/**
 * 过滤 GameState 供下发：剥掉 rngState。
 * 不改原 state（顶层浅拷贝，子对象共享只读引用）。
 */
export function filterStateFor(state: GameState): FilteredState {
  const { rngState: _rngState, ...rest } = state;
  return rest;
}
