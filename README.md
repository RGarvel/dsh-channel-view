# @rgarvel/dsh-channel-view（spike → v2.2 渠道 tab）

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

1. `~/.dsh/profiles/web/package.json`：
   - `dependencies` 加 `"@rgarvel/dsh-channel-view": "file:<本地克隆路径>"`（如 `file:D:/dsh-channel-view`）；
   - `dsh.profile.bundles` 数组加 `"@rgarvel/dsh-channel-view"`；
2. `npm install --prefix ~/.dsh/profiles/web`；
3. 重启 `dsh web`（仅宿主入口 lib/index.js 改动需要；**纯客户端改动浏览器刷新即生效**）。

## 诊断

- **tab 不出现且浮层 `portal ✘`** → react-dom 播种缺失或锚点文案变化，浮层仍可用；
- **tab 出现但 Channels 里全是"未观测"** → 投影单元未注册/未推送（查宿主启动日志 `[dsh-channel-view]` 行）；
- 看门狗每 2s 检查注入节点存活性（React 重渲染冲掉时自动重装）。

## 限制（当前阶段声明）

- 渠道值为 spike latch，非真实渠道（见上）；
- tab 注入锚定依赖「工作区/Workspaces」文案与 `regionArea` 类名前缀（css-modules 键名），宿主 UI 大改时失效——正式版若上游接受 RFC，应改为官方 tab 槽；
- 不发布 npm，仅 file: 依赖本地验证。

规范背景：[RGarvel/dsh-channel-spec](https://github.com/RGarvel/dsh-channel-spec)（RFC-0001，源自 deepseek-harness discussion #3897）。

## License

MIT
