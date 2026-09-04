/**
 * dsh-channel-view — 宿主入口（spike）
 *
 * 验证目标：第三方插件经官方会话投影注册表（ctx.sessionProjections）
 * 贡献只读数据，值经 session/projection 推送帧到达客户端
 * SessionSummary.projectionValues —— 无需任何私有 RPC。
 *
 * v2.5 追加：`/dsh-channel-view/state` 权威路由（webServer.register 官方 seam）。
 * 动机是宿主 core 的 live 缺陷：会话在 web 端被对话转为 live 后，客户端
 * dsh-client-runtime 的行 projectionValues 会被 core 以只含内置键的
 * projectionValuesOf(log) 重算，插件单元（qqChannel）的锁存值丢失 →
 * 该会话从 Channels 的 QQ 组掉进"未观测"。路由在宿主侧聚合
 * onChanged 实时 overlay ∪ sessionProjectionCache 冷快照，并附带
 * qqbot prefs 的"当前绑定会话"集合（活跃角标数据面），客户端不再
 * 依赖会被 core 冲掉的行值。
 *
 * 参考实现：@deepseek-ai/dsh-tool-todo 的 `todos` 单元。本包零运行时
 * 依赖（file: 装载下裸标识符导入不可靠），schema 用鸭子类型——注册表
 * 在边界只消费 `wire.viewSchema.parse(view(state))`。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const name = 'channel-view-spike';
const QQ_DIR = join(homedir(), '.dsh-qqbot');
const STATE_PATH = '/dsh-channel-view/state';

function readJsonSafe(file) {
  try {
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^/, ''));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 纯聚合（单测覆盖）：会话头列表 + 冷快照读取器 + live overlay +
 * qqbot 存储目录 → 权威渠道映射与当前绑定集合。
 * @param metas - sessionPersistence.list() 的会话头。
 * @param cachedSnapshot - (meta) => ProjectionSnapshot | undefined。
 * @param liveOverlay - Map<sessionId, qqChannelValue>，onChanged 实时喂。
 * @param qqDir - qqbot 存储目录（测试可注入 fixture）。
 */
export function buildChannelState({ metas, cachedSnapshot, liveOverlay, qqDir = QQ_DIR }) {
  const channels = {};
  for (const meta of metas) {
    if (meta.origin === 'subagent') continue;
    let value = liveOverlay.get(meta.id);
    if (value === undefined) {
      try {
        value = cachedSnapshot(meta)?.values?.qqChannel;
      } catch {
        value = undefined;
      }
    }
    if (typeof value === 'string' && value !== 'unobserved') channels[meta.id] = value;
  }
  const prefs = readJsonSafe(join(qqDir, 'model-prefs.json')) || {};
  const peers = readJsonSafe(join(qqDir, 'session-peers.json')) || {};
  const bound = [...new Set([
    ...Object.values(prefs.sessionIds || {}).filter((v) => typeof v === 'string'),
    ...Object.keys(peers),
  ])];
  return { channels, bound, generatedAt: Date.now() };
}

/** 字符串值 schema（仅注册表边界的 parse 面） */
const stringSchema = {
  parse: (value) => {
    if (typeof value !== 'string') {
      throw new TypeError(`[dsh-channel-view] projection value must be a string, got ${typeof value}`);
    }
    return value;
  },
};

/**
 * 观测锁存：任何已提交事件（含注册后首次快照的惰性折叠）把状态从
 * 'unobserved' 翻到 'spike-channel'，引用一变即触发变更流 →
 * session/projection 帧广播到全部在线客户端 → 列表行实时获得值；
 * 翻转后的行也会持久化，冷会话重启后经 cachedSnapshot 可读。
 * 'unobserved' 状态永不成为线上值（view 只在观测后产生有效值）——
 * init 必须保持合法，因为快照对每个 live 会话现算 view，
 * viewSchema.parse 抛错会炸整条快照切面。
 */
export function apply(ctx) {
  // onChanged 实时 overlay：本进程存活期内发生锁存的会话从这里补
  //（冷会话走 cachedSnapshot）。注册表把每次值变化回调给订阅者；
  // 只关心 qqbot 插件注册的 qqChannel 单元。
  const liveOverlay = new Map();
  // sessionProjections 是可选能力：headless 组装缺注册表时静默跳过
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register({
      key: 'channelSpike',
      stateSchema: stringSchema,
      init: () => 'unobserved',
      apply: (state) => (state === 'unobserved' ? 'spike-channel' : state),
      stateVersion: 1,
      // wire 缺席 = 纯宿主内部单元（不随快照下发）；本单元必须走 wire。
      wire: {
        viewSchema: stringSchema,
        view: (state) => state,
      },
    });
    try {
      // 真实签名：(session, key, value, seq) —— session 是会话对象；
      // disposer 随本插件 fiber 承载，无需显式登记。
      projectionCtx.sessionProjections.onChanged((session, key, value) => {
        if (key !== 'qqChannel') return;
        if (typeof value === 'string' && value !== 'unobserved') liveOverlay.set(session.id, value);
      });
    } catch (error) {
      console.error(`[dsh-channel-view] onChanged 订阅失败（live overlay 停用，冷快照路径不受影响）：${String(error)}`);
    }
    console.error('[dsh-channel-view] channelSpike projection unit registered');
  });

  // 权威状态路由：任一服务缺席（无 HTTP 载体的组装等）时静默跳过。
  ctx.inject(['webServer', 'sessionPersistence', 'sessionProjectionCache'], (routeCtx) => {
    routeCtx.webServer.register({
      kind: 'exact',
      path: STATE_PATH,
      handler: async (_req, res) => {
        let status = 200;
        let payload;
        try {
          const metas = await routeCtx.sessionPersistence.list();
          payload = buildChannelState({
            metas,
            cachedSnapshot: (meta) => routeCtx.sessionProjectionCache.cachedSnapshot(meta),
            liveOverlay,
          });
        } catch (error) {
          status = 500;
          payload = { error: String(error) };
        }
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(payload));
      },
    });
    console.error(`[dsh-channel-view] state route registered at ${STATE_PATH}`);
  });
}
