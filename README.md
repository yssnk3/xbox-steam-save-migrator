# Steam ↔ Xbox 存档移植工具

在 **Steam** 与 **Xbox PC Game Pass** 之间迁移游戏存档的桌面工具。自动扫描双端存档路径，一键完成格式转换与落盘校验，并提供 Xbox 游戏库直启与云同步防护。

## 功能

**存档移植**
- 自动扫描 Steam（注册表 / libraryfolders.vdf / 多用户 userdata）与 Xbox（`Packages\<PFN>\SystemAppData\wgs\<XUID>`）存档路径
- 双端一键移植，写入前自动生成 ZIP 备份
- 落盘校验：文件尺寸、MD5 哈希、WGS 容器结构完整性（容器名 / GUID / 序号均不被改写）
- 移植预演（dry-run）：不写任何文件，先告诉你会写哪些槽位
- 任意目录手动移植、手动 WGS 容器解包 / 打包

**Xbox 游戏库**
- 一键扫描本机已安装的 Game Pass 游戏（AUMID 枚举，含图标与"是否有存档"标记）
- 一键启动游戏：走系统 `shell:appsFolder` 激活，**无需打开 Xbox 客户端**
- 云同步控制：停止云同步（尽力关闭 Xbox 应用全家桶 + GamingServices 服务），以及引导式上传云存档

**其他**
- 备份中心：查看 / 恢复 / 删除历史备份
- 存档格式识别：拖入任意路径自动判断属于哪款游戏（18/19 常见格式）
- 深色 UI，中英文游戏名映射，Steam 图标本地代理

## 快速开始

环境要求：Windows 10/11、Node.js 18+

```bash
npm install
npm start          # 后端 :3001 + 前端 :5173
```

开发模式（带 Electron 窗口）：

```bash
npm run electron:dev
```

## 打包

```bash
npm run electron:build
```

产物在 `release/`：`win-unpacked/` 为免安装版（双击 `Steam-Xbox-Save-Migrator.exe` 即用），以及 `release/*.zip`。

> **打包失败排查**：若 `electron-builder` 报 `rcedit.exe` / `elevate.exe` 不存在，通常是杀毒软件隔离了 `%LOCALAPPDATA%\electron-builder\Cache` 下的工具。将该目录加入杀软白名单后重试即可。当前仓库配置了 `signAndEditExecutable: false`，可绕开 rcedit 步骤（代价是 exe 缺少图标与版本信息）。

## 测试

```bash
npm test
```

包含 WGS 引擎自测（结构断言 + 字节一致性）与全库可移植性预测（只读 dry-run + 临时目录沙箱实写）。

## 使用须知

- **移植前请完全退出游戏和 Xbox 应用**。工具会检测进程占用并尝试自动关闭 Xbox 应用，但游戏本体需你手动退出。
- **Steam → Xbox 方向需要先在 Xbox 端启动过该游戏并产生存档**。WGS 的容器清单（容器名 / GUID）必须由游戏自身生成，工具只做"就地替换字节"以保结构，不会凭空创建容器。
- **云存档冲突**：若游戏内弹出存档选择框，请选择"使用本地存档"，否则云端旧档会覆盖刚移植的结果。可用"停止云同步"先行切断。
- 移植完成后建议启动游戏读档确认一次。文件层面的校验通过不代表游戏一定能解析该存档（各游戏存档字节格式由游戏自身决定）。
- 部分游戏不支持直接移植：如《幻兽帕鲁》两端 `.sav` 字节布局不同，需借助 `palworld-save-tools` 等外部工具转换；账号绑定类游戏（如《极限竞速：地平线5》）存档跨账号无效。

## 支持的游戏

内置数据库收录 30 款游戏（24 款直接支持、5 款需先启动游戏生成结构、1 款需外部转换工具），另有 9 款可识别但不支持一键移植。可在界面中通过"自定义游戏"添加数据库未收录的游戏。

## 技术说明

- 后端：Node.js + Express（`server/`）
- 前端：React 18 + TypeScript + Vite + Tailwind（`src/`）
- 桌面壳：Electron（`electron/`）
- WGS 容器格式：已逆向 Xbox 真实 v14 格式（`containers.index` + `container.N`，混合端序 GUID，160 字节定长描述符）

## 免责声明

本工具仅操作本机存档文件，不修改游戏进程、不绕过任何 DRM。存档操作存在风险，工具会在每次写入前自动备份，但请自行确认重要存档已有额外备份。使用本工具产生的任何后果由使用者自行承担。
