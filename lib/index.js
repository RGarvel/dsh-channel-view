/**
 * dsh-channel-view — 宿主入口（spike）
 *
 * 验证目标：第三方插件经官方会话投影注册表（ctx.sessionProjections）
 * 贡献只读数据，值经 session/projection 推送帧到达客户端
 * SessionSummary.projectionValues —— 无需任何私有 RPC。
 *
 * 参考实现：@deepseek-ai/dsh-tool-todo 的 `todos` 单元。本包零运行时
 * 依赖（file: 装载下裸标识符导入不可靠），schema 用鸭子类型——注册表
 * 在边界只消费 `wire.viewSchema.parse(view(state))`。
 */

export const name = 'channel-view-spike';

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
    console.error('[dsh-channel-view] channelSpike projection unit registered');
  });
}
