/**
 * 大厅与房间等待视图（架构照 Brass web 适配盖亚协议）。
 * - Lobby：创建房间（昵称 + 人数 2-4 + Lost Fleet 开关 + AI 席位数（固定内置
 *   启发式，无难度选项）+ 可选种子）/ 加入房间（昵称 + 房码）/ 导入复盘（粘贴
 *   记录 JSON 或选文件 → import_game，服务器重放校验通过进入复盘模式，失败错误
 *   展示在大厅）三个面板；未连接或昵称为空时提交不可用；服务器错误直接展示。
 * - RoomView：房码卡片（一键复制）、座位列表（昵称/在线/"我"/AI 徽章与难度）、
 *   就位进度、开始按钮（真人≥1 且 真人+AI ≥ 总人数）、离开房间。
 */
import { useState } from 'react';
import type { FormEvent, ReactElement, ReactNode } from 'react';
import type { FactionMode, GameRecord, RoomConfig } from '@gaia/protocol';
import type { GameStore } from '../game/store';
import { useGameStore } from '../game/store';
import { DraftView } from './DraftView';

/** 种族选取方案中文标签。 */
const FACTION_MODE_LABEL: Record<FactionMode, string> = {
  friendly: '友好选取（轮流锁定）',
  random: '随机分配',
  auction: '竞技选取（竞拍）',
};
const FACTION_MODES: readonly FactionMode[] = ['friendly', 'random', 'auction'];

const CONNECTION_LABEL: Record<string, string> = {
  connected: '已连接',
  connecting: '正在连接服务器…',
  disconnected: '未连接',
};

const CONNECTION_TONE: Record<string, string> = {
  connected: 'ok',
  connecting: 'pending',
  disconnected: 'bad',
};

/** 表单字段包装：统一 label + 控件布局。 */
function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

/** 房码复制按钮：clipboard 可用写入剪贴板（"已复制"）；否则降级选中文本。 */
function CopyCodeButton({ code }: { code: string }): ReactElement {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const onCopy = (): void => {
    const write = navigator.clipboard?.writeText;
    if (typeof write === 'function') {
      write(code)
        .then(() => setState('copied'))
        .catch(() => setState('manual'));
    } else {
      setState('manual');
    }
  };
  return (
    <button type="button" className="copy-code" data-testid="copy-code" onClick={onCopy}>
      {state === 'copied' ? '已复制' : state === 'manual' ? '请手动复制' : '复制'}
    </button>
  );
}

export function Lobby({ store }: { store: GameStore }): ReactElement {
  const s = useGameStore(store);
  const connected = s.connection === 'connected';
  const [createNick, setCreateNick] = useState('');
  const [playerCount, setPlayerCount] = useState('4');
  const [lostFleet, setLostFleet] = useState(true);
  const [factionMode, setFactionMode] = useState<FactionMode>('random');
  const [aiCount, setAiCount] = useState('0');
  const [seedText, setSeedText] = useState('');
  const [joinNick, setJoinNick] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const onCreate = (e: FormEvent): void => {
    e.preventDefault();
    const nickname = createNick.trim();
    if (!connected || nickname === '') return;
    const count = Number(playerCount);
    const config: RoomConfig = { playerCount: count === 2 || count === 3 ? count : 4, lostFleet, factionMode };
    const seed = Number(seedText);
    if (seedText.trim() !== '' && Number.isInteger(seed) && seed >= 0) {
      config.seed = seed;
    }
    const ai = Number(aiCount);
    // 合法域 0..playerCount-1（选项已 clamp，这里再守一道）。
    // AI 固定为内置启发式（builtin:heuristic2，服务器默认 spec），难度字段仅协议兼容。
    if (Number.isInteger(ai) && ai >= 1 && ai <= config.playerCount - 1) {
      config.aiSeats = Array.from({ length: ai }, () => ({ difficulty: 'normal' as const }));
    }
    store.createRoom(nickname, config);
  };

  /** 人数变化：AI 数选项上界随之收紧，已选值 clamp 到 playerCount-1。 */
  const onPlayerCountChange = (value: string): void => {
    setPlayerCount(value);
    const maxAI = Number(value) - 1;
    if (Number(aiCount) > maxAI) setAiCount(String(maxAI));
  };

  const onJoin = (e: FormEvent): void => {
    e.preventDefault();
    const nickname = joinNick.trim();
    const code = joinCode.trim();
    if (!connected || nickname === '' || code === '') return;
    store.joinRoom(code, nickname);
  };

  /** 选择记录文件 → 读入文本框（统一走粘贴提交流程）。 */
  const onImportFile = (files: FileList | null): void => {
    const file = files?.[0];
    if (file === undefined) return;
    file
      .text()
      .then((text) => {
        setImportText(text);
        setImportError(null);
      })
      .catch(() => setImportError('文件读取失败'));
  };

  /** 导入复盘：本地 JSON 解析 + 形状预检 → 发 import_game（服务器重放校验）。 */
  const onImport = (e: FormEvent): void => {
    e.preventDefault();
    if (!connected || importText.trim() === '') return;
    let record: GameRecord;
    try {
      record = JSON.parse(importText) as GameRecord;
    } catch (err) {
      setImportError(`JSON 解析失败：${(err as Error).message}`);
      return;
    }
    if (
      record === null ||
      typeof record !== 'object' ||
      record.version !== 1 ||
      typeof record.config !== 'object' ||
      record.config === null ||
      !Array.isArray(record.actions)
    ) {
      setImportError('记录格式非法：应为 {"version":1,"config":{...},"actions":[...]}');
      return;
    }
    setImportError(null);
    store.importGame(record);
  };

  return (
    <main className="app lobby">
      <header className="lobby-hero">
        <p className="eyebrow">Terraforming · 星际殖民</p>
        <h1>盖亚计划</h1>
        <p className="subtitle">在线对局大厅</p>
        <p
          className={`connection-pill ${CONNECTION_TONE[s.connection] ?? 'bad'}`}
          data-testid="connection-status"
        >
          <span className="connection-dot" aria-hidden="true" />
          {CONNECTION_LABEL[s.connection] ?? s.connection}
        </p>
      </header>
      {s.lastError !== null ? (
        <p className="error-banner" data-testid="last-error" role="alert">
          {s.lastError.code}: {s.lastError.message}
        </p>
      ) : null}

      <div className="lobby-panels">
        <form className="panel" data-testid="create-form" onSubmit={onCreate}>
          <h2 className="panel-title">创建房间</h2>
          <p className="panel-desc">开一局新对局，把房码分享给朋友</p>
          <Field label="昵称">
            <input
              data-testid="create-nickname"
              value={createNick}
              placeholder="你的名字"
              onChange={(e) => setCreateNick(e.target.value)}
            />
          </Field>
          <div className="field-row">
            <Field label="人数">
              <select
                data-testid="create-player-count"
                value={playerCount}
                onChange={(e) => onPlayerCountChange(e.target.value)}
              >
                <option value="2">2 人</option>
                <option value="3">3 人</option>
                <option value="4">4 人</option>
              </select>
            </Field>
            <Field label="AI 座位">
              <select
                data-testid="create-ai-count"
                value={aiCount}
                onChange={(e) => setAiCount(e.target.value)}
              >
                {Array.from({ length: Number(playerCount) }, (_, i) => (
                  <option key={i} value={String(i)}>
                    {i === 0 ? '无' : `${i} 个`}
                  </option>
                ))}
              </select>
            </Field>
            {aiCount !== '0' ? (
              <Field label="AI 强度">
                <span className="field-static" data-testid="create-ai-difficulty">
                  启发式（内置）
                </span>
              </Field>
            ) : null}
          </div>
          <Field label="扩展">
            <label className="checkbox-line">
              <input
                type="checkbox"
                data-testid="create-lost-fleet"
                checked={lostFleet}
                onChange={(e) => setLostFleet(e.target.checked)}
              />
              Lost Fleet（失落舰队）
            </label>
          </Field>
          <Field label="种族选取方案">
            <select
              data-testid="create-faction-mode"
              value={factionMode}
              onChange={(e) => setFactionMode(e.target.value as FactionMode)}
            >
              {FACTION_MODES.map((m) => (
                <option key={m} value={m}>
                  {FACTION_MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="种子（可选）">
            <input
              data-testid="create-seed"
              value={seedText}
              placeholder="留空随机"
              inputMode="numeric"
              onChange={(e) => setSeedText(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </Field>
          <button
            type="submit"
            className="btn-primary"
            data-testid="create-submit"
            disabled={!connected || createNick.trim() === ''}
          >
            创建房间
          </button>
        </form>

        <form className="panel" data-testid="join-form" onSubmit={onJoin}>
          <h2 className="panel-title">加入房间</h2>
          <p className="panel-desc">输入朋友分享的房间码</p>
          <Field label="昵称">
            <input
              data-testid="join-nickname"
              value={joinNick}
              placeholder="你的名字"
              onChange={(e) => setJoinNick(e.target.value)}
            />
          </Field>
          <Field label="房间码">
            <input
              data-testid="join-code"
              value={joinCode}
              placeholder="例如 AB23CD"
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/\s/g, '').slice(0, 8))}
            />
          </Field>
          <button
            type="submit"
            className="btn-primary"
            data-testid="join-submit"
            disabled={!connected || joinNick.trim() === '' || joinCode.trim() === ''}
          >
            加入房间
          </button>
        </form>

        <form className="panel" data-testid="import-form" onSubmit={onImport}>
          <h2 className="panel-title">导入复盘</h2>
          <p className="panel-desc">粘贴导出的对局记录 JSON，或选择文件，重放整局</p>
          <Field label="对局记录">
            <textarea
              data-testid="import-text"
              value={importText}
              rows={6}
              placeholder='{"version":1,"config":{...},"actions":[...]}'
              onChange={(e) => setImportText(e.target.value)}
            />
          </Field>
          <Field label="或选择文件">
            <input
              type="file"
              accept="application/json,.json"
              data-testid="import-file"
              onChange={(e) => onImportFile(e.target.files)}
            />
          </Field>
          {importError !== null ? (
            <p className="error" data-testid="import-error" role="alert">
              {importError}
            </p>
          ) : null}
          <button
            type="submit"
            className="btn-primary"
            data-testid="import-submit"
            disabled={!connected || importText.trim() === ''}
          >
            导入并复盘
          </button>
        </form>
      </div>
    </main>
  );
}

export function RoomView({ store }: { store: GameStore }): ReactElement {
  const s = useGameStore(store);
  const room = s.room;
  if (room === null) {
    return (
      <p className="status" data-testid="no-room">
        等待房间信息…
      </p>
    );
  }
  const seated = room.seats.filter((info) => info !== null).length;
  const aiCount = room.config.aiSeats?.length ?? 0;
  const seatedAI = room.seats.filter((info) => info?.isAI === true).length;
  // 真人 >= 1 且 真人 + AI 席位 >= 总人数 即可开始（server 同源裁决）
  const canStart = seated >= 1 && seated + aiCount >= room.seats.length;
  // 空位中开局时会被 AI 占据的席位（扣除已入座 AI，从末尾数）
  const remainingAi = Math.max(0, aiCount - seatedAI);
  const emptySeatIdxs = room.seats.flatMap((info, i) => (info === null ? [i] : []));
  const aiPlaceholderSeats = new Set(
    remainingAi === 0 ? [] : emptySeatIdxs.slice(-Math.min(remainingAi, emptySeatIdxs.length)),
  );
  const pct = Math.round(((seated + aiPlaceholderSeats.size) / room.seats.length) * 100);
  const draft = s.draft;

  return (
    <main className="app room-view">
      <header className="room-hero">
        <p className="eyebrow">集结 · 整装待发</p>
        <h1>{draft !== null ? '种族选取' : '等待大厅'}</h1>
      </header>

      <section className="code-ticket">
        <p className="code-label">房间码</p>
        <p className="room-code" data-testid="room-code">
          {room.code}
        </p>
        <CopyCodeButton code={room.code} />
        {room.seed !== undefined ? (
          <p className="seed-badge" data-testid="custom-seed-badge" title="建房时填入同一种子可复现同一张地图">
            种子 {room.seed}
          </p>
        ) : (
          <p className="seed-badge" data-testid="custom-seed-badge">种子：开局时随机</p>
        )}
        <p className="config-line" data-testid="config-line">
          {room.config.playerCount} 人局 · {room.config.lostFleet === false ? '基础版' : 'Lost Fleet'}
          {' · '}
          {FACTION_MODE_LABEL[room.config.factionMode ?? 'random']}
        </p>
      </section>

      {draft !== null ? (
        <>
          <DraftView store={store} room={room} draft={draft} />
          <section className="room-actions">
            <button className="btn-ghost" data-testid="leave-room" onClick={() => store.leaveRoom()}>
              离开房间
            </button>
          </section>
        </>
      ) : (
        <>
          <section className="seat-panel">
            <header className="seat-panel-head">
              <h2>玩家席位</h2>
              <p className="seat-count" data-testid="seat-count">
                已就位 {seated}/{room.config.playerCount}
                {aiPlaceholderSeats.size > 0 ? `（+${aiPlaceholderSeats.size} AI）` : ''}
              </p>
            </header>
            <div className="progress-track" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <ul className="seat-list">
              {room.seats.map((info, i) => (
                <li key={i} data-testid={`seat-${i}`} className={`seat-card${info === null ? ' empty' : ''}`}>
                  <span className="seat-avatar" aria-hidden="true">
                    {info === null ? '·' : info.nickname.slice(0, 1)}
                  </span>
                  <span className="seat-body">
                    {info === null ? (
                      aiPlaceholderSeats.has(i) && room.config.aiSeats !== undefined ? (
                        <>
                          <span className="seat-name">AI 席位</span>
                          <span className="ai-badge" data-testid={`seat-${i}-ai-badge`}>
                            启发式 · 开局加入
                          </span>
                        </>
                      ) : (
                        <span className="seat-empty">空位</span>
                      )
                    ) : info.isAI ? (
                      <>
                        <span className="seat-name">{info.nickname}</span>
                        <span className="ai-badge" data-testid={`seat-${i}-ai-badge`}>
                          AI
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="seat-name">
                          {info.nickname}
                          {info.seat === s.seat ? <span className="me-chip">（我）</span> : null}
                        </span>
                        <span className={`status-chip ${info.connected ? 'online' : 'offline'}`}>
                          <span className="status-dot" aria-hidden="true" />
                          {info.connected ? '在线' : '离线'}
                        </span>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="room-actions">
            <button
              className="btn-primary btn-start"
              data-testid="start-game"
              disabled={!canStart || s.connection !== 'connected'}
              onClick={() => store.startGame()}
            >
              {canStart ? '开始对局' : '等待更多玩家…'}
            </button>
            {canStart ? null : <p className="hint">满员后才能开始（或补 AI 席位）</p>}
            <button className="btn-ghost" data-testid="leave-room" onClick={() => store.leaveRoom()}>
              离开房间
            </button>
          </section>
        </>
      )}
    </main>
  );
}
