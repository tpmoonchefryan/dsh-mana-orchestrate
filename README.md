# dsh-mana-orchestrate

Mana Orchestrate 的 DeepSeek Harness 插件：把 Einzbern 项目记忆接入 DSH 会话，与 Claude Code、Codex 上的 Mana Orchestrate 同位。

0.2.0 起，0.1.0 的诊断壳已移除：M1 探针、`/tcrn-workflow/*` 路由、M2 Doctor 与 M3 钩子面板、门户声明、TCRN Workflow 1.x 的知识注入与会话摘要接线，以及对应的 `scripts/m*-*.mjs`、`c13-*`、`dispatch-*`、`activation-*` 脚本，全部不再存在。

## 行为

- 召回：每个带输入消息的 `agent/pre-step`，插件运行已安装引擎的稳定启动器 `<deviceHome>/engine/hook.mjs user-prompt-submit`，stdin 写入 `{hook_event_name, session_id, prompt, cwd}`。召回与 `next()` 并行启动，只在下游决定是 `enter` 时追加一条 user 消息，`source.kind` 为 `mana-orchestrate`。空批次直接 `next()`；`reject` 原样返回；任何失败都不阻断这一步。因为并行启动，下游决定 `reject` 时召回子进程照样运行一次（引擎照常写 hook.ndjson），只是结果不注入；这是有意保留的取舍，换来 `enter` 时不额外等待召回（协调库 TCRN-CROSS-MIN-270 D5）。
- 宿主变量：每次 spawn 显式传 `EINZBERN_HOST=dsh`；`deviceHome` 显式配置时同时传 `EINZBERN_HOME`。
- 导航行：设备 `machine-settings.json` 的 `agents.navigation` 为 `declined` 时，`agent/created` 运行 `session-start`、`subagent/start` 运行 `subagent-start`，把引擎输出注入该 agent。文本由引擎给出，插件不写死；其他取值不注入。稳定启动器只回应注册表覆盖的目录。
- 桥接去重：hooks-claude-code 的配置里已有同一事件的 `engine/hook.mjs <事件>` 命令时，本插件跳过该事件，原因码 `MANA_RECALL_BRIDGE_DUPLICATE`。配置文件取 `bridgeConfigPath`；为空时经 `ctx.registry` 读取已加载的 hooks-claude-code fiber 的 `configPath`。
- 状态卡：宿主注册只读 `GET /mana-orchestrate/status`。卡片在设置面挂载 `settings.plugin.item` 时作为其中 key 为 `mana-orchestrate` 的一项，宿主没有该槽时回落到 `shell.overlay`；沿用 0.1.0 的组件家族与样式，只换数据源。
- 状态路由不加鉴权，依赖宿主只绑 loopback，插件也不新增网络绑定；不要把宿主暴露到非 loopback 网络（协调库 TCRN-CROSS-MIN-270 D6）。路由返回的全部字段：

| 字段 | 内容 |
| --- | --- |
| `lastReasonCode` | 最近一次召回的原因码，未召回过为 `null` |
| `at` | 最近一次召回的时刻 |
| `event` | 最近一次召回的钩子事件名 |
| `detail` | 诊断详情，按原因码不同可能含：钩子启动器的本机路径 `launcher`、会话 cwd 的来源 `cwdSource`、`exitCode` 与 `signal`、`timeoutMs` 或 `aborted`、spawn 异常文本 `error`、stderr 中引擎的原因码 `engineReasonCode`、无效输出的字节数 `bytes`、桥接配置路径 `configPaths` 与 `bridgeLoaded`；不含 prompt 原文与召回注入的文本 |
| `bridgeDuplicate` | 最近一次是否因桥接重复而跳过 |
| `navigation` | 设备的 `agents.navigation` 取值 |

原因码：`MANA_RECALL_ANSWERED`、`MANA_RECALL_EMPTY`、`MANA_RECALL_TIMEOUT`、`MANA_RECALL_SPAWN_FAILED`、`MANA_RECALL_OUTPUT_INVALID`、`MANA_RECALL_ENGINE_REFUSED`（detail 带引擎的码）、`MANA_RECALL_NO_SUBPROCESS`、`MANA_RECALL_BRIDGE_DUPLICATE`。

## 配置

| 字段 | 缺省 | 含义 |
| --- | --- | --- |
| `deviceHome` | `''` | Einzbern 设备目录；空串依次取 `EINZBERN_HOME`、`~/.einzbern` |
| `timeoutMs` | `5000` | 单次钩子的超时 |
| `bridgeConfigPath` | `''` | 去重时检查的 hooks-claude-code 配置；空串取已加载桥的 `configPath` |

## 控制树守卫

`src/guard.ts` 只保留纯函数导出（`controlTreeGuardReason`、`shouldDenyControlTreeWrite` 等），不接任何宿主接缝。是否启用由后续批次决定。

## 本地检查

```sh
npm ci --legacy-peer-deps
npm run typecheck
npm run build
npm test              # node --test 单元测试，桩引擎在 mkdtemp 目录
npm run test:compose  # 真实 DSH 内核组合测试（devDependencies 钉 0.1.0-rc.7）
npm run verify        # 依次跑上面四项与 verify:licenses
```

测试不读写 `~/.dsh`、`~/.einzbern`，也不连宿主端口。

本仓采用 Apache-2.0，发布件包含 `LICENSE` 与 `THIRD_PARTY_NOTICES`。安装、push、tag、npm publish 与用户 profile 变更都不是本仓脚本的默认动作；`npm run release:artifact` 只生成本地 tarball、sha256 与归档 manifest。
