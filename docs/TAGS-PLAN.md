# BeyondFog 标签体系方案（TAGS-PLAN）

状态：提案，未实施。2026-11-10。范围只有本文件与 `tests/unit/tags-compat.test.ts`；不改 `src/`、`worker/`、`migrations/`，不写生产数据、不部署。目标形态：**文件夹为主归属 + 多标签**，一个站点仍只属于 0 或 1 个文件夹，同时可带 0..6 个标签，标签可增删改、可按标签过滤，且随偏好一起跨设备同步。

## 1. 结论先行

1. 方案可行，但顺序不能反：**先让服务端同时认识 v2/v3，再让客户端写 v3**。现有部署是"静态资源 + Worker 各自独立版本"，两者不可能同时切换。
2. **不能现在就把 `tags` 写进生产数据**。真正的危险不是"旧客户端保存报错"，而是两条静默覆盖路径：(a) 旧客户端读到 v3 数据时 `load()` 解析失败，但 `synced`/`revision` 已在解析**之前**前进（`src/usePreferences.ts:57-58`），下一次编辑就会用缓存或默认值覆盖该行；(b) 旧 Worker 读 v3 行 `safeParse` 失败 → 返回 `defaults` + `recovered:true`（`worker/index.ts:85-92`），用户"保存一次即可覆盖"会真的把 folders/shortcuts/tags 全部抹掉。
3. 把 v3 schema 直接顶替 v2 schema（不分版本）不会返回 400，而是**静默清空标签**：`.strict()` 只拒未知键，缺失键由 `.default()` 补，旧客户端 PUT 里没有 `tags`，服务器会把它写成 `tags: []`。
4. 必须的 worker 改动共 8 项（§5）：双版本 schema、版本闸、版本化白名单、v2 写 v3 行的合并、读时降级投影、`schemaVersion` 列、未知版本与损坏数据区分、读体积上限。
5. v3 只在 v2 之上**追加**两个可选字段，其余字段、上限、默认值逐字不变；标签为空时写回 v2 形态（规范化），让未用标签的账号保持今天的字节级行为，回滚零风险。
6. 分 4 个阶段落地（§7），回滚顺序是铁律：**客户端先退，Worker 后退，且 Worker 回退前必须先降级数据**（§8）。
7. 这套"先落兼容版本、再上新功能"的桥接流程在本仓库已被实际演练过（图标发布时用 `PUT` 的 `schemaVersion:2` 闸 + `hasOwn` 白名单防止旧页面覆盖，见 `docs/DEPLOYMENT.md:65,94`），标签方案照抄同一流程，不发明新机制。

关键数字：标签 ≤30 个、每站点 ≤6 个、名称 1..12 字符、id 1..36 字符、颜色 8 色枚举、`schemaVersion: 3`、缓存键 `beyondfog.snapshot.v3`、v3 PUT 体积上限 262144 → 393216。

## 2. 现状（读代码得到的事实）

| 位置 | 事实 | 对标签方案的含义 |
| --- | --- | --- |
| `src/shared/preferences.ts:12-23` | `preferencesSchema` 顶层 `.strict()`，顶层字段 `shortcutLayout/folders/engine/newTab/wallpaper/dim/shortcuts`，`superRefine` 校验文件夹 id 唯一与 `folderId` 引用 | 加字段必须走"新版本 schema + 服务端分支"，不能原地扩 |
| `src/shared/preferences.ts:8` | `shortcutSchema` 也是 `.strict()`，只有 `{id,title,url,folderId}` | 站点带标签 ⇒ 站点对象出现未知键 ⇒ 旧 schema 必然拒绝 |
| `src/shared/preferences.ts:11` | `folderSchema` `.strict()`，`{id,name,icon}`，`icon` 默认 `auto` | 标签结构照抄这个写法（id/name + 默认值） |
| `src/shared/preferences.ts:14,18` | 文件夹上限 20、捷径上限 100、捷径 id 唯一 | v3 必须原样保留，测试里已用 parity 用例锁住 |
| `src/shared/preferences.ts:27` | `defaults` 是**已 parse 的 v2 输出**，Worker 首行也用它（`worker/index.ts:63`） | `defaults` 必须保持能被 v2 schema 解析，否则首行天生就是 v3 |
| `src/usePreferences.ts:57-58` | `load()` **先** `revision.current=snap.version;synced.current=true`，**下一句**才 `preferencesSchema.parse(snap.data)`；解析抛错时 catch 只改状态文案，`synced`/`revision` 已经前进 | 旧客户端读到 v3 数据不是"冻结"，而是"提示连接失败、却认为自己已同步"：之后任何编辑都会拿缓存/默认值 + 服务端 version 发 PUT（见下两行） |
| `src/usePreferences.ts:70` | `flush()` 前置 `if(!actor\|\|!synced\|\|!dirty\|\|busy\|\|blocked)return` | 这道闸只看 `synced`，而 `synced` 在解析失败前已被置 true，所以它**挡不住**上面那条覆盖路径 |
| `src/usePreferences.ts:74` | PUT body 硬编码 `{schemaVersion:2, version, data}` | v3 客户端必须改这里；旧客户端永远是 2 |
| `src/usePreferences.ts:82` | 409 → `markBlocked(true)` + 冲突提示，本地编辑保留 | 版本闸就该继续用 409，不要新增 400 语义 |
| `src/snapshotCache.ts:10,23` | 键 `beyondfog.snapshot.v2`，读取时用 v2 schema 校验，失败即 `null`（fail-closed） | 缓存天然 fail-closed，但键需要版本化以避免标签闪烁 |
| `worker/index.ts:57-58` | `readJson(request, 262144)`；`schemaVersion !== 2` 直接 **409**「页面版本已更新，请刷新页面后继续保存」 | 旧 Worker + v3 客户端 = 409，不会写坏数据（这是已有设计） |
| `worker/index.ts:59` | `z.object({schemaVersion: literal(2), version, data: preferencesSchema}).strict()` | 换成 `literal(3)` + v3 schema 即双版本分支 |
| `worker/index.ts:61` | `Object.hasOwn(source,'shortcutLayout'\|'folders')` 缺失 → 409 | **同一个坑**：加 tags 后旧客户端 PUT 缺 `tags`，若只靠 default 就会静默清空 |
| `worker/index.ts:64` | `UPDATE ... WHERE owner=? AND version=?`，`changes===0` → 409 + `current` | CAS 语义不变，标签与文件夹共用同一个 `version` |
| `worker/index.ts:85-92` | 读路径 `safeParse` 失败 → 返回 `defaults` + `recovered: true` | 旧 Worker 读 v3 行会返回默认值，客户端提示"保存一次即可覆盖"→ 覆写 |
| `worker/types.ts:18` | `readJson(request, limit=65536)`，偏好用 262144 | v3 最坏文档会顶到上限（§5 W8） |
| `migrations/0001_initial.sql:9` | `preferences(owner, version, data, updatedAt)`，**没有 schemaVersion 列** | 无法从表结构判断行的版本，只能看 JSON 或加列 |

## 3. 目标设计

### 3.1 v3 的 zod 结构（即 `tests/unit/tags-compat.test.ts` 的 SPEC 段）

与 v2 的差异只有两处：顶层新增 `tags`、`shortcut` 新增 `tags`；其余字段连默认值都照抄 v2。下面的代码块与测试文件的 SPEC 段逐字相同，唯一多出来的是 `folderSchemaV3`/`wallpaperSchemaV3` 上方那行注释。落地时这两处直接复用 `src/shared/preferences.ts` 现有的 `folderSchema` 与 `wallpaperSchema`，并在 `tagColors` 之后补 `export type TagColorName = typeof tagColors[number];`。

```ts
export const tagColors = ['slate','blue','cyan','green','amber','rose','violet','pink'] as const;
// Names may be shown as chips and may end up in a filter URL, so characters that would need escaping
// there are rejected instead of percent-encoded later.
const tagName = z.string().trim().min(1).max(12).refine(s => !/[/%\\?#:\u0000-\u001f]/.test(s) && s !== '.' && s !== '..');
const tagId = z.string().min(1).max(36);   // crypto.randomUUID() is 36 chars; the cap keeps the worst-case payload under readJson
export const tagSchema = z.object({
  id: tagId,
  name: tagName,
  color: z.enum(tagColors).default('slate'),
}).strict();
// One shortcut may carry several tags; duplicates inside that list are meaningless and rejected here
// rather than deduplicated, because a silent fixup would hide an editor bug.
export const tagIds = z.array(tagId).max(6).default([]).refine(list => new Set(list).size === list.length);
export const shortcutSchemaV3 = z.object({
  id: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(40),
  folderId: z.string().min(1).max(64).nullable().default(null),
  url: z.url().max(2048).refine(s => { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; }),
  tags: tagIds,
}).strict();
// Local copies of the v2 folder and wallpaper rules (production imports folderSchema / wallpaperSchema).
const folderSchemaV3 = z.object({id: z.string().min(1).max(64), name: z.string().trim().min(1).max(24), icon: z.enum(['auto','folder','mail','briefcase','book','shopping','play','tools','code','star','heart']).default('auto')}).strict();
const wallpaperSchemaV3 = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('builtin'), id: z.enum(['alpine-mist','cloud-peaks','winter-light'])}).strict(),
  z.object({kind: z.literal('webdav'), file: z.string().min(1).max(255).refine(s => !/[/%\\\u0000-\u001f:#?]/.test(s) && s !== '.' && s !== '..')}).strict(),
]);
// A folder stays the primary membership; tags are secondary labels. Both are validated in the same
// document so one CAS version covers folder, shortcut and tag edits atomically.
export const preferencesSchemaV3 = z.object({
  shortcutLayout: z.enum(['flat','folders']).default('flat'),
  folders: z.array(folderSchemaV3).max(20).default([]),
  tags: z.array(tagSchema).max(30).default([]),
  engine: z.enum(['google', 'bing', 'baidu']), newTab: z.boolean(),
  wallpaper: wallpaperSchemaV3,
  dim: z.number().min(0.15).max(0.7),
  shortcuts: z.array(shortcutSchemaV3).max(100).refine(s => new Set(s.map(x => x.id)).size === s.length),
}).strict().superRefine((data, ctx) => {
  const folderIds = new Set(data.folders.map(f => f.id));
  if (folderIds.size !== data.folders.length) ctx.addIssue({code:'custom', path:['folders'], message:'文件夹 ID 重复'});
  const ids = new Set(data.tags.map(t => t.id));
  if (ids.size !== data.tags.length) ctx.addIssue({code:'custom', path:['tags'], message:'标签 ID 重复'});
  const names = new Set(data.tags.map(t => t.name.toLowerCase()));
  if (names.size !== data.tags.length) ctx.addIssue({code:'custom', path:['tags'], message:'标签名称重复'});
  for (const [i, s] of data.shortcuts.entries()) {
    if (s.folderId !== null && !folderIds.has(s.folderId)) ctx.addIssue({code:'custom', path:['shortcuts', i, 'folderId'], message:'文件夹不存在'});
    for (const [j, id] of s.tags.entries()) if (!ids.has(id)) ctx.addIssue({code:'custom', path:['shortcuts', i, 'tags', j], message:'标签不存在'});
  }
});
```

`folderSchemaV3`/`wallpaperSchemaV3` 在测试文件里是 v2 规则的局部副本（parity 用例保证它们和 `src/shared/preferences.ts` 的 v2 行为不漂移）。

### 3.2 归属与过滤模型

- `shortcut.folderId`：0 或 1 个，语义完全不变（文件夹仍是"主归属"，决定主界面分组与拖拽归属）。
- `shortcut.tags`：0..6 个标签 id，集合语义；数组顺序只用于稳定 diff，`superRefine` 已禁止同一 id 出现两次。
- 过滤是**视图**，不写数据：现有过滤器取值是 `all | none | folder:<id>`（`src/ShortcutSettings.tsx:24,25`），新增 `tag:<id>` 与 `untagged` 伪过滤器即可，且与文件夹过滤可叠加（先文件夹后标签）。
- 多选标签的默认语义取 **AND**（选得越多越窄，符合"过滤"直觉）；若后续要 OR，只改视图层，不动 schema。
- 过滤选择是**易失 UI 态**，不进 `data`、不同步、不写缓存 —— 与"标签本身是同步数据"（§3.4）严格区分。

### 3.3 非法输入处理

| 输入 | 处理 | 依据 |
| --- | --- | --- |
| 顶层无 `tags` / 站点无 `tags` | 读取时由 `.default([])` 补齐（v2 数据、旧行） | 兼容性必需 |
| 标签名空白（`'   '`、`''`） | 拒绝：`trim().min(1)` | §3.1 `tagName` |
| 名称 >12 字符 | 拒绝 | 同上 |
| 名称含 `/ % \ ? # :`、控制字符、`.`、`..` | 拒绝（不做百分号转义） | 同上 |
| `id` 空或 >36 字符 | 拒绝 | 体积预算（§5 W8） |
| `color` 缺失 | 视为 `slate` | `.default('slate')` |
| `color` 不在 8 色内 | 拒绝（不接受任意 hex，避免 CSS 注入面） | `z.enum(tagColors)` |
| 标签 id 重复 | 拒绝整份文档 | `superRefine` |
| 标签名重复（trim + lower 比较） | 拒绝整份文档 | `superRefine` |
| 同一站点 `tags` 内重复 | 拒绝整份文档 | `tagIds.refine` |
| 引用不存在的标签 | 拒绝整份文档，错误路径 `shortcuts.i.tags.j` | `superRefine` |
| 超过 30 标签 / 6 标签每站 / 100 捷径 / 20 文件夹 | 拒绝 | `.max(...)` |
| 任何未知键（顶层或站点内） | 拒绝整份文档 | `.strict()`（这就是旧客户端读 v3 失败的原因） |

**"空标签"的两种含义要分清**：站点 `tags: []` 是合法状态（没有标签）；标签本身名称为空是非法，不能存进 `tags` 数组。删除标签必须在**同一次 `edit()`** 内把引用一起清掉（照抄删除文件夹时把 `folderId` 置 null 的做法，`src/ShortcutSettings.tsx:58`），否则整份文档校验失败、`edit()` 里 `preferencesSchema.parse` 抛错（`src/usePreferences.ts:93`），编辑器会卡死。

### 3.4 标签是同步数据，不是内存态

- 与文件夹、站点同住 D1 的同一行、同一个 `version`（`migrations/0001_initial.sql:9`）：一次 PUT 原子提交全部改动，409 冲突语义、自动保存去抖（`src/usePreferences.ts:89`）、退出清理都不变。
- 不能只放 `localStorage`/React state：跨设备不一致、刷新即丢，直接违反 `docs/PLAN.md:17` 的"跨设备同步"。
- 不能单独建 `tags` 表或单独端点：会变成两次提交、两套版本号，还要解决"标签已删、引用未清"的半坏状态；现有 CAS 是整文档原子，没有这个问题的解药。
- 快照缓存（`src/snapshotCache.ts`）只是绘制提示，必须能被 v3 schema 校验；它不是标签的事实来源，写入路径永远是服务端快照。
- 唯一天然易失的是"当前选中哪个标签过滤"（§3.2）。

### 3.5 线格式

- `GET /api/preferences`（无参数，旧客户端）：Worker 返回 **v2 投影** `{version, data}`，`data` 里没有 `tags`。
- `GET /api/preferences?schemaVersion=3`：返回 `{version, schemaVersion:3, data}`，`data` 是完整 v3（v2 行自动补空标签）。
- `PUT /api/preferences` body：`{schemaVersion: 2 | 3, version: N, data}`；响应是同一版本的投影 `{version: N+1, schemaVersion, data}`。
- 外层 `schemaVersion` 是**追加字段**：`src/api.ts:16-21` 直接返回 JSON，旧客户端只读 `version`/`data`，多出来的字段被忽略。
- 版本闸只认 2 和 3；其它值一律 409（沿用 `worker/index.ts:58` 的文案与语义），不要改成 400。

### 3.6 写入规范化：empty = absent

校验通过后，若 `data.tags.length === 0` 且所有 `shortcut.tags.length === 0`，写入前删掉这些空数组，按 **v2 形态**存，`schemaVersion` 记 2。

好处：没用标签的账号写出来的行与今天**字节相同**，旧 Worker 回滚后仍可读，回滚风险归零；`schemaVersion` 列成为唯一判据，不再需要嗅探 JSON 键。只有在真的存在标签时才写 v3 形态。

## 4. 兼容性矩阵

### 4.1 先回答"A 会不会 400、会不会静默丢字段"

- `.strict()` **只拒未知键，不拒缺失键**；缺失键由 `.default()` 补。这是本方案所有坑的根源。
- 旧客户端读 v3 数据（服务端没做投影）：**不是 400**。`load()` 先置 `synced=true; revision=snap.version`（`:57`），紧接着 `preferencesSchema.parse` 抛 `unrecognized_keys`（`:58`），落到 catch 只把状态改成"连接失败/正在显示默认内容"（`:65`）。此时 hook 自认为已同步、`current.current` 仍是缓存或 `defaults`；**下一次编辑就会让 `flush()` 用这份旧内容 + 服务端最新 version 发 PUT**（`:70,:74`），CAS 版本相同所以写入成功 —— 有 v2 缓存时至少标签丢，没缓存时 folders/shortcuts 也一起被覆盖。这是比"页面坏了"更糟的静默覆盖。
- 旧客户端写：body 永远 `schemaVersion:2` 且不含 `tags`。如果服务端**不分版本**直接用 v3 schema 校验，解析会成功（默认值补齐），于是把 `tags: []` 写回存储 —— **静默清空标签**，全程没有任何报错。
- 旧 Worker 读 v3 行：`safeParse` 失败 → `recovered:true` + `defaults`（`worker/index.ts:85-92`），客户端提示"保存一次即可覆盖"，用户一编辑就会用默认值覆盖整行 —— **真正丢数据**。
- 400 只出现在一种畸形组合：payload 标成 `schemaVersion:2` 却含 `tags`，过了版本闸再被 strict parse 拒，走 `worker/index.ts:77` 的通用 400。标成 3 而 Worker 还是旧的 → 走 `:58` → **409**「页面版本已更新」。两者都不写数据。

### 4.2 矩阵

| 组合 | 结果 | 依赖 |
| --- | --- | --- |
| 旧客户端 + v2 行 | 与今天完全一致 | 无 |
| 旧客户端 + v3 行，Worker 已投影 | 正常；标签不可见但保存不丢（合并） | W4 合并 + W5 投影 |
| 旧客户端 + v3 行，Worker 未投影 | 提示"连接失败"，但 hook 已置 `synced`；下一次编辑会用缓存或默认值 + 服务端 version PUT，CAS 成功 ⇒ **覆盖**（有 v2 缓存时至少丢标签，无缓存时 folders/shortcuts 也丢） | 不能发生：先上 Worker（W5 投影） |
| 新客户端 + v2 行 | 正常；读时补空标签，首次带标签保存才升 v3 | W3 v3 分支 |
| 新客户端 + 旧 Worker | PUT 409「页面版本已更新」，本地编辑保留，无写入 | `worker/index.ts:58` 现状 |
| 新旧交替写同一行 | CAS 保证只有同版本才写；v2 写按 id 继承已存标签，不复活已删数据 | W4 |
| schema 收紧 / 改字段 | **禁止**：v3 只能追加可选字段（读时有默认值、写时显式必带）；上限只能 ≥ 现网实际用量 | §5 W3 |
| 快照缓存 v2/v3 混存 | 旧键 `.v2` 只被旧 build 读；新键 `.v3` 只被新 build 读；跨版本读到对方的键会 fail-closed 返回 null | §4.3 |
| Worker 回滚（已存在 v3 行） | **必须先降级数据**，否则旧 Worker 读不出一律 `recovered` → 覆写 | §8 |

### 4.3 快照缓存

- 新 build 用 `beyondfog.snapshot.v3`，并用 v3 schema 校验；同一 build 读到旧 `.v2` 键时补空标签可用，但为省一次解析和避免"无标签闪烁"，建议直接换键并在首次读取时删掉 `.v2`。
- 旧 build 读 `.v3` 键：`readCache()` 里 `parse` 抛错 → `null`（`src/snapshotCache.ts:23`），fail-closed 不崩，只是白丢一次绘制提示。
- 旧 build 的 `dropCache()` 只删 `.v2`（`src/snapshotCache.ts:33`）。因此回滚后 `.v3` 里可能残留私人快照 → 回滚包必须带一行 `removeItem('beyondfog.snapshot.v3')`，或按 §8 的清理步骤执行。
- 新 build 的 `dropCache()` 同时删两个键（登出语义"私人内容已清除"不能因为换键而退化）。

## 5. 必须的 worker 端改动

| # | 改动 | 理由 |
| --- | --- | --- |
| W1 | 双版本 schema：v2 原样保留，新增 `preferencesSchemaV3`；两者都放 `src/shared/preferences.ts` 供 Worker 与客户端复用 | 客户端也要在切换期校验两种形状 |
| W2 | 版本闸接受 2 与 3，其它版本 → **409**（沿用现有文案） | 旧客户端不认识 3，必须收到它已经会处理的 409 |
| W3 | 版本化校验 + 白名单：v2 分支 = 现有 `literal(2)` + v2 schema + `hasOwn(shortcutLayout/folders)` 一字不改；v3 分支 = `literal(3)` + v3 schema + `hasOwn(data,'tags')` + 每个 shortcut `hasOwn(shortcut,'tags')` | 要求"显式携带"，否则 missing→default→静默清空会重演 `worker/index.ts:61` 修过的坑 |
| W4 | v2 写 v3 行时合并：按 shortcut id 继承存储行的 `shortcut.tags`，并继承顶层 `tags`；合并结果整体过 v3 schema；**仅在 CAS 版本相等时合并**（不等本来就会 409），合并后仍非法 → 409 而非 400 | 旧客户端不该因为"不懂标签"而删标签；同版本合并不会复活已删除数据 |
| W5 | 读投影：无参 / `?schemaVersion=2` → 去掉 `tags` 后用 v2 schema 校验返回；`?schemaVersion=3` → v3 解析（v2 行补空标签）；响应外层加 `schemaVersion` | 旧客户端必须能读；外层字段对它是惰性的 |
| W6 | 版本判据：`migrations/0002_*.sql` 加 `ALTER TABLE preferences ADD COLUMN schemaVersion INTEGER NOT NULL DEFAULT 2`；**不要**把 schemaVersion 塞进 `data` JSON | 塞进 JSON 会被 v2 strict schema 拒（旧 Worker/旧客户端都读不了）。不迁移的兜底只能用 `Object.hasOwn(stored,'tags')` 嗅探，代价是未来 v4 无法区分 |
| W7 | 读路径区分"未知版本"与"损坏"：`schemaVersion > 3` → 409「数据版本较新，请更新页面或恢复上一版数据」，**不要**走 `recovered`+默认值；只有 JSON 损坏才保留现有恢复路径 | 现有 `recovered` 的初衷是"回滚时别把 owner 锁死"（`docs/PROGRESS.md:132`），对损坏数据成立；但"版本较新"下保存默认值必然抹掉新字段，等于把锁死换成静默丢失。正常运维不会出现该组合（§8 要求回滚前先降级），W7 只是兜底，且旧客户端会显示"连接失败 + 重试"而不是拿到一份可写的默认配置 |
| W8 | `readJson` 上限：v2 保持 262144；v3 提到 **393216** | 实测最坏 v3 文档（100 站点 × 2048 字符 URL × 每站 6 个 36 字符标签 id + 30 个标签 + 20 文件夹）= **258,741 B**，离 262144 只剩 3.4 KB；tag id 若用 64 字符则最坏 **281,981 B**，一份合法文档直接 413 —— 这就是 id 上限取 36 的由来（v2 现状最坏 230,632 B） |

其它必须保持不动：不新增 `preferences_tags` 表、不加 per-tag 端点、不改 CAS 的 `UPDATE ... WHERE version=?`、不改 `defaults` 的形状（`worker/index.ts:63` 首行插入的默认值必须仍是 v2 可解析的）、不改 409 的状态码与提示体系。

## 6. 为什么不能直接把 `tags` 写进现有生产数据

1. **旧客户端的失败在读取，后果却落在写入**：`src/usePreferences.ts:57-58` 先置 `synced`/`revision`，再 `preferencesSchema.parse`；v3 行里的 `tags` 让解析抛错，catch 只改提示文案（`:65`），`synced` 仍为 true。所以用户看到"连接失败"的同时，下一次编辑会用缓存/默认值 + 服务端 version 发 PUT，覆盖 v3 行。不是"页面坏了但数据安全"，而是"页面看着坏了、并且正在准备覆盖"。
2. **Worker 回滚会覆写数据**：本仓库的回滚方式是 `npx wrangler rollback <previous-version-id>`，旧部署保留不删（`docs/DEPLOYMENT.md:53-65`）。旧 Worker 读 v3 行必然 `safeParse` 失败 → 返回 `defaults` + `recovered:true`（`worker/index.ts:85-92`）→ 用户"保存一次即可覆盖"→ folders/shortcuts/tags 全没。图标发布时正是靠"先部署能读 icon 的桥接版本、再部署完整界面"避开这个坑（`docs/DEPLOYMENT.md:65,80-94`、`docs/ICON-PLAN.md:5`），标签要复用同一做法。
3. **无法判断行的版本**：`preferences` 表只有 `owner/version/data`（`migrations/0001_initial.sql:9`），旧 Worker 分不清"数据较新"和"数据损坏"，只能一律当损坏处理。
4. **`strict()` + `default()` 让"就地改 schema"变成静默删除**：旧客户端 PUT 不带 `tags`，新 schema 用默认值补齐后照常写入 —— 不报错、不 409、标签消失。这比拒绝更糟，因为没有任何信号。
5. **D1 写入有额度、没有自动备份/下迁移工具**：一旦写入只能靠手写 SQL 恢复（§8.2），所以必须先让所有可能读到这一行的代码都认识 v3，再允许任何代码写出 v3。

结论：v3 数据的**第一笔写入**必须发生在一个已经能读 v3、且能向 v2 客户端投影的 Worker 上线之后；这就是阶段 0/1 存在的理由。

## 7. 分阶段落地

### 阶段 0 — 只读兼容（Worker 先行，行为不变）

- 改动面：Worker 加上 v3 schema、读投影、合并与版本判据（`0002` 迁移），但对**现有 v2 写入必须是 no-op**（合并只在存储行已有标签时生效；没有标签时写出的字节与今天一致）。客户端把 v3 schema 与开关准备好，flag 关闭。
- 验证：`npm test`、`npx tsc --noEmit`；线上存一次、刷新一次仍正常；`GET /api/preferences?schemaVersion=3` 与无参 GET 除 `tags` 外一致；记录新 Worker 版本 UUID 作为回滚点。
- 回滚：换回上一版 Worker，无数据动作（本阶段不产生 v3 行）。

### 阶段 1 — 服务端双版本（PUT 接受 3）

- 改动面：W2/W3/W4/W6/W8 全部就位；客户端仍然只发 v2，不写 v3。
- 前置：按 `docs/DEPLOYMENT.md:63` 的规矩，先在 D1 Time Travel 建恢复书签（迁移只向前、回滚代码不会撤销表结构）。
- 验证（预览环境 + 本地 D1 副本，不动生产）：手工 PUT 一份 v3 文档 → `GET ?schemaVersion=3` 看到标签 → 无参 GET 是 v2 投影 → 再用 v2 body PUT（同版本）→ 标签仍在（合并生效）→ 跑 §8.2 降级 SQL → 行回到 v2 形态且能被 v2 schema 解析。
- 回滚：**先降级数据**（§8.2），再回退 Worker。

### 阶段 2 — 客户端开关

- 改动面：`?tags=1`（或编译期常量）打开标签 UI 与 v3 写入；`usePreferences` 的 GET 带 `?schemaVersion=3`、PUT 带 `schemaVersion:3`；缓存键切 `.v3`；标签增删改（删除时同一 `edit()` 内清引用）；过滤器加 `tag:<id>`/`untagged`；按钮按上限禁用（照 `src/ShortcutSettings.tsx:51,61` 的做法，不要提交后再报错）。
- 验证：桌面（v3）建标签并分配 → 手机用 `?tags=0`（强制 v2 线格式）改标题保存 → 桌面刷新后标签仍在；故意制造 409 → 现有冲突 UI 保留本地编辑；登出后 `.v2`/`.v3` 都被清掉。
- 回滚：关 flag，客户端立刻回到 v2 线格式，数据无需动作（合并保标签）。

### 阶段 3 — 默认开启

- 改动面：移除 flag，PUT 默认 3，文档（`README`/`docs/PROGRESS.md`）更新，标签 UI 进设置页。
- 判据见 §8.3；通过后再考虑把 §3.1 的 v3 schema 提升为 `preferencesSchema`，v2 降级为 `preferencesSchemaV2` 只用于投影与回滚。

## 8. 回滚计划

### 8.1 顺序铁律

**客户端先退，Worker 后退；Worker 回退之前必须先降级数据。** 反过来做就是 §6 第 2 条的覆写事故。

- R0（阶段 0/1 回滚）：换回上一个 Worker UUID，无数据动作。
- R1（阶段 2 回滚）：关 flag（`?tags=0`/常量），数据不动；Worker 保持双版本能力，标签被冻结但保留。
- R2（全量回滚）：先执行 §8.2 降级并验证，再切换静态资源与 Worker。

### 8.2 降级：丢弃 v3 字段回到 v2

用 `wrangler d1 execute` 对单行执行（已在 `node:sqlite` 验证，幂等）：

```sql
UPDATE preferences
SET data = json_set(
      json_remove(data, '$.tags'),
      '$.shortcuts',
      (SELECT json_group_array(json_remove(value, '$.tags')) FROM json_each(data, '$.shortcuts'))
    ),
    version = version + 1
WHERE owner = ?;

UPDATE preferences SET schemaVersion = 2 WHERE owner = ?;
```

- `version + 1` 是必须的：在线旧客户端会拿到 409，走现有冲突 UI 提示重载，从而不会拿着旧 revision 继续写。保留原 version 反而会让旧客户端"无感知"地在旧基础上写。
- 降级后必须校验：`preferencesSchema.parse(JSON.parse(row.data))` 成功，且 `schemaVersion = 2`。
- 只在确认存储行是 v3 时执行；对 v2 行执行是 no-op（幂等）。
- `schemaVersion` 列不回滚：D1 迁移只向前追加、回滚代码不撤销表结构（`docs/DEPLOYMENT.md:63`），列留着且默认 2 对旧 Worker 无害（它根本不读这一列）。

### 8.3 灰度判据（进阶段 2/3 的门槛）

- 阶段 1 部署后观察 ≥7 天：`BeyondFog preferences unreadable` 日志为 0；期间 ≥30 次成功 v2 PUT；`length(data) < 64 KiB`；`SELECT count(*) FROM preferences` 不变（仍是单 owner 单行）。
- v3 往返演练全部通过（§7 阶段 1 的验证清单），降级 SQL 已在行的副本上跑通。
- 回滚三件套就绪：上一版 Worker UUID、上一版静态资源、带 `.v3` 清理的旧客户端包。
- 阶段 2 至少一周双设备实测：v3 写 → v2 线格式写 → v3 再读，标签不丢；409 冲突恢复路径可用。
- 任何一条不满足就停在当前阶段，不带病进下一阶段。

### 8.4 409 处理与缓存清理

- 三段都可能收到 409，全部沿用现有策略：`markBlocked(true)` + 冲突提示 + 保留本地编辑 + 用户手动重载（`src/usePreferences.ts:82`）。不要为标签发明新的恢复交互。
- 降级后用 `version+1`：`load()` 只在服务端 `version` 比本地 `revision` 更旧时跳过（`:48`），降级后服务端版本更高，旧客户端重载会正常接受新内容；若保留原 version，陈旧缓存与线上行同版本，反而更容易让用户"看不到已经发生的变化"。
- 回滚到旧 build 前，先让新 build 登出一次或由回滚包清理 `beyondfog.snapshot.v3`，避免私人快照残留在不同键名下。

## 9. 本阶段未实施（明确清单）

- 只新增两个文件：本文件与 `tests/unit/tags-compat.test.ts`。未改 `src/`、`worker/`、`migrations/`、`package.json`、其它测试或文档。
- 未接线：`src/shared/preferences.ts` 仍是 v2；Worker 仍只认 `schemaVersion:2`；缓存键仍是 `.v2`；界面上没有任何标签入口。**测试通过只证明 schema 决策自洽，不证明功能可用。**
- 未写生产数据、未部署、未推送；未跑 Playwright（Lead 正在跑）。
- 测试里的 v3 schema 是局部常量（`tests/unit/tags-compat.test.ts`），与 §3.1 逐字一致，并用 parity 用例防止与 v2 行为漂移。
- 自测：`npm test -- tests/unit/tags-compat.test.ts`（7 passed）、`npx tsc --noEmit`（无输出）。

待拍板（不影响本阶段交付）：标签上限 30 / 每站 6 是否合适；名称 12 字符与保留字符集合（含 `%`、`#`）是否过严；8 色命名与现有 CSS 变量如何映射；多选过滤默认 AND 还是 OR；`schemaVersion` 列迁移 vs 嗅探兜底；是否允许同名不同 id 的标签（当前统一禁止）。

## 10. 风险点

1. **合并（W4）是新增的写路径**，写错就是静默丢标签；必须有单测直接覆盖"v2 body 写 v3 行，标签按 id 继承、删除的站点连标签一起走"。
2. **投影（W5）与规范化（§3.6）容易分叉**：一个在读、一个在写，必须共用同一个 strip 函数，否则会出现"读的时候没有、写的时候又冒出"的字段。
3. **体积只剩 3.4 KB 余量**：任何后续追加字段都可能触发 413，W8 的 393216 要在同一次改动里落地。
4. **缓存键版本化的副作用**：旧 build 的 `dropCache()` 不认 `.v3`，回滚包必须显式清理（§4.3）。
5. **Worker 回滚是唯一能真正毁数据的操作**，运维步骤必须写死顺序，且降级 SQL 要在真实行的副本上先演练。
6. **测试与实现会分叉**：v3 schema 现在是测试里的副本，进入阶段 2 时必须把它搬进 `src/shared/preferences.ts` 并让测试改为 import，parity 用例同时保留。
7. **UI 上限必须前置禁用**（按钮 `disabled`），否则用户会在提交后收到 400/409 的通用文案，体验与现有文件夹/站点上限不一致。
