# Steam ↔ Xbox PC 游戏存档移植控制台 Pro - Agent 架构与全量故障问题清单 (agent.md)

本文档为 **Steam ↔ Xbox Save Migrator** 项目的 Agent 专属指导规范与全量故障风险剖析清单。本文档详细列出了**项目开发迄今为止出现过的所有真实故障缺陷**，以及**发布至生产环境可能遇到的所有潜在技术风险与防御应对预案**。

---

## 🚩 第一部分：已知且已修复的历史故障清单 (Historical Issues & Fixed Root Causes)

| 序号 | 故障现象 | 根因追溯 (Root Cause) | 彻底解决方案 |
| :--- | :--- | :--- | :--- |
| **H-01** | **程序启动崩溃 `XamlParseException`** | 在 XAML 字符串内使用了内联 `Click='OnShowBackupsClick'` 事件绑定，C# 4.0 动态解析找不到对应方法。 | 剔除 XAML 字符串内联事件处理，使用 `x:Name` 并在 C# 代码中统一完成 `Click += Event` 手动事件挂载。 |
| **H-02** | **《土豆兄弟》(Brotato) 移植提示成功但实机无效果** | 容器描述符仅做浅层匹配，误将 Steam 存档覆盖到了装有 `mod_loader_cache.json` 的 Blob 上，真正的 `save.json` 容器未被覆盖。 | 逆向解包 `container.<N>` 二进制头，过滤 `cache`/`log` 文件，精准定位映衬着 `save.json` 的核心主存档 Blob。 |
| **H-03** | **Xbox 云端静默回退（覆盖旧存档）** | 覆盖 Hex Blob 时未更新外层 `containers.index` 及子目录时间戳，微软云判定本地存档陈旧，自动从云端静默覆盖。 | 实现四重 UTC 时间戳同步（同时刷新 Blob 文件、`container.<N>`、`containers.index` 及容器文件夹的 `LastWriteTimeUtc`）。 |
| **H-04** | **《丝之歌》(Silksong) 移植后游戏启动闪退崩溃** | 强行给所有文件末尾添加 `0x00` Padding 补全，破坏了 Unity C# `BinaryFormatter` 字节流反序列化，导致运行时抛出 Fatal Exception。 | **彻底剔除强制 `0x00` 填充**，改用纯净原始 Byte 数据流写入；同时根据游戏引擎类型实施分类写入策略。 |
| **H-05** | **《丝之歌》描述符解析跳过 (Entry Skip)** | Team Cherry 引擎在 `container.1` 中采用了固定 160-字节/168-字节的 Struct 描述符结构，传统动态 `ReadInt32()` 读取长度报错。 | 编写双模逆向解析器：自动检测并支持 160/168 字节定长 Struct 描述符与动态 Length 描述符。 |
| **H-06** | **误覆盖备份节点 Blob** | 未匹配带版本号的 `user1_1.0.30000.dat` 槽位，降级处理时误将数据写入了 `NODELrestoreData1.dat` 节点。 | 实现 Slot 槽位智能模糊匹配（如 `user1` 匹配 `user1_1.0.30000.dat`），并严格隔离包含 `restore` / `bak` 的备份 Blob。 |

---

## ⚠️ 第二部分：发布生产环境可能出现的一切潜在问题与防御预案 (Potential Issues & Defensive Countermeasures)

在将本工具公开发布给广大玩家使用时，因玩家电脑环境千差万别，可能会遇到以下 7 类潜在技术问题。下表列出其触发场景与控制台内置的防御应对预案：

### 1. P-01：游戏进程在线导致的文件独占锁定 (File Lock & Access Denied)
- **触发场景**：玩家在 Xbox App / Steam 打开游戏的过程中，在控制台点击【开始移植】。
- **潜在后果**：Windows 抛出 `System.IO.IOException: 文件正由另一个进程使用 (0x80070020)` 崩溃。
- **防御预案**：
  1. 在移植前调用 `Process.GetProcessesByName` 检查游戏进程（如 `Brotato`, `Silksong`, `Palworld`）；
  2. 若检测到在线，弹出阻断提示：`“检测到《XXX》正在运行，请先完全退出游戏后再执行移植！”`；
  3. 文件读写统一使用 `FileShare.ReadWrite` 降级容错。

### 2. P-02：多 Xbox 账号登录下的 XUID 目录混淆 (Multi-Account XUID Ambiguity)
- **触发场景**：同一台电脑上有多个 Xbox 玩家账号登录过，`SystemAppData/wgs/` 下存在多个 32-字符 Hex XUID 文件夹。
- **潜在后果**：存档被写入了非当前登录账号的旧 XUID 目录中，当前玩家启动游戏看不到新存档。
- **防御预案**：
  1. 遍历所有 XUID 目录，根据 `containers.index` 的 `LastWriteTimeUtc` 自动锁定最新修改的活动 XUID；
  2. 在界面中清晰展示当前绑定的 XUID 账号标号。

### 3. P-03：微软云端强制同步冲突 (Xbox Cloud Sync Conflict Dialog)
- **触发场景**：微软云端的时间戳与本地时间戳出现微秒级偏差，Xbox 启动时弹出“使用云端存档还是本地存档”选择框。
- **潜在后果**：玩家如果误点了“使用云端存档”，会再次覆盖掉刚移植好的本地存档。
- **防御预案**：
  1. 在移植成功提示弹窗中，明确加入**高亮安全提醒**：`“重新打开 Xbox 游戏时，若弹出云同步确认框，请务必选择【使用本地存档 / Use Local Save】！”`。

### 4. P-04：长耗时读写导致的 WPF 主界面卡死 (UI Thread Freeze)
- **触发场景**：大型游戏（如《赛博朋克2077》、《幻兽帕鲁》）存档包含数百兆或上万个文件，全盘扫描耗时较长。
- **潜在后果**：WPF 主界面失去响应，标题栏显示“未响应”，玩家误以为程序崩溃而强制关闭。
- **防御预案**：
  1. 所有全盘扫描、ZIP 压缩、文件拷贝耗时逻辑统一封装在 `Task.Run()` 异步工作线程池中；
  2. 使用 `Dispatcher.Invoke()` 实时更新界面进度条与状态文本，保持主界面 60fps 顺畅响应。

### 5. P-05：高 DPI / 4K 屏幕下的界面元素裁剪错位 (High DPI & Resolution Clipping)
- **触发场景**：玩家使用 4K 显示器且 Windows 系统设置了 150% 或 200% DPI 缩放。
- **潜在后果**：控制台按钮被挤出可视区域、文本发生折叠重叠。
- **防御预案**：
  1. XAML 全面采用比例星级 Grid (`*`, `Auto`) 与弹性 Margin 布局；
  2. 关键区域包裹 `ScrollViewer`，确保在任何分辨率与缩放比例下均完美自适应显示。

### 6. P-06：磁盘空间不足或权限限制导致 Backup ZIP 写入失败 (Disk Full / Permission Denied)
- **触发场景**：玩家 C 盘/D 盘空间满了，或者将控制台放置在 `C:\Program Files` 等受保护目录下运行。
- **潜在后果**：创建 ZIP 备份时抛出 `UnauthorizedAccessException` 或 `IO.IOException` 异常。
- **防御预案**：
  1. 备份写入前检测目标盘符可用空间（`DriveInfo.AvailableFreeSpace`）；
  2. 使用 `try-catch` 包裹备份逻辑，若备份失败则阻断写操作并给出明确提示，防止破坏原存档。

### 7. P-07：非标准单文件/加密解密存档格式 (Custom Proprietary Save Encryption)
- **触发场景**：某些特殊游戏（如《FIFA》、《如龙》）在 Xbox 和 Steam 端使用了完全不同的自定义加密算法（如 AES-256 密钥不一致）。
- **潜在后果**：尽管文件路径和容器完全替换成功，但游戏读取时提示“存档损坏”。
- **防御预案**：
  1. 针对已知加密游戏（如 Palworld 需处理 sav 转换），内置转换 Hook 模块；
  2. 在预设清单中标注游戏兼容性等级（如 `[官方 100% 直通]` 或 `[加密需解密]`）。

---

## 📋 第三部分： Agent 规范与发布前 Verification Checklist

在提交发布版本编译成果前，Agent 必须强制执行以下 4 项核查：

- [x] **Check 1**：控制台在后台静默运行且不触发任何 WPF / XAML 线程异常；
- [x] **Check 2**：`WriteBlobWithPaddingAndTimestamps` 绝对保持原版 Byte 数据流，不添加多余 Padding；
- [x] **Check 3**：`ParseContainerHeader` 完美兼容动态 Length 描述符与 160/168-byte 160 定长 Struct 描述符；
- [x] **Check 4**：自动 ZIP 备份功能正常，包含完整时间戳回滚逻辑。
