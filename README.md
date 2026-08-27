# dsh-channel-view（spike → v2.2 渠道 tab）

> A **zero-host-modification** plugin for DeepSeek Harness: injects a parallel `Channels` tab beside the sidebar's "工作区" header and groups every session by declared channel — powered entirely by official extension surfaces (bundle client module, `sidebar.footer.action` slot, session projections, react-dom portal). 不改一行宿主的 DSH 渠道会话视图插件：侧栏「工作区」旁注入平行 Channels tab，按渠道分组全部会话，全程只用官方扩展面。

DSH「渠道会话视图」原型。**spike 三问已全部验证通过（2026-08-27 实测 CHAIN ALIVE ✔）**：

| # | 扩展面 | 结果 |
|---|---|---|
| 1 | 第三方包 `exports["./client"]` 被浏览器启动图装载 | ✔ |
| 2 | 侧边栏插槽注册（footer.action） | ✔ |
| 3 | 会话投影数据链（宿主注册 → 官方推送帧 → 客户端 `projectionValues`） | ✔ latch 语义，6/8 挂值 |

v2 从"面板演示"进入"平行 tab 形态"：

## v2 行为

- **Channels tab 注入**：在 WorkspaceBrowser 的「工作区」标题行内注入 `[工作区 | Channels(n)]` 平行 tab（DOM 锚点 + `react-dom` portal，shell 播种的官方 react-dom 18.3.1，零 monkey-patch、不改宿主）；切到 Channels 隐藏官方列表分支，显示按渠道分组的会话列表，**点击行 = 打开会话**（`ctx.sessions.open`）。
- **归档可见（非丢弃）**：`workspaces.archivedSessionIds` 同源拆分——归档会话不进主分组，而是收进 Channels 视图底部的「已归档」折叠组（默认收起、整组浅色），可展开、点击尝试打开；`Channels n` 计数只含活跃。跨工作区扁平视图让迁移链（同一 first_prompt 反复续接）产生的同名会话同屏，故配套：
  - **同名去重后缀**：重名行（含归档）追加浅色的 `·<cwd 末级目录>`，末级名也撞车再追 `·<短 id>`；hover 展示完整标题/后缀/`（工作区已移除）`/完整 cwd/完整会话 id；
  - **孤儿标注**：`row.cwd` 不在 `workspaces.items` 注册路径集合中的行（工作区已删但会话尚存）标 `（工作区已移除）`；items 形状异常时空集跳过，宁可不标不误标。
- **运行中指示**：`row.running / isRunning / status==='running'` 任一命中 → 行左侧绿色脉冲圆点；非运行行保留同宽占位保证标题对齐。
- **"absent"如实化（修复②）**：读源确认宿主基线语义——attached 会话走 watermark cache 必出值；**冷会话只读持久化投影行、永不折日志**（`listProjectionsFor` 设计使然，非 bug）。分组显示为「未观测（冷/未声明）」，打开过一次后随快照落盘自动归队。
- **兜底**：锚定失败（结构/文案变化）或 `react-dom` 缺失 → 自动退化为 footer 浮层入口（浮层头部有 `portal ✓/✘` 状态）。

数据面全部走官方链路（useSessions 行 + 投影推送帧）。**渠道判定目前仍是 channelSpike latch 值**——真渠道（qq/c2c、qq/group…）需由持有权威映射的插件（如 dsh-qqbot 的 peer-map）注册投影单元声明，这是正式版的下一步；`origin` 字段值域只有 `subagent`，不能充当渠道。

## 结构

```
lib/index.js      宿主入口：注册 channelSpike 投影单元（观测 latch 语义）
lib/client.js     客户端 bundle（手写，无构建）：tab 注入 + 渠道分组视图 + 浮层兜底
cordis.patch.yml  bundle 层 patch：插入 channel-view-spike 行
```

## 安装（profile 为 web 时）

**registry 安装（npm）**：

1. `~/.dsh/profiles/web/package.json`：
   - `dependencies` 加 `"dsh-channel-view": "^0.0.1-spike.2"`；
   - `dsh.profile.bundles` 数组在 `@deepseek-ai/dsh-web-app` 之后加 `"dsh-channel-view"`；
2. `npm install --prefix ~/.dsh/profiles/web`（或 `dsh plugin --profile web add dsh-channel-view`）；
3. 重启 `dsh web`。

**开发模式（file: 克隆）**：`dependencies` 用 `"dsh-channel-view": "file:<本地克隆路径>"`，其余同上；纯客户端改动浏览器刷新即生效（宿主入口改动才需重启）。

## 诊断

- **tab 不出现且浮层 `portal ✘`** → react-dom 播种缺失或锚点文案变化，浮层仍可用；
- **tab 出现但 Channels 里全是"未观测"** → 投影单元未注册/未推送（查宿主启动日志 `[dsh-channel-view]` 行）；
- 看门狗每 2s 检查注入节点存活性（React 重渲染冲掉时自动重装）。

## 限制（当前阶段声明）

- 渠道值为 spike latch，非真实渠道（见上）；
- tab 注入锚定依赖「工作区/Workspaces」文案与 `regionArea` 类名前缀（css-modules 键名），宿主 UI 大改时失效——正式版若上游接受 RFC，应改为官方 tab 槽；
- `0.0.x-spike` 版本线：接口与形态可能随 RFC 进展变动，生产采用请锁版本。

## 与 dsh-channel-spec 的关系

[RGarvel/dsh-channel-spec](https://github.com/RGarvel/dsh-channel-spec)（RFC-0001，源自 [deepseek-harness#3897](https://github.com/deepseek-ai/deepseek-harness/discussions/3897)）是本功能的**规范载体**，两库分工：

| 库 | 角色 | 回答的问题 |
|---|---|---|
| `dsh-channel-spec` | RFC 规范（纯文档） | 渠道**应该**长什么样：宿主原生 `session.header.channel` 字段 + 官方 GUI 渠道视图 |
| `dsh-channel-view`（本库） | 参考实现（spike，纯第三方插件形态） | **不改宿主**能做到什么程度：插槽 + 会话投影 + portal 注入的链路实证 |

演进契约：RFC 被上游采纳/实现后，本库的 DOM 注入部分应迁往官方槽位、库降级为参考实现存档（spec 的 Related 与本节保持互链）；RFC 未决期间本库继续以插件形态演进（下一步：dsh-qqbot peer-map → 真渠道投影）。

## License

MIT
