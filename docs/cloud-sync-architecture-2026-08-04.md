# Stylo 多端实时云同步架构评估与演进设计（2026-08-04）

## 结论

现有架构的主方向正确，不应退回“比较更新时间后整包覆盖”的同步方式：

- 每个 `(account, project)` 使用一个 Durable Object 作为强顺序协调单元；
- 项目正文以 Yjs 文档和增量更新为并发权威；
- Durable Object SQLite 在 ACK 前持久化更新和幂等操作号；
- D1 JSON 只是项目列表、公开读取和 Agent 的读模型；
- 客户端 IndexedDB 保存 checkpoint、confirmed checkpoint、epoch 和 outbox；
- 删除使用 tombstone，重置和历史压缩使用 epoch 隔离旧世代。

本轮发现的主要风险不在“有没有 WebSocket”，而在权威边界和 UI 投影：旧本地快照可能被误认成新修改、世代压缩时同字段离线修改可能整字段覆盖、编辑器可能把合并后的远端文本误当作本地回显忽略。相关启动增量、跨世代文本合并和文本投影竞态已补强。

## 一、必须固定的同步不变量

1. 云端真相不是“最后打开或最后关闭的设备”，而是服务端已经耐久接收的操作序列。
2. 客户端初次进入项目前必须先完成权威握手；普通 localStorage 快照没有上传资格。
3. 只有 durable outbox 能证明“本设备存在尚未被云端确认的原创操作”。
4. 每个更新在 ACK 前必须已写入客户端 outbox；服务端 ACK 前必须已写入房间 WAL。
5. 重试同一字节更新必须沿用同一 `opId`；与新更新合并后必须生成新 `opId`。
6. 同一项目的 `serverSeq` 单调递增，但它用于回执、读屏障和诊断，不用于替代 CRDT 因果关系。
7. 远端更新不能作为新的本地更新回传；本地编辑必须在应用远端投影前进入 CRDT。
8. 删除 tombstone 和 reset epoch 高于旧客户端内容；旧设备不得复活项目或旧世代。
9. `synced` 只能表示 outbox 与 pending ACK 均为空，并且最后写入已获得服务端回执。
10. 所有恢复流程必须收敛、幂等，并在任意一步崩溃后可继续。

## 二、各种设备时序应如何处理

| 场景 | 正确基线 | 客户端动作 | 禁止行为 |
| --- | --- | --- | --- |
| A、B 同时在线，改不同节点/字段 | 当前房间 Y.Doc | 两端立即本地应用，增量上行，服务端耐久后广播 | 整包后写覆盖 |
| A、B 同时编辑同一文本 | 共同 Y.Text 历史 | 按字符插入/删除合并并最终收敛 | 把整段文本当一个 LWW 字符串 |
| A 正在编辑，旧设备 B 刚打开且未编辑 | 服务端 checkpoint + update log | B 先采用云端，再开始编辑 | B 因“本地版本号较大/打开较晚”上传旧快照 |
| B 在首次握手完成前产生新编辑 | 云端状态 + B 相对启动快照的用户增量 | 握手后只把启动期间的 delta 重放到云端基线 | 把 B 启动时的完整旧项目重放 |
| A 已关闭，旧设备 B 后打开 | A 已被服务端 ACK 的最后状态 | B 采用云端；只重放 B 自己 durable outbox 中的未确认操作 | 根据文件时间或进程关闭时间猜“谁更新” |
| A 断网编辑后关闭，随后重开 | 云端状态 + A 的 durable outbox | 先恢复 outbox，再握手、去重重放 | 仅依赖易滞后的 React/localStorage 快照 |
| A、B 都离线编辑后依次上线 | 云端当前 CRDT + 各自离线操作 | 操作可交换、幂等合并；同文本保留双方字符操作 | 用单一 `updatedAt` 判一方整包获胜 |
| 服务器已做 epoch rebase，旧端带离线修改回来 | 新 epoch 云端语义状态 + 旧 confirmed/local/base | 三方语义 rebase；文本重建确定性字符分支 | 把旧 epoch Yjs 更新直接写入新文档，或同字符串本地整段覆盖远端 |
| 一端删除/重置，另一端离线编辑 | tombstone / reset epoch | 删除或重置获胜；旧端清缓存并停止重放 | 让离线编辑复活已删除 ID |
| ACK 丢失但服务端已提交 | 服务端 `opId` 去重记录 | 原 `opId` 重试并获得相同 `serverSeq` 回执 | 换 `opId` 造成重复语义写入 |

“A 关闭后 B 打开”没有特殊的可靠时间语义。若 A 的编辑已经被服务端 ACK，它自然已经是云端主线；若 A 没有 ACK，但本地 outbox 已耐久保存，它在 A 下次启动时仍可合并；若进程在任何耐久记录前被强杀，则任何同步系统都无法恢复尚未落盘的输入，因此编辑器本地持久化延迟也必须有明确上限。

## 三、同一文本节点的业内处理方式

### 1. 不是统一用“最后写入覆盖”

视觉对象的颜色、坐标、开关等单值属性常使用服务端排序的 LWW register；长文本若也这样处理，会导致一方整段消失。文本协作通常使用 OT 或序列 CRDT。Stylo 已选择 Yjs `Y.Text`，这是合适的：每个插入和删除携带因果身份，消息乱序、重复和离线重放后仍能收敛。

### 2. CRDT 保证收敛，不保证语义一定优雅

- 两人在不同位置插入，双方内容均保留；
- 两人在同一位置插入，结果按稳定规则排序；
- 两人同时替换同一词句，可能得到双方插入内容的组合；
- “把 A 改成 B”与“把 A 改成 C”不存在机器可证明的业务正确答案。

因此产品层还需要：

- presence、光标和选区提示，尽量减少同一区域盲改；
- 本地 undo manager，只撤销本用户操作，不能把协作者后续修改一起回滚；
- 对剧本整段重写、Agent 大块改稿等语义操作保留 proposal/review；
- 对尚未进入 CRDT 的本地草稿做三方合并：不相交区段自动合并，重叠替换才提示用户选择；
- 冲突选择前保留两份内容，不能只显示一个被覆盖后的结果。

### 3. Stylo 当前分层

- Yjs 内所有字符串都建模为 `Y.Text`；
- `flowNodes`、`flowProjects`、`links`、`roles`、`scenes` 等按稳定 ID 存储；
- React 快照只负责兼容现有 UI，不再是并发单位；
- 本轮为 epoch rebase 增加确定性的三方文本操作合并；
- 本轮为剧本未保存草稿增加“不相交自动合并、重叠才冲突”；
- 长期应让 Manus/文本编辑器直接绑定目标 `Y.Text` 和相对选区位置，避免每次远端字符更新都物化整个项目。

## 四、现有实现评估

### 已达到的生产级能力

- 项目房间按账户和项目隔离，编辑不依赖独占设备租约；
- WebSocket 使用一次性、短期、路由绑定的连接票据；
- Durable Object SQLite 事务先写 `room_operations`、`room_updates` 和元数据，再 ACK；
- 客户端单飞发送、ACK 超时重排、原操作号重试、outbox 先落盘后发送；
- checkpoint/update 分块避免平台单行 BLOB 上限；
- 投影有 debounce、字节阈值与 strong-reader flush barrier；
- hibernating WebSocket attachment 恢复访问身份；
- 房间、账户和 viewer 连接数以及消息/字节速率有上限；
- 项目目录独立于正文投影，并通过账户实时通道失效；
- 删除后台任务、tombstone、reset epoch 和客户端缓存清除形成完整生命周期；
- 大小校验、不可重放 ticket、无 payload 日志等安全边界已存在。

### 本轮确认并加固的问题

1. **旧设备启动权威倒置**：普通本地快照即使 revision 看起来更大，也可能只是后来打开的旧副本。启动现在只信云端，除非存在 durable outbox；握手前真实新编辑只按相对启动基线的 delta 重放。
2. **陈旧快照误删未见实体**：全快照同步会把另一端新增、旧端从未见过的 Manus 页面解释成删除。新增 `applyProjectSnapshotDelta`，删除必须是“启动基线中存在、用户新快照中消失”的显式动作。
3. **跨 epoch 同文本覆盖**：原三方合并在双方修改同一字符串时整段选择 local。现在从共同文本基线重建两个稳定 Y.Text 分支，保留双方字符操作。
4. **本地回显误吞远端文本**：编辑器原先用一个布尔值忽略下一次属性更新。现在记录精确的本地文本回显队列，只有内容完全相同才忽略，合并后的远端投影必须采用。
5. **剧本草稿过度冲突**：本地未保存草稿与远端修改只要同时存在就要求二选一。现在不同文本区段自动三方合并，真正重叠替换仍保留显式冲突。

### 仍需继续演进的风险

#### P0：服务端只验证 Yjs 编码，不验证业务 mutation

当前 owner 可以发送合法 Yjs 二进制但构造无效项目形状。服务端会检查 epoch、大小、速率和编码，但完整 schema 校验发生在投影阶段。生产方案应逐步引入 typed mutation envelope：

```ts
type ProjectMutation =
  | { kind: "text.splice"; nodeId: string; field: "text" | "content"; index: number; delete: number; insert: string }
  | { kind: "node.patch"; nodeId: string; patch: SafeNodePatch }
  | { kind: "node.create"; node: SafeNode }
  | { kind: "node.delete"; nodeId: string }
  | { kind: "link.create"; link: SafeLink }
  | { kind: "link.delete"; linkId: string };
```

服务端在事务前验证权限、引用完整性、字段白名单和资源配额，再转换为 Yjs 更新。迁移期可同时接受旧 opaque update，但只对受信版本开放，并在投影失败时隔离 generation，而不是持续 ACK 后让读模型永久失败。

#### P1：客户端远端应用仍是 O(项目总大小)

网络包已经增量化，但每个远端更新仍读取、规范化、指纹化并写回完整 `ProjectData`。下一步应建立 action-level projection：

1. 文本编辑器直接绑定 Y.Text；
2. node/link create、delete、patch 直接更新 Zustand 对应实体；
3. 高频 viewport、selection、临时 signed URL 永不进入项目文档；
4. 完整 materialization 仅用于冷启动、校验、导出和周期一致性检查。

#### P1：项目正文和读模型需要进一步拆分

D1 当前每次投影仍序列化完整 JSON。大型项目应拆为：项目 descriptor、节点索引、正文块、资源引用、Agent 检索索引。强读以 `serverSeq` barrier 保证投影至少达到请求版本，公共列表可以保持短暂最终一致。

#### P1：presence 与协作 undo 尚未成为协议一等公民

presence 应是有 TTL 的临时通道，不写项目历史；包含 device/session、active node、相对选区和 composing 状态。Undo 应按本地 origin 跟踪，不能做完整快照回滚。

#### P2：多设备故障注入需要模型化

现有单元测试覆盖关键故障，但还应增加一个确定性仿真器，随机执行：连接/断开、乱序/重复/丢包、ACK 丢失、进程崩溃、epoch rebase、reset/delete、并发文本和实体操作。每条随机轨迹最终验证：所有在线副本语义相等、已 ACK 操作不丢失、tombstone 不复活、outbox 可重放、读模型不超前于权威。

## 五、目标数据流

```text
UI typed action
  -> local CRDT / local entity store (立即可见)
  -> atomic IndexedDB outbox
  -> coalesced WebSocket frame
  -> Project Durable Object
       -> validate identity / epoch / mutation / quota
       -> SQLite WAL + op-id + serverSeq (一个事务)
       -> ACK sender + broadcast peers
       -> debounced checkpoint and D1 read projection
  -> peer applies incremental operation
  -> typed UI projection (无需整项目物化)
```

冷启动则反向建立基线：

```text
load local checkpoint + confirmed + outbox
  -> connect and receive authoritative epoch/checkpoint
  -> same epoch: CRDT state-vector merge
  -> new epoch: confirmed/local/remote semantic rebase
  -> replay only durable outbox or edits made after startup baseline
  -> publish visible state
```

## 六、发布与迁移建议

1. 保持现有协议 v1 可读，新增能力通过 capability/version 握手发布。
2. 先上线服务端对新 mutation envelope 的双读和观测，不立即拒绝旧客户端。
3. 再让新客户端优先发 typed mutation；对每种 action 比较 typed projection 与全量 materialization 是否一致。
4. 达到覆盖率后停止旧 opaque owner update，只保留 checkpoint/bootstrap 格式。
5. 项目级启用新协议，不做全账户一次性切换；失败可回退到 v1 读取和只读模式。
6. 发布门禁必须包含双客户端 smoke、离线恢复、删除/重置、Worker hibernation、D1 flush、生产大小上限和故障注入。

## 七、观测指标

- `local_action_to_remote_apply_ms` p50/p95/p99；
- ACK 延迟、重连次数、outbox 年龄和字节数；
- duplicate `opId` 命中率与 ACK timeout 率；
- epoch rebase 次数、三方文本重叠次数、人工冲突次数；
- 每次 update/完整 checkpoint/物化 JSON 字节数；
- 单次远端投影 CPU 时间和 React commit 时间；
- D1 projected lag（`serverSeq - projectedSeq`）；
- schema quarantine、非法引用、超额和 ticket 拒绝；
- tombstone resurrection attempt；
- 客户端 checkpoint/outbox 持久化失败。

## 参考实践

- Yjs shared types 与 document updates：<https://docs.yjs.dev/getting-started/working-with-shared-types>、<https://docs.yjs.dev/api/document-updates>
- Figma 多人编辑中的对象属性粒度、离线重放和服务端权威：<https://www.figma.com/blog/how-figmas-multiplayer-technology-works/>
- Figma 通过 WAL 改善多人服务可靠性：<https://www.figma.com/blog/making-multiplayer-more-reliable/>
- Local-first 与 CRDT 原则：<https://www.inkandswitch.com/local-first/>
- Durable Objects WebSocket hibernation 与 SQLite durability：<https://developers.cloudflare.com/durable-objects/best-practices/websockets/>、<https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/>
