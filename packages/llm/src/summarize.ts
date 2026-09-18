/**
 * 局势摘要器（GameState → 紧凑中文文本 prompt）。
 *
 * **prompt 卫生不变式：昵称 / 聊天 / 日志文本永不进 prompt。** 本模块只读
 * GameState（纯数据）与 @gaia/engine 的数据表/helper——输出 = 固定中文模板 +
 * 引擎 id/数字。GameState.lastEvents（引擎事件串）与 server 层玩家昵称一律
 * 不读取、不拼接（测试锚定）。
 *
 * - summarizeState：紧凑结构化中文局势摘要：轮次/回合计分板/终局板、自己
 *   （种族/资源/三区 power/研究等级/建筑/科技板/联邦标记/助推器/gaiaformer/
 *   穿梭机）、各对手摘要、地图上己方建筑分布、可用行动格占用、飞船状态（LF）。
 * - describeAction：每个候选行动一句中文描述（含费用与直接收益）。
 * - buildDecisionPrompt：system 完全静态（缓存友好）；user = 局势摘要 +
 *   0-based 编号候选列表（编号与 choiceIndex 对齐）；opts.lookahead 附前瞻段。
 */
import {
  BOARD_ACTIONS,
  BOOSTERS,
  BUILDING_COST,
  EXPLORE_SHIP_COST_VP,
  EXPLORE_SHIP_COST_VP_BALTAKS,
  FACTIONS,
  FEDERATION_TOKENS,
  FINAL_SCORING,
  FREE_CONVERSIONS,
  INSPECT_ARTIFACT_COST_POWER,
  PLANET_NAMES,
  RESEARCH_TRACKS,
  ROUND_SCORING,
  SHIP_ACTIONS,
  TECH_TILES,
  ADV_TECH_TILES,
  playerBuildings,
  terraformStepsFor,
  type Action,
  type BoardActionId,
  type BuildingType,
  type GameState,
  type PlayerIndex,
  type PlayerState,
  type ResearchTrack,
  type ResourceGain,
  type SpecialActionId,
} from '@gaia/engine';

/** 建筑中文名。 */
const BUILDING_CN: Record<BuildingType, string> = {
  mine: '矿',
  ts: '贸易站',
  lab: '实验室',
  pi: 'PI',
  ac1: '学院1',
  ac2: '学院2',
  gf: 'Gaiaformer',
  sp: '空间站',
};

/** 研究轨简称。 */
const TRACK_CN: Record<ResearchTrack, string> = {
  terra: '地形',
  nav: '导航',
  int: '智能',
  gaia: '盖亚',
  eco: '经济',
  sci: '科学',
};

/** 结构化奖励 → 紧凑文本（如 "+2o+1k+3vp"）。 */
function gainText(gain: ResourceGain): string {
  const parts: string[] = [];
  if (gain.vp !== undefined) parts.push(`${gain.vp}vp`);
  if (gain.ore !== undefined) parts.push(`${gain.ore}o`);
  if (gain.credits !== undefined) parts.push(`${gain.credits}c`);
  if (gain.knowledge !== undefined) parts.push(`${gain.knowledge}k`);
  if (gain.qic !== undefined) parts.push(`${gain.qic}q`);
  if (gain.powerToken !== undefined) parts.push(`${gain.powerToken}token`);
  if (gain.chargePower !== undefined) parts.push(`充${gain.chargePower}pw`);
  if (gain.gaiaformer !== undefined) parts.push(`${gain.gaiaformer}gaiaformer`);
  return parts.length > 0 ? `+${parts.join('+')}` : '';
}

/** 研究等级摘要（只列 >0 的轨）。 */
function researchText(p: PlayerState): string {
  const parts = (Object.entries(p.research) as [ResearchTrack, number][])
    .filter(([, lvl]) => lvl > 0)
    .map(([t, lvl]) => `${TRACK_CN[t]}${lvl}`);
  return parts.join(' ') || '无';
}

/** 科技板名列表（含高级板标注）。 */
function techText(p: PlayerState): string {
  const advCovering = new Set(p.advTechTiles.map((a) => a.covers));
  const std = p.techTiles.map((id) => TECH_TILES[id].name + (advCovering.has(id) ? '(被覆盖)' : ''));
  const adv = p.advTechTiles.map((a) => `高级:${ADV_TECH_TILES[a.id].name}`);
  return [...std, ...adv].join('、') || '无';
}

/** 联邦标记列表（vp + 绿/灰面）。 */
function federationText(p: PlayerState): string {
  if (p.federationTokens.length === 0) return '无';
  return p.federationTokens
    .map((t) => `${FEDERATION_TOKENS[t.id].vp}vp${t.flipped ? '(灰)' : '(绿)'}`)
    .join(' ');
}

/** 地图上己方建筑分布（hex:建筑）。 */
function ownBuildingsText(state: GameState, seat: PlayerIndex): string {
  const list = playerBuildings(state.map, seat).map(
    (b) => `${b.hex}:${BUILDING_CN[b.building.type]}`
  );
  if (list.length === 0) return '无';
  const shown = list.slice(0, 24);
  return shown.join(' ') + (list.length > shown.length ? ` …共${list.length}座` : '');
}

/** 建筑计数（地图上）。 */
function buildingCounts(state: GameState, seat: PlayerIndex): string {
  const counts = new Map<BuildingType, number>();
  for (const b of playerBuildings(state.map, seat)) {
    counts.set(b.building.type, (counts.get(b.building.type) ?? 0) + 1);
  }
  const order: BuildingType[] = ['mine', 'ts', 'lab', 'pi', 'ac1', 'ac2'];
  return (
    order
      .filter((t) => (counts.get(t) ?? 0) > 0)
      .map((t) => `${BUILDING_CN[t]}×${counts.get(t)}`)
      .join(' ') || '无'
  );
}

/**
 * 紧凑结构化中文局势摘要（纯函数、确定性）。
 * viewer 为自己的座位号；对手只给公开信息（无隐藏信息可泄漏——盖亚无手牌）。
 */
export function summarizeState(state: GameState, viewer: PlayerIndex): string {
  const ps = state.players[viewer];
  if (ps === undefined) throw new RangeError(`summarizeState: unknown viewer ${viewer}`);
  const lines: string[] = [];

  // 1. 轮次/阶段/顺位 + 计分板
  const phase = state.phase === 'setup' ? '设置阶段' : state.phase === 'game-over' ? '已结束' : '行动阶段';
  lines.push(`【局势】第${Math.max(1, state.round)}/6轮 ${phase} 你是P${viewer}（共${state.config.playerCount}人）`);
  const roundTiles = state.board.roundScoring
    .map((id, i) => `${i + 1 === state.round ? '→' : ''}R${i + 1}:${ROUND_SCORING[id].name}`)
    .join(' | ');
  lines.push(`【回合计分板】${roundTiles}`);
  lines.push(`【终局计分板】${state.board.finalScoring.map((id) => FINAL_SCORING[id].name).join(' | ')}（排名 18/12/6/0）`);

  // 2. viewer：种族/资源/power/研究/板块/标记/助推器/gaiaformer
  lines.push(
    `【你 P${viewer}】${FACTIONS[ps.faction].name} VP${ps.vp} ` +
      `资源:${ps.resources.ore}o/${ps.resources.credits}c/${ps.resources.knowledge}k/${ps.resources.qic}q ` +
      `power:I区${ps.power.bowl1}/II区${ps.power.bowl2}/III区${ps.power.bowl3}/Gaia区${ps.power.gaia}`,
  );
  lines.push(
    `【你的面板】研究:${researchText(ps)} 科技板:${techText(ps)} ` +
      `联邦标记:${federationText(ps)} 助推器:${ps.booster !== null ? BOOSTERS[ps.booster].name : '无'}`,
  );
  lines.push(
    `【你的单位】建筑:${buildingCounts(state, viewer)}（面板剩余:矿${ps.buildings.mine}/TS${ps.buildings.ts}/实验室${ps.buildings.lab}/PI${ps.buildings.pi}/学院${ps.buildings.ac1 + ps.buildings.ac2}） ` +
      `Gaiaformer:可用${ps.gaiaformers.available}/共${ps.gaiaformers.total}/报废${ps.gaiaformers.lost} ` +
      `卫星${ps.satellites} 星球类型${ps.colonizedPlanetTypes.length}种 扇区${ps.colonizedSectors.length}个`,
  );

  // 3. 对手摘要（公开信息）
  const others = state.players
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i !== viewer)
    .map(({ p, i }) => {
      const structures = playerBuildings(state.map, i).length;
      return (
        `P${i}:${FACTIONS[p.faction].name} VP${p.vp} ` +
        `${p.resources.ore}o/${p.resources.credits}c/${p.resources.knowledge}k/${p.resources.qic}q ` +
        `研究[${researchText(p)}] 建筑×${structures} 联邦×${p.federationTokens.length}` +
        (state.passedPlayers.includes(i) ? ' 已Pass' : '')
      );
    });
  lines.push(`【对手】${others.join(' | ') || '无'}`);

  // 4. 地图：己方建筑分布 + 进行中的盖亚计划
  lines.push(`【己方建筑分布】${ownBuildingsText(state, viewer)}`);
  const projects = state.gaiaProjectsInProgress
    .filter((g) => g.player === viewer)
    .map((g) => g.hex);
  if (projects.length > 0) {
    lines.push(`【盖亚计划】转化中:${projects.join(' ')}（下轮盖亚阶段转化为 Gaia 星球）`);
  }

  // 5. 行动格占用 + 飞船状态（LF）
  const usedBoard = state.board.boardActionsUsed.join(' ') || '无';
  lines.push(`【行动格】研究板已用:${usedBoard} 已Pass玩家:${state.passedPlayers.map((i) => `P${i}`).join(' ') || '无'}`);
  if (state.config.lostFleet && state.board.ships.length > 0) {
    const ships = state.board.ships
      .map((s) => {
        const shuttles = s.shuttleSlots
          .map((slot, i) => (slot !== null ? `位${i}:P${slot}` : null))
          .filter((x) => x !== null)
          .join(' ');
        return (
          `${s.id}@${s.hex} 科技:${s.techTiles.map((t) => TECH_TILES[t].name).join('、') || '无'} ` +
          `联邦标记:${s.federationToken !== null ? `${FEDERATION_TOKENS[s.federationToken].vp}vp` : '无'} ` +
          `神器×${s.artifacts.length} 穿梭机:${shuttles || '无'}` +
          (ps.exploredShips.includes(s.id) ? ' [已探索]' : '')
        );
      })
      .join(' | ');
    lines.push(`【飞船】${ships}`);
    if (ps.shuttles.length > 0) {
      lines.push(`【你的穿梭机】${ps.shuttles.map((s) => `${s.ship}位${s.slot}`).join(' ')}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 候选行动描述
// ---------------------------------------------------------------------------

function describeBuildMine(state: GameState, seat: PlayerIndex, action: Extract<Action, { type: 'build-mine' }>): string {
  const p = state.players[seat]!;
  const hex = state.map[action.hex];
  const planet = hex?.planet ?? 'empty';
  const steps = terraformStepsFor(p, planet);
  const tile = state.board.roundScoring[state.round - 1];
  const notes: string[] = [];
  if (planet === 'proto') notes.push('+6vp');
  if (planet === 'asteroid') notes.push('免矿费但报废1个gaiaformer');
  if (planet === 'gaia' && hex?.gaiaformerOf === seat) notes.push('收回gaiaformer免居住费');
  if (tile !== undefined) {
    const def = ROUND_SCORING[tile];
    if (
      def.trigger.on === 'build-mine' ||
      (def.trigger.on === 'build-mine-gaia' && planet === 'gaia') ||
      (def.trigger.on === 'terraform-step' && steps > 0)
    ) {
      notes.push(`本轮板匹配:${def.name}`);
    }
  }
  return (
    `在${action.hex}(${PLANET_NAMES[planet]})建矿` +
    `（费1o+2c${steps > 0 ? `+${steps}步terraform` : ''}，矿轨揭开收入）` +
    (notes.length > 0 ? `：${notes.join('，')}` : '')
  );
}

function describeUpgrade(state: GameState, seat: PlayerIndex, action: Extract<Action, { type: 'upgrade' }>): string {
  const hex = state.map[action.hex];
  const from = hex?.building !== undefined ? BUILDING_CN[hex.building.type] : '?';
  const cost =
    action.to === 'ts'
      ? '2o+3/6c（邻近对手折扣）'
      : action.to === 'lab'
        ? `${BUILDING_COST.lab.ore}o+${BUILDING_COST.lab.credits}c`
        : action.to === 'pi'
          ? `${BUILDING_COST.pi.ore}o+${BUILDING_COST.pi.credits}c`
          : `${BUILDING_COST.academy.ore}o+${BUILDING_COST.academy.credits}c`;
  const gains: string[] = [];
  if (action.techTile !== undefined) gains.push(`拿科技板:${TECH_TILES[action.techTile].name}`);
  if (action.advTechTile !== undefined) gains.push(`拿高级板:${ADV_TECH_TILES[action.advTechTile].name}（翻1枚绿面标记）`);
  if (action.research !== undefined && action.research !== null) {
    const lvl = state.players[seat]!.research[action.research];
    gains.push(`推进${TRACK_CN[action.research]}轨到L${lvl + 1}`);
  }
  if (action.to === 'pi') gains.push('解锁种族PI能力');
  return `升级${action.hex} ${from}→${BUILDING_CN[action.to]}（费${cost}）${gains.length > 0 ? `：${gains.join('，')}` : ''}`;
}

function describeResearch(state: GameState, seat: PlayerIndex, action: Extract<Action, { type: 'research' }>): string {
  const lvl = state.players[seat]!.research[action.track];
  const eff = RESEARCH_TRACKS[action.track].levels[lvl];
  const parts: string[] = [];
  if (eff?.once !== undefined) parts.push(gainText(eff.once));
  if (eff?.income !== undefined) parts.push(`收入${gainText(eff.income)}`);
  if (eff?.terraformCostPerStep !== undefined) parts.push(`terraform每步降到${eff.terraformCostPerStep}o`);
  if (eff?.range !== undefined) parts.push(`射程${eff.range}`);
  if (eff?.grantsPresetFederationToken === true) parts.push('拿预设联邦标记');
  if (eff?.placesLostPlanet === true) parts.push('放置Lost Planet');
  if (lvl + 1 >= 3) parts.push('终局+4vp');
  if (action.flipToken !== undefined) parts.push('需翻1枚绿面标记');
  return `研究${TRACK_CN[action.track]}轨 L${lvl}→L${lvl + 1}（费4k）：${parts.join('，') || '无直接收益'}`;
}

function describeFederation(action: Extract<Action, { type: 'form-federation' }>): string {
  const def = FEDERATION_TOKENS[action.token];
  const other = def.other !== undefined ? gainText(def.other) : '';
  return (
    `组建联邦：${action.hexes.length}个星球格+${action.satellites.length}颗卫星 ` +
    `→ 标记${def.vp}vp${other}（联邦内建筑计入 structureFed 终局板）`
  );
}

function describeBoardAction(id: BoardActionId): string {
  const def = BOARD_ACTIONS[id];
  const cost = def.cost.power !== undefined ? `${def.cost.power}pw` : `${def.cost.qic}q`;
  let effect = '';
  switch (def.effect.kind) {
    case 'gain':
      effect = gainText(def.effect.gain);
      break;
    case 'build-mine':
      effect = `建矿（${def.effect.freeTerraformSteps}步免费terraform）`;
      break;
    case 'gain-tech-tile':
      effect = '拿1块科技板';
      break;
    case 'rescore-federation':
      effect = '重结算1枚联邦标记';
      break;
    case 'vp-per-planet-type':
      effect = `+${def.effect.base}vp+每星球类型${def.effect.perType}vp`;
      break;
  }
  return `${id}（费${cost}）：${effect}`;
}

function describeSpecialAction(state: GameState, seat: PlayerIndex, id: SpecialActionId): string {
  switch (id) {
    case 'tech9':
      return '特殊行动(tech9)：充能4pw';
    case 'advtech3':
      return '特殊行动(advtech3)：+1q+5c';
    case 'advtech11':
      return '特殊行动(advtech11)：+3o';
    case 'advtech13':
      return '特殊行动(advtech13)：+3k';
    case 'booster4':
      return '特殊行动(助推器)：建矿（1步免费terraform）';
    case 'booster5':
      return '特殊行动(助推器)：建矿/盖亚计划射程+3';
    case 'boosterlf4':
      return '特殊行动(助推器)：免费立即盖亚计划';
    case 'ac2':
      return state.players[seat]?.faction === 'baltaks' ? '特殊行动(学院2)：+4c' : '特殊行动(学院2)：+1q';
    case 'ivits-sp':
      return '特殊行动(PI)：放置空间站';
    case 'ambas-swap':
      return '特殊行动(PI)：交换PI与一座矿';
    case 'firaks-down':
      return '特殊行动(PI)：实验室降级推进1级研究';
    case 'bescods-up':
      return '特殊行动：推进最低研究轨1级';
    case 'gleens-range':
      return '特殊行动(探索板)：本次射程+2';
    case 'moweyds-ring':
      return '特殊行动(PI)：放置Power Ring';
    case 'tinkeroids-tile':
      return '特殊行动(PI)：使用本轮Tinkering tile';
    case 'space-giants-mine':
      return '特殊行动(探索板)：建矿（2步免费terraform）';
  }
}

function describeShipAction(action: Extract<Action, { type: 'ship-action' }>): string {
  const def = SHIP_ACTIONS[action.action];
  const costParts: string[] = [];
  if (def.cost.power !== undefined) costParts.push(`${def.cost.power}pw`);
  if (def.cost.qic !== undefined) costParts.push(`${def.cost.qic}q`);
  if (def.cost.ore !== undefined) costParts.push(`${def.cost.ore}o`);
  if (def.cost.credits !== undefined) costParts.push(`${def.cost.credits}c`);
  if (def.cost.knowledge !== undefined) costParts.push(`${def.cost.knowledge}k`);
  let effect = '';
  switch (def.effect.kind) {
    case 'rescore-federation-full':
      effect = '重结算1枚联邦标记（含即时效果）';
      break;
    case 'vp-per-planet-type':
      effect = `+${def.effect.base}vp+每星球类型${def.effect.perType}vp`;
      break;
    case 'gain-tech-tile':
      effect = '拿1块科技板（可拿船上板）';
      break;
    case 'vp-per-standard-tech-tile':
      effect = `+${def.effect.base}vp+每标准科技板${def.effect.perTile}vp`;
      break;
    case 'free-upgrade':
      effect = `免费升级${def.effect.from}→${def.effect.to}`;
      break;
    case 'research':
      effect = '任意轨升1级';
      break;
    case 'gaia-project-immediate':
      effect = '立即盖亚计划（免移power立即转化）';
      break;
    case 'range':
      effect = `本次射程+${def.effect.amount}`;
      break;
    case 'gain':
      effect = gainText(def.effect.gain);
      break;
    case 'build-mine':
      effect = `建矿（${def.effect.freeTerraformSteps}步免费terraform）`;
      break;
    case 'build-mine-asteroid':
      effect = '范围内小行星免费建矿（不耗gaiaformer）';
      break;
  }
  return `飞船行动 ${action.ship}:${action.action}（费${costParts.join('+') || '0'}）：${effect}`;
}

/**
 * 行动的一句话中文描述（纯函数、确定性），供候选列表与日志。
 * 带决策关键信息：费用与直接收益。
 */
export function describeAction(state: GameState, seat: PlayerIndex, action: Action): string {
  switch (action.type) {
    case 'build-mine':
      return describeBuildMine(state, seat, action);
    case 'start-gaia-project':
      return `在${action.hex}启动盖亚计划（移power入Gaia区，下轮转化为Gaia星球后可建矿）`;
    case 'upgrade':
      return describeUpgrade(state, seat, action);
    case 'form-federation':
      return describeFederation(action);
    case 'research':
      return describeResearch(state, seat, action);
    case 'power-action':
    case 'qic-action':
      return describeBoardAction(action.action);
    case 'special-action':
      return describeSpecialAction(state, seat, action.action);
    case 'ship-action':
      return describeShipAction(action);
    case 'explore-ship': {
      const p = state.players[seat]!;
      const cost = p.faction === 'baltaks' ? EXPLORE_SHIP_COST_VP_BALTAKS : EXPLORE_SHIP_COST_VP;
      return `探索飞船${action.ship}（-${cost}vp）：解锁飞船行动格与舰载科技/神器/联邦标记`;
    }
    case 'inspect-artifact':
      return `检查神器${action.artifact}（弃${INSPECT_ARTIFACT_COST_POWER}pw）：获得神器效果`;
    case 'pass': {
      const p = state.players[seat]!;
      const old = p.booster !== null ? BOOSTERS[p.booster] : null;
      const passVp = old?.passVp !== undefined ? `（结算旧助推器pass VP）` : '';
      return action.booster !== null
        ? `Pass，拿助推器「${BOOSTERS[action.booster].name}」${passVp}`
        : `Pass（第6轮不拿新助推器）${passVp}`;
    }
    case 'free-conversion': {
      const def = FREE_CONVERSIONS[action.conversion];
      return `免费兑换 ${action.conversion}（不耗回合）：→${gainText(def.gain)}`;
    }
    case 'burn':
      return '烧脑（不耗回合）：II区弃1token，另1个II区token→III区';
    case 'charge': {
      const pending = state.pending;
      const offer = pending?.kind === 'charge' ? pending.queue[0] : undefined;
      return offer !== undefined ? `接受充能${offer.amount}pw（-${offer.vpCost}vp）` : '接受充能';
    }
    case 'decline-charge':
      return '拒绝充能';
    case 'place-initial-mine': {
      const hex = state.map[action.hex];
      return `起始矿放在${action.hex}(${hex !== undefined ? PLANET_NAMES[hex.planet] : '?'})`;
    }
    case 'choose-booster':
      return `选起始助推器「${BOOSTERS[action.booster].name}」（收入${gainText(BOOSTERS[action.booster].income)}）`;
    case 'itars-gaia-tech':
      return action.techTile !== null
        ? `盖亚阶段换科技板：${TECH_TILES[action.techTile].name}（弃4 Gaia power）`
        : '结束盖亚阶段决策';
    case 'terrans-gaia-done':
      return '结束盖亚阶段兑换';
    case 'choose-tinkering':
      return `选择本轮Tinkering tile：${action.tile}`;
    case 'gain-tech-tile':
      return action.techTile !== null
        ? `拿科技板：${TECH_TILES[action.techTile].name}`
        : '放弃拿板';
    case 'free-mine':
      return action.hex !== null ? `免费建矿在${action.hex}` : '跳过免费建矿';
  }
}

// ---------------------------------------------------------------------------
// prompt 构造
// ---------------------------------------------------------------------------

/**
 * 决策 prompt 的静态 system（**完全静态**：不含任何对局动态内容，两局不同 seed
 * 逐字节相同）——稳定前缀最大化 prompt 缓存命中。动态内容一律放 user。
 */
export const SYSTEM_PROMPT = [
  '你是桌游《盖亚计划》（Gaia Project，含 Lost Fleet 扩展）的决策 AI，为一名玩家选择本回合行动。',
  '目标：终局 VP 最高者胜。VP 来源：回合计分板触发、联邦标记、科技板、研究轨 L3+（每级终局+4vp）、终局计分板排名（18/12/6/0）、剩余资源折算。注意：资源与收入本身终局几乎不值分——价值在它们换来的建筑、联邦与研究上。',
  '规则要点：',
  '- 每回合选 1 个主行动：建矿/盖亚计划/升级/组建联邦/研究/power·QIC·特殊·飞船行动/探索飞船/检查神器/Pass。免费兑换与烧脑不耗回合。设置阶段按队列放起始矿、选起始助推器。',
  '- 经济：矿费 1o+2c；terraform 每步费 ore（地形轨 L0-1=3/L2=2/L3+=1）；射程不足 1QIC 补 2 格；Gaia 星球居住费 1QIC；asteroid 免矿费但永久报废 1 个 gaiaformer；proto 建矿 +6vp。',
  '- power 循环：token 按 I→II→III 区充能，III 区花费后回 I 区。对手在你建筑 2 格内建造时，你可付 vp 被动充能（vp 代价=充能量−1）——贴对手建造是送充能，也会诱对手贴你。',
  '- 升级链：矿→贸易站→实验室→学院；贸易站→PI。升实验室/PI/学院立即拿 1 块科技板（可顺带推进研究轨）；建筑放上地图揭开面板收入轨。',
  '- 联邦：相连建筑 power value 总和 ≥7 可组建（卫星桥接，每颗弃 1 token），拿联邦标记（vp+资源）；研究升 L5 与拿高级科技板都需翻 1 枚绿面标记。',
  '- Lost Fleet：探索飞船（-5vp）解锁飞船行动格与舰载科技板/神器/联邦标记；穿梭机占位后用飞船行动格；深空扇区与小行星计入新终局板。',
  '策略要点：',
  '- terraform 环管理：优先母星类型与 1 步星球扩张；地形轨早升（L2/L3 折扣全局回本）；3 步星球除非回合计分板匹配或联邦需要，否则缓行。',
  '- power 节奏：III 区是弹药库——power 行动格（3pw 建矿 1 步/4pw 2o/5pw 建矿 2 步/7pw 3k）是中前期最强兑换；别让 token 睡在 I 区，急需时烧脑值得。',
  '- 联邦时机：第一个联邦尽早（标记奖励 + L5/高级板的翻面门票）；卫星很贵，能直连就别铺桥；第二个联邦看 structureFed 终局板与剩余标记。',
  '- 研究轨选择：地形/导航是扩张引擎（折扣+射程，导航 L5 送 Lost Planet），经济/科学是收入引擎（价值随剩余轮数衰减），智能轨给 QIC，盖亚轨给 gaiaformer。L3/L4/L5 各值终局 4vp，别在第 6 轮冲收入轨。',
  '- 回合计分板匹配：本轮板的触发行动优先（局势摘要里 → 标记的是本轮板）；收入类与"下轮才兑现"的投资（盖亚计划、收入轨）在最后 1-2 轮大幅贬值。',
  '- Pass 时机：资源耗尽且无可负担主行动就 Pass——新助推器收入 NPV + 旧助推器 pass VP + 先手价值，常优于强行做亏本兑换；第 6 轮 Pass 不拿新助推器，把资源花完再 Pass。',
  '输出方式：调用 choose 工具提交你的选择——choice_index 参数填候选编号（0 起），reason 参数填一句话中文理由。不要输出任何其他内容。',
].join('\n');

/** hard 难度前瞻段：剩余轮数 + 后续计分板 + 投资兑现窗口。 */
export function lookaheadSection(state: GameState): string {
  const left = 6 - state.round + 1;
  const upcoming = state.board.roundScoring
    .slice(state.round)
    .map((id, i) => `R${state.round + 1 + i}:${ROUND_SCORING[id].name}`)
    .join(' | ');
  return [
    '',
    `【前瞻：剩余轮数】当前第${state.round}/6轮，还剩${left}轮（含本轮）。` +
      `后续计分板：${upcoming || '无（最后一轮）'}。` +
      `收入只剩${Math.max(0, 6 - state.round)}次结算——收入/助推器/收入轨的价值按此折算；` +
      `盖亚计划下轮才转化，最后 1 轮不要启动；终局计分板按排名 18/12/6/0 结算，` +
      `请评估本行动对终局板计数（建筑总数/联邦内建筑/星球类型/扇区/卫星等）的影响。`,
  ].join('\n');
}

/**
 * 构造一次决策的 prompt：system 静态（见 SYSTEM_PROMPT）；user = 局势摘要 +
 * 0-based 编号候选列表（编号与 choiceIndex 对齐）。candidates 顺序即编号顺序。
 * opts.lookahead=true 时在 user 末尾附前瞻段（hard 难度）。
 */
export function buildDecisionPrompt(
  state: GameState,
  seat: PlayerIndex,
  candidates: { action: Action; description: string }[],
  opts?: { lookahead?: boolean },
): { system: string; user: string } {
  const user = [
    summarizeState(state, seat),
    '',
    '【候选行动】（编号 0 起，choose 工具的 choice_index 参数与编号一致）',
    ...candidates.map((c, i) => `${i}. ${c.description}`),
    '',
    '请调用 choose 工具提交选择：choice_index 填候选编号（0 起），reason 填一句话中文理由。',
  ].join('\n');
  return { system: SYSTEM_PROMPT, user: user + (opts?.lookahead === true ? lookaheadSection(state) : '') };
}
