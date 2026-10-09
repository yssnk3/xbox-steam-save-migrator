/**
 * Pre-configured Database of Popular Cross-Platform (Steam <-> Xbox PC Game Pass) Games.
 * Each entry includes `processNames` for P-01 pre-migration process detection.
 */

export const GAME_DATABASE = [
  {
    id: 'vampire-survivors',
    name: 'Vampire Survivors (吸血鬼幸存者)',
    steamAppId: '1794680',
    steamSaveRelPath: '%APPDATA%\\Vampire_Survivors\\saves\\',
    xboxPackageName: 'poncle.VampireSurvivors*',
    category: 'A',
    saveFilePattern: 'SaveData_*.sav',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1794680/header.jpg',
    processNames: ['VampireSurvivors'],
    notes: '核心 SaveData 及成就 Blob 完全对齐，可直接提取或重组文件。'
  },
  {
    id: 'clone-drone',
    name: 'Clone Drone in the Danger Zone (克隆机器人大乱斗)',
    steamAppId: '597170',
    steamSaveRelPath: '%LOCALAPPDATA%Low\\Doborog Games\\Clone Drone in the Danger Zone\\',
    xboxPackageName: 'DoborogGames.CloneDroneintheDangerZone_*',
    category: 'A',
    saveFilePattern: '*.dat',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/597170/header.jpg',
    processNames: ['CloneDrone'],
    notes: '解锁数据与关卡进度双端通用。'
  },
  {
    id: 'palworld',
    name: 'Palworld (幻兽帕鲁)',
    steamAppId: '1623730',
    steamSaveRelPath: '%LOCALAPPDATA%\\Pal\\Saved\\SaveGames\\',
    xboxPackageName: 'PocketpairInc.Palworld_*',
    // 教程实测：Xbox(XGP) 端存档是容器包裹的 .SAV，与 Steam 端 GVAS .sav 字节
    // 布局不同，直接对拷游戏读不出来；需经 palworld-save-tools 等工具转换。
    // 此前的 A 类"直接对拷"标注是错的，降级为识别专用并硬性拦截。
    category: 'C',
    needsConversionTool: 'palworld-save-tools',
    saveFilePattern: '*.sav',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1623730/header.jpg',
    processNames: ['Palworld-Win64-Shipping'],
    notes: 'Xbox(XGP) 端 .SAV 与 Steam 端 .sav 字节布局不同，需先用 palworld-save-tools 等工具转换才能互通（教程实测）。暂不支持直接移植，已禁用双向一键移植；识别与提取备份不受影响。'
  },
  {
    id: 'starfield',
    name: 'Starfield (星空)',
    steamAppId: '1716750',
    steamSaveRelPath: '%USERPROFILE%\\Documents\\My Games\\Starfield\\Saves\\',
    xboxPackageName: 'BethesdaSoftworks.ProjectGold_*',
    category: 'A',
    saveFilePattern: '*.sfs',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1716750/header.jpg',
    processNames: ['Starfield'],
    notes: 'Xbox Blob 数据与 Steam .sfs 存档文件完全对应，可直接无损移植。'
  },
  {
    id: 'lies-of-p',
    name: 'Lies of P (匹诺曹的谎言)',
    steamAppId: '1627720',
    steamSaveRelPath: '%APPDATA%\\Neowiz\\Lies of P\\Saved\\SaveGames\\',
    xboxPackageName: 'NEOWIZ.LiesofP_*',
    category: 'A',
    saveFilePattern: 'SaveData*.sav',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1627720/header.jpg',
    processNames: ['LiesofP'],
    notes: '双端标准 Unreal GVAS .sav 格式，解包直接重命名即可。'
  },
  {
    id: 'deep-rock-galactic',
    name: 'Deep Rock Galactic (深岩银河)',
    steamAppId: '548430',
    steamSaveRelPath: '%STEAM_USERDATA%\\548430\\remote\\',
    xboxPackageName: 'CoffeeStainPublishing.DeepRockGalactic_*',
    category: 'A',
    saveFilePattern: '*.sav',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/548430/header.jpg',
    processNames: ['Deep Rock Galactic'],
    notes: '存档格式为 GVAS，可通过拖装或一键同步自由转存。'
  },
  {
    id: 'forza-horizon-5',
    name: 'Forza Horizon 5 (极限竞速：地平线5)',
    steamAppId: '1551360',
    steamSaveRelPath: '%STEAM_USERDATA%\\1551360\\remote\\',
    xboxPackageName: 'Microsoft.624F8B84B80_*',
    category: 'A',
    saveFilePattern: 'User_*',
    // 在线服务类：进度与微软账号绑定（教程明确提醒）。只移植自己账号的存档。
    accountBound: true,
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1551360/header.jpg',
    processNames: ['ForzaHorizon5'],
    notes: '核心 Profile Blob 相同。注意：在线服务类，存档与微软账号绑定——只移植你自己账号的存档，使用他人存档可能无法读档甚至有封号风险。导入后先禁用云同步启动测试。'
  },
  {
    id: 'monster-hunter-rise',
    name: 'Monster Hunter Rise (怪物猎人：崛起)',
    steamAppId: '1325200',
    steamSaveRelPath: '%STEAM_USERDATA%\\1325200\\remote\\',
    xboxPackageName: 'CAPCOM.MonsterHunterRise_*',
    category: 'A',
    saveFilePattern: 'data001Slot.bin',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1325200/header.jpg',
    processNames: ['MonsterHunterRise'],
    notes: '格式高度一致，双端存档二进制序列可互换。'
  },
  {
    id: 'persona-5-royal',
    name: 'Persona 5 Royal (女神异闻录5 皇家版)',
    steamAppId: '1687950',
    steamSaveRelPath: '%APPDATA%\\SEGA\\P5R\\Steam\\',
    xboxPackageName: 'SEGAofAmericaInc.F0CDA2EB77_*',
    category: 'A',
    saveFilePattern: 'DATA*.DAT',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1687950/header.jpg',
    processNames: ['P5R'],
    notes: 'DATA01.DAT 至 DATA16.DAT 对应不同 Save Slot，完全兼容。'
  },
  {
    id: 'no-mans-sky',
    name: "No Man's Sky (无人深空)",
    steamAppId: '275850',
    steamSaveRelPath: '%APPDATA%\\HelloGames\\NMS\\',
    xboxPackageName: 'HelloGames.NoMansSky_*',
    category: 'B',
    saveFilePattern: 'save*.hg',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/275850/header.jpg',
    processNames: ['NMS'],
    notes: 'Xbox Blob 使用了带 Header 包装的数据，可提取转换。'
  },
  {
    id: 'dead-cells',
    name: 'Dead Cells (死亡细胞)',
    steamAppId: '588650',
    steamSaveRelPath: '%STEAM_USERDATA%\\588650\\remote\\',
    xboxPackageName: 'MotionTwin.DeadCells_*',
    category: 'A',
    saveFilePattern: 'cells.sav',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/588650/header.jpg',
    processNames: ['deadcells'],
    notes: '双端存档格式一致，可直接互换。'
  },
  {
    id: 'hades',
    name: 'Hades (哈迪斯)',
    steamAppId: '1145360',
    steamSaveRelPath: '%USERPROFILE%\\Documents\\Saved Games\\Hades\\',
    xboxPackageName: 'Microsoft.Hades_*',
    category: 'A',
    saveFilePattern: 'Profile*.sav',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/header.jpg',
    processNames: ['Hades'],
    notes: '双端 SaveGame 容器一致，直接提取即可。'
  },
  {
    id: 'hollow-knight',
    name: 'Hollow Knight (空洞骑士)',
    steamAppId: '367520',
    steamSaveRelPath: '%APPDATA%\\..\\LocalLow\\Team Cherry\\Hollow Knight\\',
    xboxPackageName: 'TeamCherry.HollowKnight_*',
    category: 'A',
    saveFilePattern: '*.dat',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/367520/header.jpg',
    processNames: ['Hollow Knight'],
    notes: '双端存档文件一致，可互换。注意路径包含 .. 需正确解析。'
  },
  {
    id: 'cuphead',
    name: 'Cuphead (茶杯头)',
    steamAppId: '608980',
    steamSaveRelPath: '%USERPROFILE%\\AppData\\LocalLow\\Studio MDHR\\Cuphead\\',
    xboxPackageName: 'StudioMDHR.Cuphead_*',
    category: 'A',
    saveFilePattern: '*.save',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/608980/header.jpg',
    processNames: ['Cuphead'],
    notes: '双端存档格式一致。'
  },
  {
    id: 'hi-fi-rush',
    name: 'Hi-Fi Rush (完美音浪)',
    steamAppId: '1817230',
    steamSaveRelPath: '%LOCALAPPDATA%\\Hi-Fi Rush\\Saved\\SaveGames\\',
    xboxPackageName: 'BethesdaSoftworks.HiFiRush_*',
    category: 'A',
    saveFilePattern: '*.sav',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1817230/header.jpg',
    processNames: ['HiFiRush'],
    notes: 'Unreal GVAS 格式，双端兼容。'
  },
  {
    id: 'grounded',
    name: 'Grounded (禁闭求生)',
    steamAppId: '962130',
    steamSaveRelPath: '%USERPROFILE%\\Documents\\My Games\\Grounded\\',
    xboxPackageName: 'Microsoft.Grounded_*',
    category: 'A',
    saveFilePattern: '*.save',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/962130/header.jpg',
    processNames: ['Grounded'],
    notes: '双端存档一致，可互换。'
  },
  {
    id: 'stardew-valley',
    name: 'Stardew Valley (星露谷物语)',
    steamAppId: '413150',
    steamSaveRelPath: '%APPDATA%\\StardewValley\\Saves\\',
    xboxPackageName: 'ConcernedApe.StardewValley_*',
    category: 'A',
    saveFilePattern: '*',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/413150/header.jpg',
    processNames: ['Stardew Valley'],
    notes: 'Xbox 版存档可能位于 LocalCache\\Roaming\\StardewValley\\Saves，已自动兜底扫描。'
  },
  {
    id: 'persona-4-golden',
    name: 'Persona 4 Golden (女神异闻录4 黄金版)',
    steamAppId: '1113000',
    steamSaveRelPath: '%APPDATA%\\SEGA\\P4G\\Steam\\',
    xboxPackageName: 'SEGAofAmericaInc.Persona4Golden_*',
    category: 'A',
    saveFilePattern: 'DATA*.BIN',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1113000/header.jpg',
    processNames: ['P4G'],
    notes: '双端数据格式一致。'
  },
  {
    id: 'persona-3-reload',
    name: 'Persona 3 Reload (女神异闻录3 重装版)',
    steamAppId: '2161700',
    steamSaveRelPath: '%LOCALAPPDATA%\\Persona3Reload\\Saved\\SaveGames\\',
    xboxPackageName: 'SEGAofAmericaInc.Persona3Reload_*',
    category: 'A',
    saveFilePattern: '*.sav',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/2161700/header.jpg',
    processNames: ['P3R'],
    notes: 'Unreal GVAS 格式，双端兼容。'
  },
  {
    id: 'resident-evil-2',
    name: 'Resident Evil 2 (生化危机2 重制版)',
    steamAppId: '883710',
    steamSaveRelPath: '%STEAM_USERDATA%\\883710\\remote\\',
    xboxPackageName: 'CAPCOM.RE2_*',
    category: 'A',
    saveFilePattern: 'data*.bin',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/883710/header.jpg',
    processNames: ['re2'],
    notes: '双端存档二进制序列可互换。'
  },
  {
    id: 'resident-evil-3',
    name: 'Resident Evil 3 (生化危机3 重制版)',
    steamAppId: '952060',
    steamSaveRelPath: '%STEAM_USERDATA%\\952060\\remote\\',
    xboxPackageName: 'CAPCOM.RE3_*',
    category: 'A',
    saveFilePattern: 'data*.bin',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/952060/header.jpg',
    processNames: ['re3'],
    notes: '双端存档二进制序列可互换。'
  },
  {
    id: 'cities-skylines',
    name: 'Cities: Skylines (城市：天际线)',
    steamAppId: '255710',
    steamSaveRelPath: '%APPDATA%\\..\\LocalLow\\Colossal Order\\Cities Skylines\\',
    xboxPackageName: 'Microsoft.CitiesSkylines_*',
    category: 'A',
    saveFilePattern: 'Save.csk',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/255710/header.jpg',
    processNames: ['Cities'],
    notes: '双端存档一致。'
  },
  {
    id: 'octopath-traveler',
    name: 'Octopath Traveler (八方旅人)',
    steamAppId: '921570',
    steamSaveRelPath: '%STEAM_USERDATA%\\921570\\remote\\',
    xboxPackageName: 'SquareEnix.OctopathTraveler_*',
    category: 'A',
    saveFilePattern: 'sav*.dat',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/921570/header.jpg',
    processNames: ['Octopath'],
    notes: '双端存档格式一致。'
  },
  {
    id: 'dead-island-2',
    name: 'Dead Island 2 (死岛2)',
    steamAppId: '847800',
    steamSaveRelPath: '%LOCALAPPDATA%\\DeadIsland\\Saved\\SaveGames\\',
    xboxPackageName: 'deepsilver.77536c3fe941*',
    category: 'A',
    saveFilePattern: '*.sav',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/847800/header.jpg',
    processNames: ['DeadIsland2'],
    notes: '双端存档格式一致。'
  },
  {
    id: 'sea-of-thieves',
    name: 'Sea of Thieves (盗贼之海)',
    steamAppId: '1172620',
    steamSaveRelPath: '%LOCALAPPDATA%\\Packages\\Microsoft.SeaofThieves_*\\SystemAppData\\wgs\\',
    xboxPackageName: 'Microsoft.SeaofThieves_*',
    category: 'B',
    saveFilePattern: '*.gsv',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1172620/header.jpg',
    processNames: ['SoTGame'],
    notes: 'B 类：云端强同步，移植后需注意选择本地存档。'
  },
  {
    id: 'yakuza-7',
    name: 'Yakuza: Like a Dragon (如龙7)',
    steamAppId: '1234140',
    steamSaveRelPath: '%STEAM_USERDATA%\\1234140\\remote\\',
    xboxPackageName: 'SEGAofAmericaInc.yakuzalikeadragon*',
    category: 'A',
    saveFilePattern: '*.sav',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1234140/header.jpg',
    processNames: ['Yakuza'],
    notes: '双端存档格式一致。'
  },
  {
    id: 'brotato',
    name: 'Brotato (土豆兄弟)',
    steamAppId: '1948280',
    // Saves live under %APPDATA%\Brotato\<steamId64>\ (one folder per account).
    steamSaveRelPath: '%APPDATA%\\Brotato\\<...>',
    xboxPackageName: '*Brotato*',
    category: 'A',
    saveFilePattern: '*.json',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1948280/header.jpg',
    processNames: ['Brotato'],
    notes: '存档位于 %APPDATA%\\Brotato\\<账号ID>\\ 的 save.json / run_v3_*.json（非 saves\\ 子目录）。需过滤 mod_loader_cache.json。Xbox 发布商前缀已变更（19886SeavenStudio），使用宽松通配。'
  },
  {
    id: 'hollow-knight-silksong',
    name: 'Hollow Knight: Silksong (空洞骑士：丝之歌)',
    steamAppId: '1030300',
    steamSaveRelPath: '%LOCALAPPDATA%Low\\Team Cherry\\Hollow Knight Silksong\\<...>\\',
    xboxPackageName: 'TeamCherry.HollowKnightSilksong_*',
    category: 'B',
    saveFilePattern: '*.dat',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1030300/header.jpg',
    processNames: ['Silksong'],
    // Xbox blob 逻辑名 → Steam 实际读取的当前存档名。Unity 存档常把当前档写成
    // userN.dat、版本备份写成 userN_1.0.X.dat；移植后需把内容落到当前档名才生效。
    steamFileRenameMap: {
      'sharedData.dat': 'shared.dat'
    },
    steamStripVersionSuffix: true,
    // 无需任何专属写入规则：通用槽位匹配（同名 + 版本号后缀）天然给出教程实
    // 测的正确行为——save1..4 与 restore1..4 中的存档槽位被更新（restore 里的
    // 版本号备份槽由裸档名派生），sharedData.dat 找不到同名来源、绝不写入。
    // 2026-09-02 两次移植后黑屏，正是旧版凭人工映射把 Steam shared.dat 写进了
    // sharedData。此映射仅用于 Xbox→Steam 提取时的落盘命名。
    steamFileRenameMap: {
      'sharedData.dat': 'shared.dat'
    },
    notes: '与空洞骑士同引擎（Unity）。通用槽位匹配自动处理：save/restore 容器中的存档槽位会被更新，sharedData 不会被跨名写入（教程实测方法）。首次移植后请立即进游戏读档验证，若异常用备份恢复。',
  },
  {
    id: 'little-nightmares-enhanced-edition',
    name: 'Little Nightmares Enhanced Edition (小小梦魇精选版)',
    steamAppId: '2149010',
    steamSaveRelPath: '%LOCALAPPDATA%\\Little Nightmares Enhanced Edition\\Saved\\SaveGames\\',
    xboxPackageName: 'NAMCOBANDAIGamesInc.LittleNightmaresEnhancedEditio_*',
    category: 'B',
    saveFilePattern: '*.sav',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/2149010/header.jpg',
    processNames: ['LittleNightmares'],
    notes: 'Steam 存档为 *LNEESaveSlot*.sav。Xbox WGS 容器名即 Steam 文件名，提取后无需重命名（已实测：1483014080_LNEESaveSlot1.sav 等与 Steam 目录逐字节同名同大小）。移植前务必备份；字节是否被游戏读取仍需进游戏确认一次。'
  },
  {
    id: 'ori-will-of-wisps',
    name: 'Ori and the Will of the Wisps (奥日与鬼火意志)',
    steamAppId: '1057090',
    steamSaveRelPath: '%LOCALAPPDATA%\\Ori and the Will of the Wisps\\',
    xboxPackageName: '',
    category: 'B',
    saveFilePattern: '*',
    iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1057090/header.jpg',
    processNames: ['Ori'],
    notes: 'Steam 存档为 saveFile*.uberstate（本机已装，无 Xbox 端）。Xbox 端如后续安装可手动指定 WGS 目录。'
  },
];

// Games recognized by the content/filename identifier but NOT offered for
// migration. Their save formats are fingerprinted in gameIdentifier.js so an
// archive can be identified even when the game isn't installed; we don't
// enable one-click migration for them (no verified steam<->xbox layout).
// gameDetector.js intentionally does NOT read this array.
export const IDENTIFY_ONLY_GAMES = [
  {
    id: 'terraria',
    name: 'Terraria (泰拉瑞亚)',
    steamAppId: '105600',
    saveFilePattern: '*.wld',
    steamSaveRelPath: '%USERPROFILE%\\Documents\\My Games\\Terraria\\Worlds\\',
    category: 'C',
    notes: '识别专用（未启用一键移植）。存档为 .wld 世界文件 / .plr 玩家文件（Zip 格式）。'
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk 2077 (赛博朋克2077)',
    steamAppId: '1091500',
    saveFilePattern: 'save_*',
    steamSaveRelPath: '%USERPROFILE%\\Documents\\CD Projekt Red\\Cyberpunk 2077\\',
    category: 'C',
    notes: '识别专用（未启用一键移植）。存档含 save.png 缩略图 + metadata.9.json。'
  },
  {
    id: 'subnautica',
    name: 'Subnautica (深海迷航)',
    steamAppId: '264710',
    saveFilePattern: 'slot_*',
    steamSaveRelPath: '%USERPROFILE%\\AppData\\LocalLow\\Unknown Worlds\\Subnautica\\Subnautica\\',
    category: 'C',
    notes: '识别专用（未启用一键移植）。存档目录 slot_0000 等，含 gameinfo.json。'
  },
  {
    id: 'cult-of-the-lamb',
    name: 'Cult of the Lamb (羔羊教羽)',
    steamAppId: '1313140',
    saveFilePattern: 'meta_slot_*',
    steamSaveRelPath: '%LOCALAPPDATA%Low\\Massive Monster\\Cult of the Lamb\\',
    category: 'C',
    notes: '识别专用（未启用一键移植）。'
  },
  {
    id: 'atomic-heart',
    name: 'Atomic Heart (原子之心)',
    steamAppId: '668580',
    saveFilePattern: '*.dat',
    steamSaveRelPath: '%LOCALAPPDATA%\\AtomicHeart\\Saved\\SaveGames\\',
    category: 'C',
    notes: '识别专用（未启用一键移植）。Unreal Engine 存档（GVAS）。'
  },
  {
    id: 'remnant-2',
    name: 'Remnant II (遗迹2)',
    steamAppId: '1282100',
    saveFilePattern: '*.sav',
    steamSaveRelPath: '%USERPROFILE%\\Saved Games\\Remnant2\\',
    category: 'C',
    notes: '识别专用（未启用一键移植）。Unreal Engine 存档（GVAS）。'
  },
  {
    id: 'high-on-life',
    name: 'High On Life (嗨翻要塞)',
    steamAppId: '1583230',
    saveFilePattern: '*.sav',
    steamSaveRelPath: '%LOCALAPPDATA%\\HighOnLife\\Saved\\SaveGames\\',
    category: 'C',
    notes: '识别专用（未启用一键移植）。Unreal Engine 存档（GVAS）。'
  },
  {
    id: 'little-nightmares',
    name: 'Little Nightmares I (小小梦魇)',
    steamAppId: '424840',
    saveFilePattern: '*.sav',
    steamSaveRelPath: '%LOCALAPPDATA%\\LNE\\Saved\\SaveGames\\',
    category: 'C',
    notes: '识别专用（未启用一键移植）。Unreal Engine 存档（GVAS）。'
  },
  {
    id: 'little-nightmares-2',
    name: 'Little Nightmares II (小小梦魇2)',
    steamAppId: '860510',
    saveFilePattern: '*.sav',
    steamSaveRelPath: '%LOCALAPPDATA%\\LN2\\Saved\\SaveGames\\',
    category: 'C',
    notes: '识别专用（未启用一键移植）。Unreal Engine 存档（GVAS）。'
  }
];
