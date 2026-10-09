using System;
using System.IO;
using System.Linq;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Markup;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace XboxSteamSaveMigrator
{
    // ---------------------------------------------------------------------------
    // Data Structures
    // ---------------------------------------------------------------------------
    public class PresetGame
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string SteamRelPath { get; set; }
        public string XboxPkgPattern { get; set; }
        public string SteamAppId { get; set; }
        // P-07: 存档兼容性等级标注（如加密存档、需特殊转换的存档）
        public string CompatNote { get; set; }
    }

    public class SteamSaveRecord
    {
        public string GameTitle { get; set; }
        public string GameId { get; set; }
        public string SteamPath { get; set; }
        public string AccountName { get; set; }
        public DateTime LastModified { get; set; }
        public string LastModifiedText { get { return LastModified.ToString("yyyy-MM-dd HH:mm"); } }
        public long TotalSize { get; set; }
        public int FileCount { get; set; }
        public string SizeText { get { return string.Format("{0:F2} MB ({1}个文件)", TotalSize / (1024.0 * 1024.0), FileCount); } }
        public string MatchingXboxPath { get; set; }
    }

    public class XboxSaveRecord
    {
        public string GameTitle { get; set; }
        public string GameId { get; set; }
        public string XboxPath { get; set; }
        public DateTime LastModified { get; set; }
        public string LastModifiedText { get { return LastModified.ToString("yyyy-MM-dd HH:mm"); } }
        public int ContainerCount { get; set; }
        public string SizeText { get { return string.Format("{0}个 WGS 容器", ContainerCount); } }
        public string MatchingSteamPath { get; set; }
        // P-02: 多账号场景下当前绑定的 32-字符 Hex XUID 目录名
        public string XuidAccount { get; set; }
    }

    public class SaveContainerInfo
    {
        public string ContainerName { get; set; }
        public string CloudName { get; set; }
        public string GuidHex { get; set; }
        public long Size { get; set; }

        public SaveContainerInfo(string cName, string clName, string gHex, long sz)
        {
            ContainerName = cName;
            CloudName = clName;
            GuidHex = gHex;
            Size = sz;
        }
    }

    public class BackupItem
    {
        public string FileName { get; set; }
        public string FullPath { get; set; }
        public DateTime CreatedTime { get; set; }
        public string CreatedTimeText { get { return CreatedTime.ToString("yyyy-MM-dd HH:mm"); } }
        public long FileSize { get; set; }
        public string SizeText { get { return string.Format("{0:F2} MB", FileSize / (1024.0 * 1024.0)); } }
    }

    public class FileDetailItem
    {
        public string FileName { get; set; }
        public long FileSize { get; set; }
        public string SizeText { get { return string.Format("{0:F2} KB", FileSize / 1024.0); } }
        public string Md5Hash { get; set; }
    }

    public class InstalledSteamGameInfo
    {
        public string AppId { get; set; }
        public string GameTitle { get; set; }
        public string InstallDirName { get; set; }
        public string SteamAppsPath { get; set; }
    }

    // ---------------------------------------------------------------------------
    // WGS Engine & Comprehensive Database
    // ---------------------------------------------------------------------------
    public static class WgsEngine
    {
        private static readonly Dictionary<string, string> KnownTitles = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "stardewvalley", "《星露谷物语 (Stardew Valley)》" },
            { "concernedape.stardewvalleypc", "《星露谷物语 (Stardew Valley)》" },
            { "brotato", "《土豆兄弟 (Brotato)》" },
            { "blobfish.brotato", "《土豆兄弟 (Brotato)》" },
            { "hades", "《黑帝斯 (Hades)》" },
            { "supergiantgamesllc.hades", "《黑帝斯 (Hades)》" },
            { "hollowknightsilksong", "《空洞骑士：丝之歌 (Hollow Knight: Silksong)》" },
            { "silksong", "《空洞骑士：丝之歌 (Hollow Knight: Silksong)》" },
            { "teamcherry.hollowknightsilksong", "《空洞骑士：丝之歌 (Hollow Knight: Silksong)》" },
            { "teamcherry.silksong", "《空洞骑士：丝之歌 (Hollow Knight: Silksong)》" },
            { "hollowknight", "《空洞骑士 (Hollow Knight)》" },
            { "teamcherry.hollowknight", "《空洞骑士 (Hollow Knight)》" },
            { "terraria", "《泰拉瑞亚 (Terraria)》" },
            { "re-logic.terraria", "《泰拉瑞亚 (Terraria)》" },
            { "cyberpunk2077", "《赛博朋克 2077 (Cyberpunk 2077)》" },
            { "cdprojektred.cyberpunk2077", "《赛博朋克 2077 (Cyberpunk 2077)》" },
            { "77536c3fe941", "《死岛2 (Dead Island 2)》" },
            { "deepsilver.77536c3fe941", "《死岛2 (Dead Island 2)》" },
            { "poncle.vampirecrawlers", "《吸血鬼幸存者 (Vampire Survivors)》" },
            { "vampirecrawlers", "《吸血鬼幸存者 (Vampire Survivors)》" },
            { "poncle.vampiresurvivors", "《吸血鬼幸存者 (Vampire Survivors)》" },
            { "vampiresurvivors", "《吸血鬼幸存者 (Vampire Survivors)》" },
            { "doboroggames.clonedroneinthedangerzone", "《克隆机器人大乱斗 (Clone Drone in the Danger Zone)》" },
            { "clonedroneinthedangerzone", "《克隆机器人大乱斗 (Clone Drone in the Danger Zone)》" },
            { "clonedrone", "《克隆机器人大乱斗 (Clone Drone in the Danger Zone)》" },
            { "pocketpairinc.palworld", "《幻兽帕鲁 (Palworld)》" },
            { "palworld", "《幻兽帕鲁 (Palworld)》" },
            { "bethesdasoftworks.projectgold", "《星空 (Starfield)》" },
            { "projectgold", "《星空 (Starfield)》" },
            { "starfield", "《星空 (Starfield)》" },
            { "neowiz.liesofp", "《匹诺曹的谎言 (Lies of P)》" },
            { "liesofp", "《匹诺曹的谎言 (Lies of P)》" },
            { "coffeestainpublishing.deeprockgalactic", "《深岩银河 (Deep Rock Galactic)》" },
            { "deeprockgalactic", "《深岩银河 (Deep Rock Galactic)》" },
            { "microsoft.624f8b84b80", "《极限竞速：地平线5 (Forza Horizon 5)》" },
            { "624f8b84b80", "《极限竞速：地平线5 (Forza Horizon 5)》" },
            { "capcom.monsterhunterrise", "《怪物猎人：崛起 (Monster Hunter Rise)》" },
            { "monsterhunterrise", "《怪物猎人：崛起 (Monster Hunter Rise)》" },
            { "segaofamericainc.f0cda2eb77", "《女神异闻录5 皇家版 (Persona 5 Royal)》" },
            { "f0cda2eb77", "《女神异闻录5 皇家版 (Persona 5 Royal)》" },
            { "hellogames.nomanssky", "《无人深空 (No Man's Sky)》" },
            { "nomanssky", "《无人深空 (No Man's Sky)》" },
            { "microsoft.seaofthieves", "《盗贼之海 (Sea of Thieves)》" },
            { "seaofthieves", "《盗贼之海 (Sea of Thieves)》" },
            { "segaofamericainc.yakuzalikeadragon", "《如龙7：光与暗的去向 (Yakuza 7)》" },
            { "yakuzalikeadragon", "《如龙7：光与暗的去向 (Yakuza 7)》" },
            { "lnee", "《小小梦魇：增强版 (Little Nightmares: Enhanced Edition)》" },
            { "littlenightmares", "《小小梦魇：增强版 (Little Nightmares: Enhanced Edition)》" },
            { "littlenightmaresenhancededitio", "《小小梦魇：增强版 (Little Nightmares: Enhanced Edition)》" },
            { "namcobandaigamesinc.littlenightmaresenhancededitio", "《小小梦魇：增强版 (Little Nightmares: Enhanced Edition)》" },
            { "bandainamco.littlenightmares", "《小小梦魇：增强版 (Little Nightmares: Enhanced Edition)》" },
            { "microsoft.oriandthewillofthewisps", "《奥日与鬼火意志 (Ori and the Will of the Wisps)》" },
            { "oriandthewillofthewisps", "《奥日与鬼火意志 (Ori and the Will of the Wisps)》" },
            { "microsoft.maine", "《禁闭求生 (Grounded)》" },
            { "maine", "《禁闭求生 (Grounded)》" },
            { "squanchgamesinc.highonlife", "《嗨翻要塞 (High On Life)》" },
            { "highonlife", "《嗨翻要塞 (High On Life)》" },
            { "focusentertainment.atomicheart", "《原子之心 (Atomic Heart)》" },
            { "atomicheart", "《原子之心 (Atomic Heart)》" },
            { "gearboxpublishing.remnant2", "《遗迹2 (Remnant II)》" },
            { "remnant2", "《遗迹2 (Remnant II)》" },
            { "devolverdigital.cultofthelamb", "《灭绝之圣 / 羔羊教羽 (Cult of the Lamb)》" },
            { "cultofthelamb", "《灭绝之圣 / 羔羊教羽 (Cult of the Lamb)》" },
            { "unknownworlds.subnautica", "《深海迷航 (Subnautica)》" },
            { "subnautica", "《深海迷航 (Subnautica)》" },
            { "playdead.inside", "《内部 (Inside)》" },
            { "inside", "《内部 (Inside)》" }
        };

        public static readonly List<PresetGame> Presets = new List<PresetGame>
        {
            new PresetGame { Id = "stardew-valley", Name = "《星露谷物语 (Stardew Valley)》", SteamRelPath = @"%APPDATA%\StardewValley\Saves", XboxPkgPattern = "*StardewValley*", SteamAppId = "413150" },
            new PresetGame { Id = "brotato", Name = "《土豆兄弟 (Brotato)》", SteamRelPath = @"%APPDATA%\Brotato", XboxPkgPattern = "*Brotato*", SteamAppId = "1942280" },
            new PresetGame { Id = "hades", Name = "《黑帝斯 (Hades)》", SteamRelPath = @"%USERPROFILE%\Documents\Saved Games\Hades", XboxPkgPattern = "*Hades*", SteamAppId = "1145360" },
            new PresetGame { Id = "hollow-knight-silksong", Name = "《空洞骑士：丝之歌 (Hollow Knight: Silksong)》", SteamRelPath = @"%LOCALAPPDATALOW%\Team Cherry\Hollow Knight Silksong", XboxPkgPattern = "*Silksong*", SteamAppId = "1030300" },
            new PresetGame { Id = "hollow-knight", Name = "《空洞骑士 (Hollow Knight)》", SteamRelPath = @"%LOCALAPPDATALOW%\Team Cherry\Hollow Knight", XboxPkgPattern = "*HollowKnight*", SteamAppId = "367520" },
            new PresetGame { Id = "terraria", Name = "《泰拉瑞亚 (Terraria)》", SteamRelPath = @"%USERPROFILE%\Documents\My Games\Terraria", XboxPkgPattern = "*Terraria*", SteamAppId = "105600" },
            new PresetGame { Id = "cyberpunk-2077", Name = "《赛博朋克 2077 (Cyberpunk 2077)》", SteamRelPath = @"%USERPROFILE%\Saved Games\CD Projekt Red\Cyberpunk 2077", XboxPkgPattern = "*Cyberpunk2077*", SteamAppId = "1091500" },
            new PresetGame { Id = "dead-island-2", Name = "《死岛2 (Dead Island 2)》", SteamRelPath = @"%LOCALAPPDATA%\DeadIsland2\Saved\SaveGames", XboxPkgPattern = "*77536C3FE941*", SteamAppId = "913740" },
            new PresetGame { Id = "vampire-survivors", Name = "《吸血鬼幸存者 (Vampire Survivors)》", SteamRelPath = @"%APPDATA%\Vampire_Survivors\saves", XboxPkgPattern = "*Vampire*", SteamAppId = "1794680" },
            new PresetGame { Id = "clone-drone", Name = "《克隆机器人大乱斗 (Clone Drone)》", SteamRelPath = @"%LOCALAPPDATALOW%\Doborog Games\Clone Drone in the Danger Zone", XboxPkgPattern = "*CloneDrone*", SteamAppId = "597170" },
            new PresetGame { Id = "palworld", Name = "《幻兽帕鲁 (Palworld)》", SteamRelPath = @"%LOCALAPPDATA%\Pal\Saved\SaveGames", XboxPkgPattern = "*Palworld*", SteamAppId = "1623730", CompatNote = "⚠️ P-07 加密: sav 需特殊转换 (GVAS 结构)" },
            new PresetGame { Id = "starfield", Name = "《星空 (Starfield)》", SteamRelPath = @"%USERPROFILE%\Documents\My Games\Starfield\Saves", XboxPkgPattern = "*ProjectGold*", SteamAppId = "1716740" },
            new PresetGame { Id = "lies-of-p", Name = "《匹诺曹的谎言 (Lies of P)》", SteamRelPath = @"%APPDATA%\Neowiz\Lies of P\Saved\SaveGames", XboxPkgPattern = "*LiesofP*", SteamAppId = "1627720" },
            new PresetGame { Id = "deep-rock-galactic", Name = "《深岩银河 (Deep Rock Galactic)》", SteamRelPath = @"%LOCALAPPDATA%\FSD\Saved\SaveGames", XboxPkgPattern = "*DeepRockGalactic*", SteamAppId = "548430" },
            new PresetGame { Id = "forza-horizon-5", Name = "《极限竞速：地平线5 (Forza Horizon 5)》", SteamRelPath = @"%LOCALAPPDATA%\ForzaHorizon5\User_Data", XboxPkgPattern = "*624F8B84B80*", SteamAppId = "1551360" },
            new PresetGame { Id = "monster-hunter-rise", Name = "《怪物猎人：崛起 (Monster Hunter Rise)》", SteamRelPath = @"%LOCALAPPDATA%\CAPCOM\MonsterHunterRise", XboxPkgPattern = "*MonsterHunterRise*", SteamAppId = "1446780" },
            new PresetGame { Id = "persona-5-royal", Name = "《女神异闻录5 皇家版 (Persona 5 Royal)》", SteamRelPath = @"%APPDATA%\SEGA\P5R\Steam", XboxPkgPattern = "*F0CDA2EB77*", SteamAppId = "1687950" },
            new PresetGame { Id = "no-mans-sky", Name = "《无人深空 (No Man's Sky)》", SteamRelPath = @"%APPDATA%\HelloGames\NMS", XboxPkgPattern = "*NoMansSky*", SteamAppId = "275850" },
            new PresetGame { Id = "sea-of-thieves", Name = "《盗贼之海 (Sea of Thieves)》", SteamRelPath = @"%LOCALAPPDATA%\Athena\Saved\SaveGames", XboxPkgPattern = "*SeaofThieves*", SteamAppId = "1172620" },
            new PresetGame { Id = "yakuza-7", Name = "《如龙7：光与暗的去向 (Yakuza 7)》", SteamRelPath = @"%APPDATA%\SEGA\YakuzaLikeADragon", XboxPkgPattern = "*YakuzaLikeADragon*", SteamAppId = "1235140", CompatNote = "⚠️ P-07 加密: 自定义加密算法" },
            new PresetGame { Id = "little-nightmares", Name = "《小小梦魇：增强版 (Little Nightmares: Enhanced Edition)》", SteamRelPath = @"%LOCALAPPDATA%\LNEE\Saved\SaveGames", XboxPkgPattern = "*LittleNightmares*", SteamAppId = "2149010" },
            new PresetGame { Id = "ori-will-of-wisps", Name = "《奥日与鬼火意志 (Ori and the Will of the Wisps)》", SteamRelPath = @"%LOCALAPPDATALOW%\Moon Studios\OriAndTheWilloftheWisps", XboxPkgPattern = "*OriandtheWilloftheWisps*", SteamAppId = "1057090" },
            new PresetGame { Id = "grounded", Name = "《禁闭求生 (Grounded)》", SteamRelPath = @"%LOCALAPPDATA%\Maine\Saved\SaveGames", XboxPkgPattern = "*Maine*", SteamAppId = "962130" },
            new PresetGame { Id = "high-on-life", Name = "《嗨翻要塞 (High On Life)》", SteamRelPath = @"%LOCALAPPDATA%\Oregon\Saved\SaveGames", XboxPkgPattern = "*HighOnLife*", SteamAppId = "1583230" },
            new PresetGame { Id = "atomic-heart", Name = "《原子之心 (Atomic Heart)》", SteamRelPath = @"%LOCALAPPDATA%\AtomicHeart\Saved\SaveGames", XboxPkgPattern = "*AtomicHeart*", SteamAppId = "668580" },
            new PresetGame { Id = "remnant-2", Name = "《遗迹2 (Remnant II)》", SteamRelPath = @"%USERPROFILE%\Saved Games\Remnant2\Steam", XboxPkgPattern = "*Remnant2*", SteamAppId = "1282100" },
            new PresetGame { Id = "cult-of-the-lamb", Name = "《灭绝之圣 / 羔羊教羽 (Cult of the Lamb)》", SteamRelPath = @"%LOCALAPPDATALOW%\Massive Monster\Cult Of The Lamb\saves", XboxPkgPattern = "*CultOfTheLamb*", SteamAppId = "1313140" },
            new PresetGame { Id = "subnautica", Name = "《深海迷航 (Subnautica)》", SteamRelPath = @"%APPDATA%\LocalLow\Unknown Worlds\Subnautica\Subnautica\SavedGames", XboxPkgPattern = "*Subnautica*", SteamAppId = "264710" }
        };

        private static bool IsValidSaveFile(string filePath)
        {
            string fname = Path.GetFileName(filePath).ToLowerInvariant();
            if (fname == "remotecache.vdf" || fname == "steam_autocloud.vdf" || fname.EndsWith(".tmp") || fname.EndsWith(".bak.tmp"))
                return false;
            return true;
        }

        private static string NormalizePath(string p)
        {
            if (string.IsNullOrEmpty(p)) return "";
            try { return Path.GetFullPath(p).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).ToLowerInvariant(); }
            catch { return p.ToLowerInvariant(); }
        }

    public static class Win32LongPath
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CopyFileW(string lpExistingFileName, string lpNewFileName, bool bFailIfExists);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CreateDirectoryW(string lpPathName, IntPtr lpSecurityAttributes);

        public static string EnsureWin32LongPath(string path)
        {
            if (string.IsNullOrEmpty(path)) return path;
            string clean = path.Trim('"', '\'', ' ', '\t', '\r', '\n').Replace('/', '\\');
            if (clean.StartsWith(@"\\?\")) return clean;
            if (clean.Length >= 3 && char.IsLetter(clean[0]) && clean[1] == ':' && clean[2] == '\\')
            {
                return @"\\?\" + clean;
            }
            if (clean.StartsWith(@"\\"))
            {
                return @"\\?\UNC\" + clean.Substring(2);
            }
            return clean;
        }

        public static void SafeCreateDirectory(string dirPath)
        {
            string clean = EnsureWin32LongPath(dirPath);
            try { CreateDirectoryW(clean, IntPtr.Zero); } catch { }
            try { if (!Directory.Exists(dirPath)) Directory.CreateDirectory(dirPath); } catch { }
        }

        public static void SafeCopyFile(string srcPath, string destPath, bool overwrite)
        {
            string destDir = Path.GetDirectoryName(destPath);
            if (!string.IsNullOrEmpty(destDir) && !Directory.Exists(destDir))
            {
                try { Directory.CreateDirectory(destDir); } catch { }
            }

            string srcLong = EnsureWin32LongPath(srcPath);
            string destLong = EnsureWin32LongPath(destPath);

            if (!CopyFileW(srcLong, destLong, !overwrite))
            {
                try { File.Copy(srcPath, destPath, overwrite); } catch { }
            }
        }

        public static byte[] SafeReadAllBytes(string path)
        {
            string longPath = EnsureWin32LongPath(path);
            try
            {
                using (FileStream fs = new FileStream(longPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    byte[] data = new byte[fs.Length];
                    fs.Read(data, 0, data.Length);
                    return data;
                }
            }
            catch
            {
                return File.ReadAllBytes(path);
            }
        }

        public static void SafeWriteAllBytes(string path, byte[] bytes)
        {
            string longPath = EnsureWin32LongPath(path);
            try
            {
                using (FileStream fs = new FileStream(longPath, FileMode.Create, FileAccess.Write, FileShare.ReadWrite))
                {
                    fs.Write(bytes, 0, bytes.Length);
                }
            }
            catch
            {
                File.WriteAllBytes(path, bytes);
            }
        }
    }

        // 规范化路径清理：去除问号前缀与非法控制字符，解决 .NET Path.Combine / CheckInvalidPathChars 中的非法字符异常
        public static string NormalizeCleanPath(string path)
        {
            if (string.IsNullOrEmpty(path)) return "";
            string clean = path.Trim('"', '\'', ' ', '\t', '\r', '\n');

            if (clean.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
            {
                clean = @"\\" + clean.Substring(8);
            }
            else if (clean.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase))
            {
                clean = clean.Substring(4);
            }

            clean = clean.Replace('/', '\\');

            char[] invalidChars = Path.GetInvalidPathChars();
            foreach (char c in invalidChars)
            {
                if (clean.IndexOf(c) >= 0)
                {
                    clean = clean.Replace(c.ToString(), "");
                }
            }

            try
            {
                return Path.GetFullPath(clean);
            }
            catch
            {
                return clean;
            }
        }

        public static Dictionary<string, InstalledSteamGameInfo> DiscoverAllInstalledSteamGames()
        {
            Dictionary<string, InstalledSteamGameInfo> games = new Dictionary<string, InstalledSteamGameInfo>(StringComparer.OrdinalIgnoreCase);

            List<string> steamInstallPaths = DiscoverSteamInstallPaths();
            List<string> steamappsDirs = new List<string>();

            foreach (string sPath in steamInstallPaths)
            {
                string sa = Path.Combine(sPath, "steamapps");
                if (Directory.Exists(sa)) steamappsDirs.Add(sa);

                // Check libraryfolders.vdf
                string libVdf = Path.Combine(sa, "libraryfolders.vdf");
                if (!File.Exists(libVdf)) libVdf = Path.Combine(sPath, "config", "libraryfolders.vdf");
                if (File.Exists(libVdf))
                {
                    try
                    {
                        string content = File.ReadAllText(libVdf);
                        MatchCollection matches = Regex.Matches(content, @"""path""\s*""([^""]+)""", RegexOptions.IgnoreCase);
                        foreach (Match m in matches)
                        {
                            string p = m.Groups[1].Value.Replace(@"\\", @"\");
                            string extraSa = Path.Combine(p, "steamapps");
                            if (Directory.Exists(extraSa) && !steamappsDirs.Contains(extraSa))
                            {
                                steamappsDirs.Add(extraSa);
                            }
                        }
                    }
                    catch { }
                }
            }

            // Fallback: check all drive roots for SteamLibrary\steamapps
            try
            {
                foreach (DriveInfo drive in DriveInfo.GetDrives())
                {
                    if (drive.IsReady && drive.DriveType == DriveType.Fixed)
                    {
                        string dSa = Path.Combine(drive.Name, "SteamLibrary", "steamapps");
                        if (Directory.Exists(dSa) && !steamappsDirs.Contains(dSa))
                        {
                            steamappsDirs.Add(dSa);
                        }
                    }
                }
            }
            catch { }

            // Parse appmanifest_*.acf files in each steamapps folder
            foreach (string saDir in steamappsDirs)
            {
                try
                {
                    string[] manifests = Directory.GetFiles(saDir, "appmanifest_*.acf", SearchOption.TopDirectoryOnly);
                    foreach (string mf in manifests)
                    {
                        try
                        {
                            string content = File.ReadAllText(mf);
                            Match mAppId = Regex.Match(content, @"""appid""\s*""(\d+)""", RegexOptions.IgnoreCase);
                            Match mName = Regex.Match(content, @"""name""\s*""([^""]+)""", RegexOptions.IgnoreCase);
                            Match mDir = Regex.Match(content, @"""installdir""\s*""([^""]+)""", RegexOptions.IgnoreCase);

                            if (mAppId.Success && mName.Success)
                            {
                                string appId = mAppId.Groups[1].Value;
                                string rawName = mName.Groups[1].Value;
                                string installDir = mDir.Success ? mDir.Groups[1].Value : "";

                                // Skip SteamVR or Valve Steamworks common redistributables
                                if (appId == "228980" || appId == "250820" || rawName.StartsWith("Steamworks") || rawName.StartsWith("Proton"))
                                    continue;

                                string formattedTitle = "《" + rawName + "》";

                                games[appId] = new InstalledSteamGameInfo
                                {
                                    AppId = appId,
                                    GameTitle = formattedTitle,
                                    InstallDirName = installDir,
                                    SteamAppsPath = saDir
                                };
                            }
                        }
                        catch { }
                    }
                }
                catch { }
            }

            return games;
        }

        public static List<string> DiscoverSteamInstallPaths()
        {
            List<string> rawPaths = new List<string>();

            // Registry HKCU
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam"))
                {
                    if (key != null)
                    {
                        string val = key.GetValue("SteamPath") as string;
                        if (!string.IsNullOrEmpty(val) && Directory.Exists(val)) rawPaths.Add(val);
                    }
                }
            }
            catch { }

            // Registry HKLM
            try
            {
                using (RegistryKey key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\WOW6432Node\Valve\Steam"))
                {
                    if (key != null)
                    {
                        string val = key.GetValue("InstallPath") as string;
                        if (!string.IsNullOrEmpty(val) && Directory.Exists(val)) rawPaths.Add(val);
                    }
                }
            }
            catch { }

            // Fixed drives
            try
            {
                foreach (DriveInfo drive in DriveInfo.GetDrives())
                {
                    if (drive.IsReady && drive.DriveType == DriveType.Fixed)
                    {
                        rawPaths.Add(Path.Combine(drive.Name, "Steam"));
                        rawPaths.Add(Path.Combine(drive.Name, "Program Files (x86)", "Steam"));
                        rawPaths.Add(Path.Combine(drive.Name, "Program Files", "Steam"));
                        rawPaths.Add(Path.Combine(drive.Name, "Games", "Steam"));
                    }
                }
            }
            catch { }

            List<string> normalizedList = new List<string>();
            HashSet<string> seen = new HashSet<string>();

            foreach (string r in rawPaths)
            {
                if (Directory.Exists(r))
                {
                    string norm = NormalizePath(r);
                    if (!seen.Contains(norm))
                    {
                        seen.Add(norm);
                        normalizedList.Add(r);
                    }
                }
            }

            return normalizedList;
        }

        public static Dictionary<string, string> ParseSteamUsers(string steamDir)
        {
            Dictionary<string, string> userMap = new Dictionary<string, string>();
            string loginUsersFile = Path.Combine(steamDir, "config", "loginusers.vdf");
            if (!File.Exists(loginUsersFile)) return userMap;

            try
            {
                string content = File.ReadAllText(loginUsersFile);
                MatchCollection matches = Regex.Matches(content, @"""(\d{17})""\s*\{[^}]*?""PersonaName""\s*""([^""]+)""", RegexOptions.Singleline);
                foreach (Match m in matches)
                {
                    string steamId64Str = m.Groups[1].Value;
                    string personaName = m.Groups[2].Value;

                    long steamId64;
                    if (long.TryParse(steamId64Str, out steamId64))
                    {
                        long accountId32 = steamId64 - 76561197960265728L;
                        userMap[accountId32.ToString()] = personaName;
                    }
                }
            }
            catch { }
            return userMap;
        }

        public static string ResolvePath(string rawPath)
        {
            if (string.IsNullOrEmpty(rawPath)) return "";
            return Environment.ExpandEnvironmentVariables(rawPath);
        }

        public static string FindXboxWgs(string pkgPattern)
        {
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string packagesDir = Path.Combine(localAppData, "Packages");
            if (!Directory.Exists(packagesDir)) return null;

            string regexPattern = "^" + Regex.Escape(pkgPattern).Replace("\\*", ".*") + "$";
            Regex regex = new Regex(regexPattern, RegexOptions.IgnoreCase);

            try
            {
                foreach (string pkg in Directory.GetDirectories(packagesDir))
                {
                    string pkgName = Path.GetFileName(pkg);
                    if (regex.IsMatch(pkgName))
                    {
                        // Check SystemAppData/wgs
                        string wgsDir = Path.Combine(pkg, "SystemAppData", "wgs");
                        if (Directory.Exists(wgsDir))
                        {
                            // P-02: 多账号场景下遍历所有 XUID 目录，按 containers.index 最新修改时间锁定活跃账号
                            string newestSub = null;
                            DateTime newestTime = DateTime.MinValue;
                            foreach (string sub in Directory.GetDirectories(wgsDir))
                            {
                                string indexPath = Path.Combine(sub, "containers.index");
                                if (File.Exists(indexPath) && new FileInfo(indexPath).Length > 16)
                                {
                                    DateTime t = File.GetLastWriteTimeUtc(indexPath);
                                    if (t > newestTime) { newestTime = t; newestSub = sub; }
                                }
                            }
                            if (newestSub != null) return newestSub;
                        }

                        // Check LocalCache/Roaming for games like Stardew Valley Xbox version!
                        string localCacheSaves = Path.Combine(pkg, "LocalCache", "Roaming", "StardewValley", "Saves");
                        if (Directory.Exists(localCacheSaves))
                        {
                            return localCacheSaves;
                        }
                    }
                }
            }
            catch { }
            return null;
        }

        public static string ResolveFriendlyTitle(string pkgName)
        {
            string cleanBase = pkgName.Split('_')[0];

            string title;
            if (KnownTitles.TryGetValue(cleanBase, out title)) return title;
            if (KnownTitles.TryGetValue(pkgName, out title)) return title;

            string[] parts = cleanBase.Split('.');
            foreach (var part in parts)
            {
                if (KnownTitles.TryGetValue(part, out title)) return title;
            }

            string raw = parts[parts.Length - 1];
            string formatted = Regex.Replace(raw, @"([a-z])([A-Z])", "$1 $2");
            return "《" + formatted + "》";
        }

        public static List<string> LoadCustomPaths()
        {
            List<string> paths = new List<string>();
            string configPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "custom_paths.txt");
            if (File.Exists(configPath))
            {
                try
                {
                    string[] lines = File.ReadAllLines(configPath);
                    foreach (string line in lines)
                    {
                        string trimmed = line.Trim();
                        if (!string.IsNullOrEmpty(trimmed) && Directory.Exists(trimmed) && !paths.Contains(trimmed))
                        {
                            paths.Add(trimmed);
                        }
                    }
                }
                catch { }
            }
            return paths;
        }

        public static void SaveCustomPath(string newPath)
        {
            if (string.IsNullOrEmpty(newPath) || !Directory.Exists(newPath)) return;
            List<string> paths = LoadCustomPaths();
            if (!paths.Contains(newPath))
            {
                paths.Add(newPath);
                string configPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "custom_paths.txt");
                File.WriteAllLines(configPath, paths.ToArray());
            }
        }

        public static void ScanAllLocalSaves(out List<SteamSaveRecord> steamList, out List<XboxSaveRecord> xboxList)
        {
            steamList = new List<SteamSaveRecord>();
            xboxList = new List<XboxSaveRecord>();

            HashSet<string> seenSteamPaths = new HashSet<string>();
            HashSet<string> seenSteamUserGameKeys = new HashSet<string>();
            HashSet<string> seenXboxPaths = new HashSet<string>();
            HashSet<string> seenXboxGameKeys = new HashSet<string>();

            List<string> steamInstallPaths = DiscoverSteamInstallPaths();

            // 1. Synchronize All Installed Steam Games from VDF/ACF Manifests & UserData
            Dictionary<string, InstalledSteamGameInfo> installedGames = DiscoverAllInstalledSteamGames();

            foreach (string sDir in steamInstallPaths)
            {
                string userDataDir = Path.Combine(sDir, "userdata");
                if (Directory.Exists(userDataDir))
                {
                    Dictionary<string, string> userMap = ParseSteamUsers(sDir);
                    try
                    {
                        string[] userDirs = Directory.GetDirectories(userDataDir);
                        foreach (string uDir in userDirs)
                        {
                            string accountIdStr = Path.GetFileName(uDir);
                            if (Regex.IsMatch(accountIdStr, @"^\d+$"))
                            {
                                string personaName;
                                if (!userMap.TryGetValue(accountIdStr, out personaName))
                                {
                                    personaName = "Steam 账号 #" + accountIdStr;
                                }

                                foreach (var kv in installedGames)
                                {
                                    string appId = kv.Key;
                                    InstalledSteamGameInfo gInfo = kv.Value;

                                    string appSavePath = Path.Combine(uDir, appId, "remote");
                                    if (!Directory.Exists(appSavePath))
                                    {
                                        appSavePath = Path.Combine(uDir, appId);
                                    }

                                    if (Directory.Exists(appSavePath))
                                    {
                                        string normPath = NormalizePath(appSavePath);
                                        string userGameKey = accountIdStr + "_" + appId;

                                        if (!seenSteamPaths.Contains(normPath) && !seenSteamUserGameKeys.Contains(userGameKey))
                                        {
                                            long totalSz = 0;
                                            int fCount = 0;
                                            try
                                            {
                                                string[] files = Directory.GetFiles(appSavePath, "*", SearchOption.AllDirectories);
                                                foreach (string f in files)
                                                {
                                                    if (IsValidSaveFile(f))
                                                    {
                                                        long sz = new FileInfo(f).Length;
                                                        if (sz > 0)
                                                        {
                                                            totalSz += sz;
                                                            fCount++;
                                                        }
                                                    }
                                                }
                                            }
                                            catch { }

                                            if (fCount > 0 && totalSz >= 512)
                                            {
                                                seenSteamPaths.Add(normPath);
                                                seenSteamUserGameKeys.Add(userGameKey);
                                                string displayTitle = string.Format("{0} (用户: {1})", gInfo.GameTitle, personaName);

                                                steamList.Add(new SteamSaveRecord
                                                {
                                                    GameTitle = displayTitle,
                                                    GameId = appId,
                                                    SteamPath = appSavePath,
                                                    AccountName = personaName,
                                                    LastModified = Directory.GetLastWriteTime(appSavePath),
                                                    TotalSize = totalSz,
                                                    FileCount = fCount,
                                                    MatchingXboxPath = ""
                                                });
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    catch { }
                }
            }

            // 2. Presets AppData / Documents Scan
            foreach (var preset in Presets)
            {
                string sPath = ResolvePath(preset.SteamRelPath);
                bool sExists = false;
                long totalSz = 0;
                int fCount = 0;

                if (Directory.Exists(sPath))
                {
                    // Prioritize numerical Steam Account ID subfolder with largest size over default empty user folder
                    string bestSubDir = sPath;
                    long maxDirSize = 0;
                    try
                    {
                        foreach (string sub in Directory.GetDirectories(sPath))
                        {
                            string subName = Path.GetFileName(sub);
                            if (Regex.IsMatch(subName, @"^\d+$"))
                            {
                                long subSz = 0;
                                foreach (string f in Directory.GetFiles(sub, "*", SearchOption.AllDirectories))
                                {
                                    try { subSz += new FileInfo(f).Length; } catch { }
                                }
                                if (subSz > maxDirSize)
                                {
                                    maxDirSize = subSz;
                                    bestSubDir = sub;
                                }
                            }
                        }
                    }
                    catch { }

                    if (maxDirSize > 0) sPath = bestSubDir;

                    try
                    {
                        string[] files = Directory.GetFiles(sPath, "*", SearchOption.AllDirectories);
                        foreach (string f in files)
                        {
                            if (IsValidSaveFile(f))
                            {
                                long sz = new FileInfo(f).Length;
                                if (sz > 0)
                                {
                                    totalSz += sz;
                                    fCount++;
                                }
                            }
                        }
                    }
                    catch { }

                    if (fCount > 0 && totalSz >= 512)
                    {
                        sExists = true;
                    }
                }

                string xPath = FindXboxWgs(preset.XboxPkgPattern);
                bool xExists = !string.IsNullOrEmpty(xPath);

                if (sExists)
                {
                    string normSPath = NormalizePath(sPath);
                    string globalGameKey = "local_" + preset.Id;

                    if (!seenSteamPaths.Contains(normSPath) && !seenSteamUserGameKeys.Contains(globalGameKey))
                    {
                        seenSteamPaths.Add(normSPath);
                        seenSteamUserGameKeys.Add(globalGameKey);
                        DateTime mtime = Directory.GetLastWriteTime(sPath);
                        steamList.Add(new SteamSaveRecord
                        {
                            GameTitle = preset.Name,
                            GameId = preset.Id,
                            SteamPath = sPath,
                            AccountName = "本地 AppData/文档",
                            LastModified = mtime,
                            TotalSize = totalSz,
                            FileCount = fCount,
                            MatchingXboxPath = xExists ? xPath : ""
                        });
                    }
                }

                if (xExists)
                {
                    string normXPath = NormalizePath(xPath);
                    if (!seenXboxPaths.Contains(normXPath) && !seenXboxGameKeys.Contains(preset.Id))
                    {
                        seenXboxPaths.Add(normXPath);
                        seenXboxGameKeys.Add(preset.Id);
                        DateTime mtime = Directory.Exists(xPath) ? Directory.GetLastWriteTime(xPath) : DateTime.Now;
                        string idxP = Path.Combine(xPath, "containers.index");
                        if (File.Exists(idxP)) mtime = File.GetLastWriteTime(idxP);

                        int cCount = 0;
                        try { cCount = Directory.GetDirectories(xPath).Length; } catch { }

                        xboxList.Add(new XboxSaveRecord
                        {
                            GameTitle = preset.Name,
                            GameId = preset.Id,
                            XboxPath = xPath,
                            LastModified = mtime,
                            ContainerCount = cCount,
                            MatchingSteamPath = sExists ? sPath : "",
                            XuidAccount = Path.GetFileName(xPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
                        });
                    }
                }
            }

            // 3. Packages Deep Scan for Xbox WGS & Xbox Games
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string packagesDir = Path.Combine(localAppData, "Packages");
            if (Directory.Exists(packagesDir))
            {
                try
                {
                    foreach (string pkgDir in Directory.GetDirectories(packagesDir))
                    {
                        string pkgName = Path.GetFileName(pkgDir);
                        string cleanBase = pkgName.Split('_')[0].ToLower();

                        string wgsDir = Path.Combine(pkgDir, "SystemAppData", "wgs");
                        if (Directory.Exists(wgsDir))
                        {
                            // P-02: 多账号场景下按 containers.index 最新修改时间锁定活跃 XUID
                            string bestSub = null;
                            DateTime bestTime = DateTime.MinValue;
                            foreach (string sub in Directory.GetDirectories(wgsDir))
                            {
                                string idxP = Path.Combine(sub, "containers.index");
                                if (File.Exists(idxP) && new FileInfo(idxP).Length > 16)
                                {
                                    DateTime t = File.GetLastWriteTimeUtc(idxP);
                                    if (t > bestTime) { bestTime = t; bestSub = sub; }
                                }
                            }
                            if (bestSub != null)
                            {
                                string idxP = Path.Combine(bestSub, "containers.index");
                                string normSub = NormalizePath(bestSub);
                                if (!seenXboxPaths.Contains(normSub) && !seenXboxGameKeys.Contains(cleanBase))
                                {
                                    seenXboxPaths.Add(normSub);
                                    seenXboxGameKeys.Add(cleanBase);
                                    string friendly = ResolveFriendlyTitle(pkgName);
                                    DateTime mtime = File.GetLastWriteTime(idxP);
                                    int cCount = Directory.GetDirectories(bestSub).Length;

                                    xboxList.Add(new XboxSaveRecord
                                    {
                                        GameTitle = friendly,
                                        GameId = cleanBase,
                                        XboxPath = bestSub,
                                        LastModified = mtime,
                                        ContainerCount = cCount,
                                        MatchingSteamPath = "",
                                        XuidAccount = Path.GetFileName(bestSub)
                                    });
                                }
                            }
                        }
                    }
                }
                catch { }
            }

            // 4. Custom Scanned Paths Integration
            List<string> customPaths = LoadCustomPaths();
            foreach (string cPath in customPaths)
            {
                string folderName = Path.GetFileName(cPath.TrimEnd(Path.DirectorySeparatorChar));
                string indexPath = Path.Combine(cPath, "containers.index");

                if (File.Exists(indexPath))
                {
                    string normC = NormalizePath(cPath);
                    if (!seenXboxPaths.Contains(normC))
                    {
                        seenXboxPaths.Add(normC);
                        xboxList.Add(new XboxSaveRecord
                        {
                            GameTitle = string.Format("《自定义 Xbox 存档 ({0})》", folderName),
                            GameId = "custom_xbox_" + folderName,
                            XboxPath = cPath,
                            LastModified = File.GetLastWriteTime(indexPath),
                            ContainerCount = Directory.GetDirectories(cPath).Length,
                            MatchingSteamPath = ""
                        });
                    }
                }
                else
                {
                    long totalSz = 0;
                    int fCount = 0;
                    try
                    {
                        string[] files = Directory.GetFiles(cPath, "*", SearchOption.AllDirectories);
                        foreach (string f in files)
                        {
                            if (IsValidSaveFile(f))
                            {
                                long sz = new FileInfo(f).Length;
                                if (sz > 0)
                                {
                                    totalSz += sz;
                                    fCount++;
                                }
                            }
                        }
                    }
                    catch { }

                    if (fCount > 0 && totalSz >= 512)
                    {
                        string normC = NormalizePath(cPath);
                        if (!seenSteamPaths.Contains(normC))
                        {
                            seenSteamPaths.Add(normC);
                            steamList.Add(new SteamSaveRecord
                            {
                                GameTitle = string.Format("《自定义 Steam 存档 ({0})》", folderName),
                                GameId = "custom_steam_" + folderName,
                                SteamPath = cPath,
                                AccountName = "自定义导入",
                                LastModified = Directory.GetLastWriteTime(cPath),
                                TotalSize = totalSz,
                                FileCount = fCount,
                                MatchingXboxPath = ""
                            });
                        }
                    }
                }
            }

            // 5. Dual-Side Match Linking & Dual-End Tagging
            foreach (var s in steamList)
            {
                foreach (var x in xboxList)
                {
                    bool isMatch = false;

                    if (!string.IsNullOrEmpty(s.GameId) && !string.IsNullOrEmpty(x.GameId) &&
                        (s.GameId.Equals(x.GameId, StringComparison.OrdinalIgnoreCase) ||
                         s.GameId.Contains(x.GameId) || x.GameId.Contains(s.GameId)))
                    {
                        isMatch = true;
                    }
                    else if (!string.IsNullOrEmpty(s.GameTitle) && !string.IsNullOrEmpty(x.GameTitle))
                    {
                        string cleanSTitle = Regex.Replace(s.GameTitle, @"[\(《].*?[\)》]", "").Trim();
                        string cleanXTitle = Regex.Replace(x.GameTitle, @"[\(《].*?[\)》]", "").Trim();
                        if (!string.IsNullOrEmpty(cleanSTitle) && cleanSTitle.Equals(cleanXTitle, StringComparison.OrdinalIgnoreCase))
                        {
                            isMatch = true;
                        }
                    }

                    if (isMatch)
                    {
                        s.MatchingXboxPath = x.XboxPath;
                        x.MatchingSteamPath = s.SteamPath;

                        if (!s.GameTitle.StartsWith("⚡"))
                        {
                            s.GameTitle = "⚡ [双端同款] " + s.GameTitle;
                        }
                        if (!x.GameTitle.StartsWith("⚡"))
                        {
                            x.GameTitle = "⚡ [双端同款] " + x.GameTitle;
                        }
                    }
                }
            }

            // 7. Active Process Detection for Currently Running Games
            HashSet<string> runningGameIds = GetRunningGameIds();
            foreach (var s in steamList)
            {
                bool isRunning = false;
                foreach (string rId in runningGameIds)
                {
                    if (s.GameId.IndexOf(rId, StringComparison.OrdinalIgnoreCase) >= 0 ||
                        s.GameTitle.IndexOf(rId, StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        isRunning = true;
                        break;
                    }
                }
                if (isRunning && !s.GameTitle.Contains("正在运行"))
                {
                    s.GameTitle = "🎮 [正在运行中] " + s.GameTitle;
                }
            }

            foreach (var x in xboxList)
            {
                bool isRunning = false;
                foreach (string rId in runningGameIds)
                {
                    if (x.GameId.IndexOf(rId, StringComparison.OrdinalIgnoreCase) >= 0 ||
                        x.GameTitle.IndexOf(rId, StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        isRunning = true;
                        break;
                    }
                }
                if (isRunning && !x.GameTitle.Contains("正在运行"))
                {
                    x.GameTitle = "🎮 [正在运行中] " + x.GameTitle;
                }
            }
        }

        public static HashSet<string> GetRunningGameIds()
        {
            HashSet<string> runningGameIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                Process[] processes = Process.GetProcesses();
                foreach (Process p in processes)
                {
                    try
                    {
                        string pName = p.ProcessName.ToLowerInvariant();
                        if (pName.Contains("stardew")) runningGameIds.Add("stardew-valley");
                        else if (pName.Contains("brotato")) runningGameIds.Add("brotato");
                        else if (pName.Contains("hades")) runningGameIds.Add("hades");
                        else if (pName.Contains("silksong")) runningGameIds.Add("hollow-knight-silksong");
                        else if (pName.Contains("hollowknight") || pName.Contains("hollow_knight")) runningGameIds.Add("hollow-knight");
                        else if (pName.Contains("terraria")) runningGameIds.Add("terraria");
                        else if (pName.Contains("cyberpunk")) runningGameIds.Add("cyberpunk-2077");
                        else if (pName.Contains("deadisland")) runningGameIds.Add("dead-island-2");
                        else if (pName.Contains("vampire")) runningGameIds.Add("vampire-survivors");
                        else if (pName.Contains("clonedrone")) runningGameIds.Add("clone-drone");
                        else if (pName.Contains("palworld") || pName.Contains("pal-win64")) runningGameIds.Add("palworld");
                        else if (pName.Contains("starfield")) runningGameIds.Add("starfield");
                        else if (pName.Contains("liesofp")) runningGameIds.Add("lies-of-p");
                        else if (pName.Contains("fsd") || pName.Contains("deeprock")) runningGameIds.Add("deep-rock-galactic");
                        else if (pName.Contains("forzahorizon5")) runningGameIds.Add("forza-horizon-5");
                        else if (pName.Contains("monsterhunterrise")) runningGameIds.Add("monster-hunter-rise");
                        else if (pName.Contains("p5r") || pName.Contains("persona5")) runningGameIds.Add("persona-5-royal");
                        else if (pName.Contains("nomanssky") || pName.Contains("nms")) runningGameIds.Add("no-mans-sky");
                        else if (pName.Contains("seaofthieves")) runningGameIds.Add("sea-of-thieves");
                        else if (pName.Contains("yakuzalikeadragon")) runningGameIds.Add("yakuza-7");
                    }
                    catch { }
                }
            }
            catch { }
            return runningGameIds;
        }

        public static bool IsGameProcessRunning(string gameId)
        {
            if (string.IsNullOrEmpty(gameId)) return false;
            HashSet<string> running = GetRunningGameIds();
            foreach (string id in running)
            {
                if (gameId.IndexOf(id, StringComparison.OrdinalIgnoreCase) >= 0 ||
                    id.IndexOf(gameId, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return true;
                }
            }
            return false;
        }

        public static string ProbeSingleFileSignature(string filePath)
        {
            if (!File.Exists(filePath)) return null;

            string fileName = Path.GetFileName(filePath).ToLowerInvariant();

            // 1. Filename Signature Probe
            if (fileName == "user1.dat" || fileName.StartsWith("user1.dat") ||
                fileName == "user2.dat" || fileName.StartsWith("user2.dat") ||
                fileName == "user3.dat" || fileName.StartsWith("user3.dat") ||
                fileName == "shared.dat" || fileName.StartsWith("shared.dat"))
            {
                return "《空洞骑士：丝之歌 (Hollow Knight: Silksong)》";
            }

            if (fileName.Contains("lnee") || fileName.Contains("littlenightmares") || fileName.Contains("lneesaveslot"))
            {
                return "《小小梦魇：增强版 (Little Nightmares: Enhanced Edition)》";
            }

            if (fileName.Contains("ln2") || fileName.Contains("littlenightmares2") || fileName.Contains("ln2saveslot"))
            {
                return "《小小梦魇2 (Little Nightmares II)》";
            }

            if (fileName == "save.json" || fileName.StartsWith("save_v") || fileName.Contains("brotato"))
            {
                return "《土豆兄弟 (Brotato)》";
            }

            if (fileName == "savegameinfo" || fileName.EndsWith("_sv"))
            {
                return "《星露谷物语 (Stardew Valley)》";
            }

            if (fileName == "level.sav" || fileName == "localdata.sav")
            {
                return "《幻兽帕鲁 (Palworld)》";
            }

            if (fileName.StartsWith("profile") && (fileName.EndsWith(".sav") || fileName.EndsWith(".sjson")))
            {
                return "《黑帝斯 (Hades)》";
            }

            if (fileName.EndsWith(".plr") || fileName.EndsWith(".wld"))
            {
                return "《泰拉瑞亚 (Terraria)》";
            }

            if (fileName.Contains("savethumb") || fileName.Contains("metadata.9.json"))
            {
                return "《赛博朋克 2077 (Cyberpunk 2077)》";
            }

            if (fileName.StartsWith("save_slot") || fileName.Contains("liesofp"))
            {
                return "《匹诺曹的谎言 (Lies of P)》";
            }

            if (fileName.StartsWith("slot00") || fileName == "gameinfo.json")
            {
                return "《深海迷航 (Subnautica)》";
            }

            if (fileName.Contains("oriwispsave"))
            {
                return "《奥日与鬼火意志 (Ori and the Will of the Wisps)》";
            }

            if (fileName.Contains("cultofthelamb") || fileName.StartsWith("meta_slot_"))
            {
                return "《灭绝之圣 / 羔羊教羽 (Cult of the Lamb)》";
            }

            // 2. Deep Content Header Inspection Probe (First 4KB)
            try
            {
                long fileLen = new FileInfo(filePath).Length;
                if (fileLen > 0)
                {
                    byte[] buf = new byte[(int)Math.Min(4096, fileLen)];
                    using (FileStream fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                    {
                        fs.Read(buf, 0, buf.Length);
                    }

                    // Check Unreal Engine Magic Header: "GVAS"
                    if (buf.Length >= 4 && buf[0] == 'G' && buf[1] == 'V' && buf[2] == 'A' && buf[3] == 'S')
                    {
                        string asciiContent = Encoding.ASCII.GetString(buf).ToLowerInvariant();
                        if (asciiContent.Contains("lnee") || asciiContent.Contains("littlenightmares")) return "《小小梦魇：增强版 (Little Nightmares: Enhanced Edition)》";
                        if (asciiContent.Contains("ln2") || asciiContent.Contains("littlenightmares2")) return "《小小梦魇2 (Little Nightmares II)》";
                        if (asciiContent.Contains("palworld") || asciiContent.Contains("pal")) return "《幻兽帕鲁 (Palworld)》";
                        if (asciiContent.Contains("deadisland")) return "《死岛2 (Dead Island 2)》";
                        if (asciiContent.Contains("grounded") || asciiContent.Contains("maine")) return "《禁闭求生 (Grounded)》";
                        if (asciiContent.Contains("liesofp") || asciiContent.Contains("p3")) return "《匹诺曹的谎言 (Lies of P)》";
                        if (asciiContent.Contains("deeprock") || asciiContent.Contains("fsd")) return "《深岩银河 (Deep Rock Galactic)》";
                        if (asciiContent.Contains("starfield") || asciiContent.Contains("sfs")) return "《星空 (Starfield)》";
                        if (asciiContent.Contains("atomi") || asciiContent.Contains("atomicheart")) return "《原子之心 (Atomic Heart)》";
                        if (asciiContent.Contains("remnant")) return "《遗迹2 (Remnant II)》";
                        if (asciiContent.Contains("highonlife") || asciiContent.Contains("oregon")) return "《嗨翻要塞 (High On Life)》";
                    }

                    // Check Text / JSON / XML Content
                    string textContent = Encoding.UTF8.GetString(buf).ToLowerInvariant();
                    if (textContent.Contains("brotato") || textContent.Contains("mod_loader_cache") || textContent.Contains("run_v3"))
                    {
                        return "《土豆兄弟 (Brotato)》";
                    }
                    if (textContent.Contains("silksong") || textContent.Contains("team cherry") || textContent.Contains("hollowknight"))
                    {
                        return "《空洞骑士：丝之歌 (Hollow Knight: Silksong)》";
                    }
                    if (textContent.Contains("stardew") || textContent.Contains("<farmer>") || textContent.Contains("savegameinfo"))
                    {
                        return "《星露谷物语 (Stardew Valley)》";
                    }
                    if (textContent.Contains("vampiresurvivors") || textContent.Contains("vampire_survivors"))
                    {
                        return "《吸血鬼幸存者 (Vampire Survivors)》";
                    }
                    if (textContent.Contains("hades") || textContent.Contains("zagreus"))
                    {
                        return "《黑帝斯 (Hades)》";
                    }
                }
            }
            catch { }

            return null;
        }

        public static string IdentifyDroppedGameTitle(string path)
        {
            if (string.IsNullOrEmpty(path)) return "《自定义存档》";

            // 1. Single File Signature Probe
            if (File.Exists(path))
            {
                string singleResult = ProbeSingleFileSignature(path);
                if (!string.IsNullOrEmpty(singleResult)) return singleResult;
            }

            // 2. Folder Directory File Probe
            if (Directory.Exists(path))
            {
                try
                {
                    string[] files = Directory.GetFiles(path, "*", SearchOption.AllDirectories);
                    foreach (string f in files)
                    {
                        string probed = ProbeSingleFileSignature(f);
                        if (!string.IsNullOrEmpty(probed)) return probed;
                    }
                }
                catch { }
            }

            string normPath = path.ToLowerInvariant();
            string name = Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)).ToLowerInvariant();

            // 3. Check full path string for explicit game keywords
            if (normPath.Contains("silksong")) return "《空洞骑士：丝之歌 (Hollow Knight: Silksong)》";
            if (normPath.Contains("stardewvalley") || normPath.Contains("stardew valley")) return "《星露谷物语 (Stardew Valley)》";
            if (normPath.Contains("brotato")) return "《土豆兄弟 (Brotato)》";
            if (normPath.Contains("deadisland2")) return "《死岛2 (Dead Island 2)》";
            if (normPath.Contains("palworld") || normPath.Contains(@"\pal\")) return "《幻兽帕鲁 (Palworld)》";
            if (normPath.Contains("cyberpunk")) return "《赛博朋克 2077 (Cyberpunk 2077)》";
            if (normPath.Contains("terraria")) return "《泰拉瑞亚 (Terraria)》";
            if (normPath.Contains("hades")) return "《黑帝斯 (Hades)》";
            if (normPath.Contains("hollow knight") || normPath.Contains("hollowknight")) return "《空洞骑士 (Hollow Knight)》";

            // 4. Exact matching in KnownTitles
            string title;
            if (KnownTitles.TryGetValue(name, out title)) return title;

            // 5. Strict matching against Presets ID
            if (name.Length >= 4)
            {
                foreach (var p in Presets)
                {
                    if (name.Equals(p.Id, StringComparison.OrdinalIgnoreCase) ||
                        name.Contains(p.Id) || p.Id.Contains(name))
                    {
                        return p.Name;
                    }
                }
            }

            return "《" + Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)) + "》";
        }

        public static List<FileDetailItem> InspectFolderFiles(string folderPath)
        {
            List<FileDetailItem> list = new List<FileDetailItem>();
            string cleanFolderPath = NormalizeCleanPath(folderPath);
            if (!Directory.Exists(cleanFolderPath)) return list;

            try
            {
                string[] files = Directory.GetFiles(cleanFolderPath, "*", SearchOption.TopDirectoryOnly);
                foreach (string f in files)
                {
                    FileInfo fi = new FileInfo(NormalizeCleanPath(f));
                    string md5 = ComputeFileMd5(f);
                    list.Add(new FileDetailItem
                    {
                        FileName = fi.Name,
                        FileSize = fi.Length,
                        Md5Hash = md5
                    });
                }
            }
            catch { }
            return list;
        }

        public static string ComputeFileMd5(string filePath)
        {
            string cleanPath = NormalizeCleanPath(filePath);
            if (!File.Exists(cleanPath)) return "";
            try
            {
                using (MD5 md5 = MD5.Create())
                using (FileStream stream = File.Open(cleanPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    byte[] hash = md5.ComputeHash(stream);
                    return BitConverter.ToString(hash).Replace("-", "").ToLower();
                }
            }
            catch { return "N/A"; }
        }

    public class ContainerFileInfo
    {
        public string ContainerName { get; set; }
        public string CloudFileName { get; set; }
        public string ContainerGuidHex { get; set; }
        public string BlobHex { get; set; }
        public string ContainerDir { get; set; }
        public string BlobPath { get; set; }
    }

        public static List<ContainerFileInfo> ParseContainerHeader(string containerDir, string containerName, string containerGuidHex)
        {
            List<ContainerFileInfo> list = new List<ContainerFileInfo>();
            containerDir = NormalizeCleanPath(containerDir);
            string headerFile = Path.Combine(containerDir, "container.1");
            if (!File.Exists(NormalizeCleanPath(headerFile)))
            {
                try
                {
                    string[] containerFiles = Directory.GetFiles(containerDir, "container.*");
                    if (containerFiles.Length > 0) headerFile = containerFiles[0];
                }
                catch { }
            }

            if (!File.Exists(headerFile))
            {
                try
                {
                    foreach (string f in Directory.GetFiles(containerDir))
                    {
                        string fname = Path.GetFileName(f);
                        if (Regex.IsMatch(fname, @"^[0-9A-Fa-f]{32}$"))
                        {
                            list.Add(new ContainerFileInfo
                            {
                                ContainerName = containerName,
                                CloudFileName = string.IsNullOrEmpty(containerName) ? "save.json" : (containerName + ".sav"),
                                ContainerGuidHex = containerGuidHex,
                                BlobHex = fname,
                                ContainerDir = containerDir,
                                BlobPath = f
                            });
                        }
                    }
                }
                catch { }
                return list;
            }

            try
            {
                byte[] buf = File.ReadAllBytes(headerFile);
                if (buf.Length >= 8)
                {
                    int version = BitConverter.ToInt32(buf, 0);
                    int fileCount = BitConverter.ToInt32(buf, 4);

                    // Mode A: Fixed Struct Entry Header (Silksong, Subnautica, Team Cherry 160/168 byte structs)
                    if (fileCount > 0 && (buf.Length == 8 + fileCount * 160 || buf.Length == 8 + fileCount * 168))
                    {
                        int entrySize = (buf.Length - 8) / fileCount;
                        for (int i = 0; i < fileCount; i++)
                        {
                            int offset = 8 + i * entrySize;
                            string rawName = Encoding.Unicode.GetString(buf, offset, 128).TrimEnd('\0');
                            byte[] guidBytes = new byte[16];
                            Array.Copy(buf, offset + 128, guidBytes, 0, 16);
                            string blobHex = new Guid(guidBytes).ToString("N").ToUpper();

                            string fullBlobPath = Path.Combine(containerDir, blobHex);
                            if (File.Exists(fullBlobPath))
                            {
                                list.Add(new ContainerFileInfo
                                {
                                    ContainerName = containerName,
                                    CloudFileName = rawName,
                                    ContainerGuidHex = containerGuidHex,
                                    BlobHex = blobHex,
                                    ContainerDir = containerDir,
                                    BlobPath = fullBlobPath
                                });
                            }
                        }
                    }
                    else
                    {
                        // Mode B: Dynamic String Length Entry Header (Brotato, Stardew Valley, Palworld)
                        using (MemoryStream ms = new MemoryStream(buf))
                        using (BinaryReader br = new BinaryReader(ms, Encoding.Unicode))
                        {
                            ms.Seek(8, SeekOrigin.Begin);
                            for (int i = 0; i < fileCount && ms.Position < ms.Length; i++)
                            {
                                int strCharLen = br.ReadInt32();
                                string cloudFileName = "";
                                if (strCharLen > 0 && strCharLen * 2 <= ms.Length - ms.Position)
                                {
                                    cloudFileName = Encoding.Unicode.GetString(br.ReadBytes(strCharLen * 2)).TrimEnd('\0');
                                }

                                if (ms.Position + 16 <= ms.Length)
                                {
                                    byte[] blobGuidBytes = br.ReadBytes(16);
                                    string blobHex = new Guid(blobGuidBytes).ToString("N").ToUpper();

                                    string fullBlobPath = Path.Combine(containerDir, blobHex);
                                    if (File.Exists(fullBlobPath))
                                    {
                                        list.Add(new ContainerFileInfo
                                        {
                                            ContainerName = containerName,
                                            CloudFileName = string.IsNullOrEmpty(cloudFileName) ? (string.IsNullOrEmpty(containerName) ? "save.json" : containerName) : cloudFileName,
                                            ContainerGuidHex = containerGuidHex,
                                            BlobHex = blobHex,
                                            ContainerDir = containerDir,
                                            BlobPath = fullBlobPath
                                        });
                                    }
                                }

                                try { ms.Seek(16, SeekOrigin.Current); } catch { }
                            }
                        }
                    }
                }
            }
            catch { }

            if (list.Count == 0)
            {
                try
                {
                    foreach (string f in Directory.GetFiles(containerDir))
                    {
                        string fname = Path.GetFileName(f);
                        if (Regex.IsMatch(fname, @"^[0-9A-Fa-f]{32}$"))
                        {
                            list.Add(new ContainerFileInfo
                            {
                                ContainerName = containerName,
                                CloudFileName = string.IsNullOrEmpty(containerName) ? "save.json" : (containerName + ".sav"),
                                ContainerGuidHex = containerGuidHex,
                                BlobHex = fname,
                                ContainerDir = containerDir,
                                BlobPath = f
                            });
                        }
                    }
                }
                catch { }
            }

            return list;
        }

        public static List<ContainerFileInfo> ParseAllWgsContainers(string wgsFolder)
        {
            List<ContainerFileInfo> allFiles = new List<ContainerFileInfo>();
            wgsFolder = NormalizeCleanPath(wgsFolder);
            if (!Directory.Exists(wgsFolder)) return allFiles;

            string indexPath = Path.Combine(wgsFolder, "containers.index");
            if (File.Exists(indexPath))
            {
                try
                {
                    byte[] buf = File.ReadAllBytes(indexPath);
                    using (MemoryStream ms = new MemoryStream(buf))
                    using (BinaryReader br = new BinaryReader(ms, Encoding.Unicode))
                    {
                        int version = br.ReadInt32();
                        int containerCount = br.ReadInt32();

                        int pkgCharLen = br.ReadInt32();
                        if (pkgCharLen > 0 && pkgCharLen * 2 <= ms.Length - ms.Position)
                        {
                            ms.Seek(pkgCharLen * 2, SeekOrigin.Current);
                        }

                        for (int i = 0; i < containerCount && ms.Position < ms.Length; i++)
                        {
                            int nameLen = br.ReadInt32();
                            string containerName = (nameLen > 0 && nameLen * 2 <= ms.Length - ms.Position) ? Encoding.Unicode.GetString(br.ReadBytes(nameLen * 2)).TrimEnd('\0') : "";

                            int cloudLen = br.ReadInt32();
                            string cloudName = (cloudLen > 0 && cloudLen * 2 <= ms.Length - ms.Position) ? Encoding.Unicode.GetString(br.ReadBytes(cloudLen * 2)).TrimEnd('\0') : "";

                            if (ms.Position + 17 <= ms.Length)
                            {
                                byte seq = br.ReadByte();
                                byte[] guidBytes = br.ReadBytes(16);
                                string guidHex = new Guid(guidBytes).ToString("N").ToUpper();

                                try { ms.Seek(16, SeekOrigin.Current); } catch { }

                                string containerDir = Path.Combine(wgsFolder, guidHex);
                                if (Directory.Exists(containerDir))
                                {
                                    allFiles.AddRange(ParseContainerHeader(containerDir, containerName, guidHex));
                                }
                            }
                        }
                    }
                }
                catch { }
            }

            if (allFiles.Count == 0)
            {
                try
                {
                    string[] subDirs = Directory.GetDirectories(wgsFolder);
                    foreach (string subDir in subDirs)
                    {
                        string folderName = Path.GetFileName(subDir);
                        if (Regex.IsMatch(folderName, @"^[0-9A-Fa-f]{32}$"))
                        {
                            allFiles.AddRange(ParseContainerHeader(subDir, "", folderName));
                        }
                    }
                }
                catch { }
            }

            return allFiles;
        }

        public static string ExtractWgsFolder(string wgsFolder, string outputFolder)
        {
            wgsFolder = NormalizeCleanPath(wgsFolder);
            outputFolder = NormalizeCleanPath(outputFolder);
            Directory.CreateDirectory(outputFolder);
            int count = 0;

            List<ContainerFileInfo> containerFiles = ParseAllWgsContainers(wgsFolder);
            foreach (var cInfo in containerFiles)
            {
                if (File.Exists(cInfo.BlobPath))
                {
                    string outFileName = cInfo.CloudFileName;
                    if (string.IsNullOrEmpty(outFileName)) outFileName = "save.json";

                    string destFile = Path.Combine(outputFolder, outFileName);
                    Win32LongPath.SafeCopyFile(cInfo.BlobPath, destFile, true);
                    count++;
                }
            }

            return string.Format("🎉 [脱壳成功] 已将 Xbox WGS 容器中的 {0} 个存档文件精准转译并解包至 Steam 目录:\n{1}", count, outputFolder);
        }

        public static void WriteBlobWithPaddingAndTimestamps(string srcFilePath, string destBlobPath, string containerDir)
        {
            string srcClean = NormalizeCleanPath(srcFilePath);
            string destClean = NormalizeCleanPath(destBlobPath);

            byte[] srcBytes = Win32LongPath.SafeReadAllBytes(srcClean);

            // Check if destBlobPath exists and has a fixed allocation size (e.g. 1MB for Brotato / GDK blobs)
            long originalLen = 0;
            if (File.Exists(destClean))
            {
                try
                {
                    originalLen = new FileInfo(destClean).Length;
                    File.SetAttributes(destClean, FileAttributes.Normal);
                }
                catch { }
            }

            byte[] finalBytes = srcBytes;
            if (originalLen > srcBytes.Length && originalLen >= 1024)
            {
                // Pad with trailing zero bytes up to exact original binary blob length to prevent 0xc0000005 out-of-bound crashes
                finalBytes = new byte[originalLen];
                Array.Copy(srcBytes, 0, finalBytes, 0, srcBytes.Length);
            }

            Win32LongPath.SafeWriteAllBytes(destClean, finalBytes);

            DateTime nowUtc = DateTime.UtcNow;
            try
            {
                File.SetLastWriteTimeUtc(destClean, nowUtc);
                File.SetLastWriteTime(destClean, DateTime.Now);
            }
            catch { }

            if (!string.IsNullOrEmpty(containerDir) && Directory.Exists(containerDir))
            {
                try
                {
                    string containerClean = NormalizeCleanPath(containerDir);
                    File.SetLastWriteTimeUtc(containerClean, nowUtc);
                    foreach (string h in Directory.GetFiles(containerClean, "container.*"))
                    {
                        try { File.SetLastWriteTimeUtc(h, nowUtc); } catch { }
                    }
                }
                catch { }
            }
        }

        public static string PackFilesToWgs(string[] filePaths, string targetWgsFolder, string packageName)
        {
            if (string.IsNullOrEmpty(packageName)) packageName = "GamePassSave";
            targetWgsFolder = NormalizeCleanPath(targetWgsFolder);
            try { Directory.CreateDirectory(targetWgsFolder); } catch { }
            if (filePaths == null || filePaths.Length == 0) throw new Exception("未选择任何有效的 Steam 存档文件！");

            List<string> sourceSaveFiles = new List<string>();
            foreach (string f in filePaths)
            {
                string cleanF = NormalizeCleanPath(f);
                if (File.Exists(cleanF) && IsValidSaveFile(cleanF) && new FileInfo(cleanF).Length > 0)
                {
                    sourceSaveFiles.Add(cleanF);
                }
            }
            if (sourceSaveFiles.Count == 0) throw new Exception("所选目录中未找到任何有效的 Steam 存档文件！");

            if (sourceSaveFiles.Any(sf => Path.GetFileName(sf).Equals("save_v2.json", StringComparison.OrdinalIgnoreCase)))
            {
                // Brotato: save_v2.json contains string identifiers required by Xbox 1.154.0.0, avoiding v3 integer hash crashes
                sourceSaveFiles.RemoveAll(sf => Path.GetFileName(sf).StartsWith("save_v3", StringComparison.OrdinalIgnoreCase) || Path.GetFileName(sf).Equals("save.json", StringComparison.OrdinalIgnoreCase));
            }

            // Strategy 1: In-Place Blob Overwrite matched by CloudFileName or Container GUID
            List<ContainerFileInfo> existingWgsFiles = ParseAllWgsContainers(targetWgsFolder);
            if (existingWgsFiles.Count > 0)
            {
                int overwrittenCount = 0;
                foreach (string srcFile in sourceSaveFiles)
                {
                    string srcName = Path.GetFileName(srcFile).ToLowerInvariant();

                    List<ContainerFileInfo> targets = new List<ContainerFileInfo>();
                    foreach (var wgs in existingWgsFiles)
                    {
                        string wgsLower = wgs.CloudFileName.ToLowerInvariant();
                        if (wgsLower.Equals(srcName, StringComparison.OrdinalIgnoreCase) ||
                            wgsLower.Contains(Path.GetFileNameWithoutExtension(srcName)) ||
                            srcName.Contains(Path.GetFileNameWithoutExtension(wgsLower)))
                        {
                            targets.Add(wgs);
                        }
                        else if (srcName.StartsWith("user1") && wgsLower.StartsWith("user1") && !wgsLower.Contains("restore"))
                        {
                            targets.Add(wgs);
                        }
                        else if (srcName.StartsWith("user2") && wgsLower.StartsWith("user2") && !wgsLower.Contains("restore"))
                        {
                            targets.Add(wgs);
                        }
                        else if (srcName.StartsWith("user3") && wgsLower.StartsWith("user3") && !wgsLower.Contains("restore"))
                        {
                            targets.Add(wgs);
                        }
                        else if ((srcName.Contains("save_v") || srcName == "save.json") &&
                                 (wgsLower.Contains("mod_user_profiles") || wgsLower.Equals("default")))
                        {
                            targets.Add(wgs);
                        }
                    }

                    if (targets.Count == 0)
                    {
                        foreach (var wgs in existingWgsFiles)
                        {
                            string wgsLower = wgs.CloudFileName.ToLowerInvariant();
                            if (!wgsLower.Contains("cache") && !wgsLower.Contains("log") && !wgsLower.Contains("shared") && !wgsLower.Contains("restore") && !wgsLower.EndsWith(".bak"))
                            {
                                targets.Add(wgs);
                            }
                        }
                    }

                    if (targets.Count == 0) targets = existingWgsFiles;

                    foreach (var targetWgs in targets)
                    {
                        if (targetWgs != null && File.Exists(targetWgs.BlobPath))
                        {
                            WriteBlobWithPaddingAndTimestamps(srcFile, targetWgs.BlobPath, targetWgs.ContainerDir);
                            overwrittenCount++;
                        }
                    }
                }

                string indexPath = Path.Combine(targetWgsFolder, "containers.index");
                if (File.Exists(indexPath))
                {
                    try
                    {
                        File.SetLastWriteTimeUtc(indexPath, DateTime.UtcNow);
                        File.SetLastWriteTimeUtc(targetWgsFolder, DateTime.UtcNow);
                    }
                    catch { }
                }

                if (overwrittenCount > 0)
                {
                    return string.Format("🎉 [在位镜像脱壳注入成功] 已成功将 Steam 存档注入写入 Xbox 绑定的 {0} 个 32-字符 Hex WGS 镜像 Blob 中！\n内部映射索引与 UTC 时间戳已同步，重新打开 Xbox 游戏即可生效！", overwrittenCount);
                }
            }

            // Strategy 2: Fallback to Creating WGS Container & Index Structure
            List<SaveContainerInfo> containers = new List<SaveContainerInfo>();
            foreach (string file in sourceSaveFiles)
            {
                string fileName = Path.GetFileName(file);
                string containerGuid = Guid.NewGuid().ToString("N").ToUpper();
                string blobGuid = Guid.NewGuid().ToString("N").ToUpper();

                string containerDir = Path.Combine(targetWgsFolder, containerGuid);
                Win32LongPath.SafeCreateDirectory(containerDir);

                Win32LongPath.SafeCopyFile(file, Path.Combine(containerDir, blobGuid), true);
                DateTime nowUtc = DateTime.UtcNow;
                try { File.SetLastWriteTimeUtc(Path.Combine(containerDir, blobGuid), nowUtc); } catch { }

                using (FileStream fs = new FileStream(Path.Combine(containerDir, "container.1"), FileMode.Create))
                using (BinaryWriter bw = new BinaryWriter(fs, Encoding.Unicode))
                {
                    bw.Write(4);
                    bw.Write(1);
                    byte[] nameBytes = Encoding.Unicode.GetBytes(fileName);
                    bw.Write(nameBytes.Length / 2);
                    bw.Write(nameBytes);
                    byte[] blobGuidBytes = HexToBytes(blobGuid);
                    bw.Write(blobGuidBytes);
                }
                try { File.SetLastWriteTimeUtc(Path.Combine(containerDir, "container.1"), nowUtc); } catch { }

                long size = new FileInfo(file).Length;
                containers.Add(new SaveContainerInfo(Path.GetFileNameWithoutExtension(fileName), fileName, containerGuid, size));
            }

            using (FileStream fs = new FileStream(Path.Combine(targetWgsFolder, "containers.index"), FileMode.Create))
            using (BinaryWriter bw = new BinaryWriter(fs, Encoding.Unicode))
            {
                bw.Write(4);
                bw.Write(containers.Count);
                byte[] pkgBytes = Encoding.Unicode.GetBytes(packageName);
                bw.Write(pkgBytes.Length / 2);
                bw.Write(pkgBytes);

                foreach (var c in containers)
                {
                    byte[] nameBytes = Encoding.Unicode.GetBytes(c.ContainerName);
                    bw.Write(nameBytes.Length / 2);
                    bw.Write(nameBytes);

                    byte[] cloudBytes = Encoding.Unicode.GetBytes(c.CloudName);
                    bw.Write(cloudBytes.Length / 2);
                    bw.Write(cloudBytes);

                    bw.Write((byte)1);
                    bw.Write(HexToBytes(c.GuidHex));
                    bw.Write((long)(DateTime.UtcNow.ToFileTimeUtc()));
                    bw.Write((int)c.Size);
                }
            }

            return string.Format("成功将 {0} 个 Steam 存档文件打包构建并写入 Xbox WGS 目录:\n{1}", containers.Count, targetWgsFolder);
        }

        public static string PackFolderToWgs(string inputFolder, string targetWgsFolder, string packageName)
        {
            if (!Directory.Exists(inputFolder)) throw new DirectoryNotFoundException("输入目录不存在: " + inputFolder);
            targetWgsFolder = NormalizeCleanPath(targetWgsFolder);
            string[] files = Directory.GetFiles(inputFolder, "*", SearchOption.AllDirectories);
            if (files.Length == 0) throw new Exception("Steam 存档目录中未找到任何文件！");
            return PackFilesToWgs(files, targetWgsFolder, packageName);
        }

        public static string CreateZipBackup(string sourceFolder, string gameId, string platform)
        {
            try
            {
                sourceFolder = NormalizeCleanPath(sourceFolder);
                if (string.IsNullOrEmpty(sourceFolder) || !Directory.Exists(sourceFolder)) return null;

                string backupDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Backups");
                Directory.CreateDirectory(backupDir);

                try
                {
                    string root = Path.GetPathRoot(backupDir);
                    DriveInfo drive = new DriveInfo(root);
                    if (drive.IsReady && drive.AvailableFreeSpace < 64L * 1024 * 1024)
                    {
                        throw new IOException(string.Format("磁盘空间不足：{0} 剩余可用空间仅 {1:F0} MB，已中断备份与移植以保护原存档。", root, drive.AvailableFreeSpace / (1024.0 * 1024.0)));
                    }
                }
                catch (IOException) { throw; }
                catch { }

                string zipName = string.Format("backup_{0}_{1}_{2:yyyyMMdd_HHmmss}.zip", gameId, platform, DateTime.Now);
                string zipPath = Path.Combine(backupDir, zipName);

                using (ZipArchive archive = ZipFile.Open(zipPath, ZipArchiveMode.Create))
                {
                    string[] files = Directory.GetFiles(sourceFolder, "*", SearchOption.AllDirectories);
                    string srcPrefix = sourceFolder.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
                    foreach (string f in files)
                    {
                        try
                        {
                            string rel = f.StartsWith(srcPrefix, StringComparison.OrdinalIgnoreCase)
                                ? f.Substring(srcPrefix.Length)
                                : Path.GetFileName(f);
                            if (!string.IsNullOrEmpty(rel))
                            {
                                string fLong = Win32LongPath.EnsureWin32LongPath(f);
                                archive.CreateEntryFromFile(fLong, rel, CompressionLevel.Optimal);
                            }
                        }
                        catch { }
                    }
                }
                return zipPath;
            }
            catch
            {
                // Failure to create ZIP backup must NEVER block main save migration!
                return null;
            }
        }

        public static List<BackupItem> ListBackups()
        {
            List<BackupItem> list = new List<BackupItem>();
            string backupDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Backups");
            if (!Directory.Exists(backupDir)) return list;

            try
            {
                foreach (string f in Directory.GetFiles(backupDir, "*.zip"))
                {
                    FileInfo fi = new FileInfo(f);
                    list.Add(new BackupItem
                    {
                        FileName = fi.Name,
                        FullPath = fi.FullName,
                        CreatedTime = fi.CreationTime,
                        FileSize = fi.Length
                    });
                }
            }
            catch { }
            return list;
        }

        private static byte[] HexToBytes(string hex)
        {
            byte[] bytes = new byte[hex.Length / 2];
            for (int i = 0; i < bytes.Length; i++)
            {
                bytes[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
            }
            return bytes;
        }
    }

    // ---------------------------------------------------------------------------
    // Streamlined Modern XAML WPF Desktop Application Window (Tabbed & Drag-First)
    // ---------------------------------------------------------------------------
    public class MainWindow
    {
        private static List<SteamSaveRecord> steamSaves = new List<SteamSaveRecord>();
        private static List<XboxSaveRecord> xboxSaves = new List<XboxSaveRecord>();

        private static Grid panelMainTab;
        private static Grid panelScanTab;
        private static Border panelBackupTab;

        private static Button btnTabMain;
        private static Button btnTabScan;
        private static Button btnTabBackups;

        private static TextBlock txtMainLoadedStatus;
        private static Button btnTargetSteam;
        private static Button btnTargetXbox;
        private static ComboBox cbMainTargetGame;
        private static Button btnStartMainMigrate;

        private static bool isMainTargetXbox = true;
        private static string currentMainLoadedPath = "";

        private static ListView lvSteam;
        private static ListView lvXbox;
        private static ListView lvFileDetails;

        private static Button btnSteamToXbox;
        private static Button btnXboxToSteam;

        private static TextBlock txtDetailTitle;
        private static TextBlock txtDetailPath;
        private static TextBlock txtStatus;

        private static Border dropOverlay;
        private static TextBlock txtDropTitle;
        private static TextBlock txtDropSub;
        private static Button btnDropToXbox;
        private static ComboBox cbDropTargetGame;
        private static Button btnDropToSteam;
        private static Button btnDropCancel;

        private static string[] currentDroppedPaths = null;

        private static SteamSaveRecord selectedSteam;
        private static XboxSaveRecord selectedXbox;

        private static Application app = new Application();

        public static void RunApp()
        {
            string xaml = @"
                <Window xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation'
                        xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml'
                        Title='Steam ↔ Xbox PC 游戏存档移植控制台 Pro' Width='1300' Height='880'
                        MinWidth='1000' MinHeight='700'
                        WindowStartupLocation='CenterScreen' AllowDrop='True' UseLayoutRounding='True'
                        FontFamily='Segoe UI, Microsoft YaHei'>
                    <Window.Background>
                        <LinearGradientBrush StartPoint='0,0' EndPoint='0,1'>
                            <GradientStop Color='#060A14' Offset='0'/>
                            <GradientStop Color='#0B1120' Offset='1'/>
                        </LinearGradientBrush>
                    </Window.Background>
                    <Window.Resources>
                        <Style TargetType='GridViewColumnHeader'>
                            <Setter Property='Background' Value='Transparent'/>
                            <Setter Property='Foreground' Value='#475569'/>
                            <Setter Property='FontWeight' Value='Bold'/>
                            <Setter Property='FontSize' Value='11'/>
                            <Setter Property='Padding' Value='12,8'/>
                            <Setter Property='BorderThickness' Value='0,0,0,1'/>
                            <Setter Property='BorderBrush' Value='#1E293B'/>
                            <Setter Property='Template'>
                                <Setter.Value>
                                    <ControlTemplate TargetType='GridViewColumnHeader'>
                                        <Border Background='{TemplateBinding Background}' BorderBrush='{TemplateBinding BorderBrush}' BorderThickness='{TemplateBinding BorderThickness}' Padding='{TemplateBinding Padding}'>
                                            <ContentPresenter HorizontalAlignment='Left' VerticalAlignment='Center'/>
                                        </Border>
                                    </ControlTemplate>
                                </Setter.Value>
                            </Setter>
                        </Style>
                        <Style TargetType='ListViewItem'>
                            <Setter Property='Background' Value='Transparent'/>
                            <Setter Property='Foreground' Value='#CBD5E1'/>
                            <Setter Property='Margin' Value='0,2,0,2'/>
                            <Setter Property='Padding' Value='12,10'/>
                            <Setter Property='Template'>
                                <Setter.Value>
                                    <ControlTemplate TargetType='ListViewItem'>
                                        <Border x:Name='itemBorder' CornerRadius='8' Background='{TemplateBinding Background}' BorderBrush='Transparent' BorderThickness='1' Padding='{TemplateBinding Padding}'>
                                            <GridViewRowPresenter VerticalAlignment='Center'/>
                                        </Border>
                                        <ControlTemplate.Triggers>
                                            <Trigger Property='IsMouseOver' Value='True'>
                                                <Setter TargetName='itemBorder' Property='Background' Value='#0F1E35'/>
                                                <Setter TargetName='itemBorder' Property='BorderBrush' Value='#1E3A5F'/>
                                            </Trigger>
                                            <Trigger Property='IsSelected' Value='True'>
                                                <Setter TargetName='itemBorder' Property='Background' Value='#0E2238'/>
                                                <Setter TargetName='itemBorder' Property='BorderBrush' Value='#1E4976'/>
                                                <Setter Property='Foreground' Value='#F0F9FF'/>
                                            </Trigger>
                                        </ControlTemplate.Triggers>
                                    </ControlTemplate>
                                </Setter.Value>
                            </Setter>
                        </Style>
                        <Style TargetType='Button'>
                            <Setter Property='Background' Value='#1E293B'/>
                            <Setter Property='Foreground' Value='#94A3B8'/>
                            <Setter Property='FontSize' Value='12.5'/>
                            <Setter Property='FontWeight' Value='SemiBold'/>
                            <Setter Property='Padding' Value='14,9'/>
                            <Setter Property='Template'>
                                <Setter.Value>
                                    <ControlTemplate TargetType='Button'>
                                        <Border x:Name='btnBase' CornerRadius='9' Background='{TemplateBinding Background}' Padding='{TemplateBinding Padding}' BorderBrush='#334155' BorderThickness='1'>
                                            <ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/>
                                        </Border>
                                        <ControlTemplate.Triggers>
                                            <Trigger Property='IsMouseOver' Value='True'>
                                                <Setter TargetName='btnBase' Property='Background' Value='#334155'/>
                                                <Setter TargetName='btnBase' Property='BorderBrush' Value='#475569'/>
                                            </Trigger>
                                            <Trigger Property='IsEnabled' Value='False'>
                                                <Setter Property='Opacity' Value='0.3'/>
                                            </Trigger>
                                        </ControlTemplate.Triggers>
                                    </ControlTemplate>
                                </Setter.Value>
                            </Setter>
                        </Style>
                        <Style x:Key='SteamBtn' TargetType='Button'>
                            <Setter Property='Foreground' Value='White'/>
                            <Setter Property='FontSize' Value='13'/>
                            <Setter Property='FontWeight' Value='Bold'/>
                            <Setter Property='Padding' Value='16,12'/>
                            <Setter Property='Template'>
                                <Setter.Value>
                                    <ControlTemplate TargetType='Button'>
                                        <Border x:Name='sbBase' CornerRadius='10' Padding='{TemplateBinding Padding}' BorderThickness='1' BorderBrush='#38BDF8'>
                                            <Border.Background>
                                                <LinearGradientBrush StartPoint='0,0' EndPoint='1,0'>
                                                    <GradientStop Color='#0369A1' Offset='0'/>
                                                    <GradientStop Color='#0284C7' Offset='0.5'/>
                                                    <GradientStop Color='#0EA5E9' Offset='1'/>
                                                </LinearGradientBrush>
                                            </Border.Background>
                                            <ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/>
                                        </Border>
                                        <ControlTemplate.Triggers>
                                            <Trigger Property='IsMouseOver' Value='True'>
                                                <Setter TargetName='sbBase' Property='Opacity' Value='0.85'/>
                                            </Trigger>
                                            <Trigger Property='IsEnabled' Value='False'>
                                                <Setter Property='Opacity' Value='0.25'/>
                                            </Trigger>
                                        </ControlTemplate.Triggers>
                                    </ControlTemplate>
                                </Setter.Value>
                            </Setter>
                        </Style>
                        <Style x:Key='XboxBtn' TargetType='Button'>
                            <Setter Property='Foreground' Value='White'/>
                            <Setter Property='FontSize' Value='13'/>
                            <Setter Property='FontWeight' Value='Bold'/>
                            <Setter Property='Padding' Value='16,12'/>
                            <Setter Property='Template'>
                                <Setter.Value>
                                    <ControlTemplate TargetType='Button'>
                                        <Border x:Name='xbBase' CornerRadius='10' Padding='{TemplateBinding Padding}' BorderThickness='1' BorderBrush='#34D399'>
                                            <Border.Background>
                                                <LinearGradientBrush StartPoint='0,0' EndPoint='1,0'>
                                                    <GradientStop Color='#065F46' Offset='0'/>
                                                    <GradientStop Color='#059669' Offset='0.5'/>
                                                    <GradientStop Color='#10B981' Offset='1'/>
                                                </LinearGradientBrush>
                                            </Border.Background>
                                            <ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/>
                                        </Border>
                                        <ControlTemplate.Triggers>
                                            <Trigger Property='IsMouseOver' Value='True'>
                                                <Setter TargetName='xbBase' Property='Opacity' Value='0.85'/>
                                            </Trigger>
                                            <Trigger Property='IsEnabled' Value='False'>
                                                <Setter Property='Opacity' Value='0.25'/>
                                            </Trigger>
                                        </ControlTemplate.Triggers>
                                    </ControlTemplate>
                                </Setter.Value>
                            </Setter>
                        </Style>
                        <Style x:Key='PurpleBtn' TargetType='Button'>
                            <Setter Property='Foreground' Value='White'/>
                            <Setter Property='FontSize' Value='14'/>
                            <Setter Property='FontWeight' Value='Bold'/>
                            <Setter Property='Padding' Value='20,14'/>
                            <Setter Property='Template'>
                                <Setter.Value>
                                    <ControlTemplate TargetType='Button'>
                                        <Border x:Name='pbBase' CornerRadius='12' Padding='{TemplateBinding Padding}' BorderThickness='1.5' BorderBrush='#A78BFA'>
                                            <Border.Background>
                                                <LinearGradientBrush StartPoint='0,0' EndPoint='1,0'>
                                                    <GradientStop Color='#6D28D9' Offset='0'/>
                                                    <GradientStop Color='#7C3AED' Offset='0.5'/>
                                                    <GradientStop Color='#8B5CF6' Offset='1'/>
                                                </LinearGradientBrush>
                                            </Border.Background>
                                            <ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/>
                                        </Border>
                                        <ControlTemplate.Triggers>
                                            <Trigger Property='IsMouseOver' Value='True'>
                                                <Setter TargetName='pbBase' Property='Opacity' Value='0.9'/>
                                            </Trigger>
                                            <Trigger Property='IsEnabled' Value='False'>
                                                <Setter Property='Opacity' Value='0.3'/>
                                            </Trigger>
                                        </ControlTemplate.Triggers>
                                    </ControlTemplate>
                                </Setter.Value>
                            </Setter>
                        </Style>
                        <Style x:Key='GhostBtn' TargetType='Button'>
                            <Setter Property='Foreground' Value='#64748B'/>
                            <Setter Property='FontSize' Value='12'/>
                            <Setter Property='Padding' Value='12,8'/>
                            <Setter Property='Template'>
                                <Setter.Value>
                                    <ControlTemplate TargetType='Button'>
                                        <Border x:Name='ghBase' CornerRadius='8' Background='Transparent' Padding='{TemplateBinding Padding}' BorderBrush='#1E293B' BorderThickness='1'>
                                            <ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/>
                                        </Border>
                                        <ControlTemplate.Triggers>
                                            <Trigger Property='IsMouseOver' Value='True'>
                                                <Setter TargetName='ghBase' Property='Background' Value='#0F172A'/>
                                                <Setter TargetName='ghBase' Property='BorderBrush' Value='#334155'/>
                                            </Trigger>
                                            <Trigger Property='IsEnabled' Value='False'>
                                                <Setter Property='Opacity' Value='0.3'/>
                                            </Trigger>
                                        </ControlTemplate.Triggers>
                                    </ControlTemplate>
                                </Setter.Value>
                            </Setter>
                        </Style>
                    </Window.Resources>

                    <Grid>
                        <Grid.RowDefinitions>
                            <RowDefinition Height='96'/>
                            <RowDefinition Height='*'/>
                            <RowDefinition Height='155'/>
                            <RowDefinition Height='40'/>
                        </Grid.RowDefinitions>

                        <!-- HEADER -->
                        <Border Grid.Row='0' BorderBrush='#0F1F3A' BorderThickness='0,0,0,1'>
                            <Border.Background>
                                <LinearGradientBrush StartPoint='0,0' EndPoint='1,0'>
                                    <GradientStop Color='#08142A' Offset='0'/>
                                    <GradientStop Color='#0D1C38' Offset='0.5'/>
                                    <GradientStop Color='#08142A' Offset='1'/>
                                </LinearGradientBrush>
                            </Border.Background>
                            <Grid Margin='24,0'>
                                <Grid.ColumnDefinitions>
                                    <ColumnDefinition Width='*'/>
                                    <ColumnDefinition Width='Auto'/>
                                </Grid.ColumnDefinitions>
                                <StackPanel VerticalAlignment='Center'>
                                    <StackPanel Orientation='Horizontal'>
                                        <TextBlock Text='Steam' FontSize='21' FontWeight='Bold' Foreground='#38BDF8' VerticalAlignment='Center'/>
                                        <TextBlock Text='  ↔  ' FontSize='21' FontWeight='Light' Foreground='#1E293B' VerticalAlignment='Center'/>
                                        <TextBlock Text='Xbox' FontSize='21' FontWeight='Bold' Foreground='#34D399' VerticalAlignment='Center'/>
                                        <TextBlock Text='  游戏存档移植控制台' FontSize='21' FontWeight='Bold' Foreground='#E2E8F0' VerticalAlignment='Center'/>
                                        <Border Background='#0C2340' BorderBrush='#1E4976' BorderThickness='1' CornerRadius='5' Padding='8,3' Margin='14,0,0,2' VerticalAlignment='Center'>
                                            <TextBlock Text='PRO' FontSize='10' FontWeight='Bold' Foreground='#38BDF8'/>
                                        </Border>
                                    </StackPanel>
                                    <TextBlock Text='极简拖拽单向移植 · 自动绑定已安装游戏 · 工业级在位脱壳注入' FontSize='12' Foreground='#334155' Margin='0,6,0,0'/>
                                </StackPanel>
                                <StackPanel Grid.Column='1' Orientation='Horizontal' VerticalAlignment='Center'>
                                    <Button x:Name='btnTabMain' Foreground='#A78BFA' Margin='0,0,8,0' Cursor='Hand'>
                                        <StackPanel Orientation='Horizontal'>
                                            <TextBlock Text='⚡' FontSize='13' VerticalAlignment='Center'/>
                                            <TextBlock Text='  极速拖拽移植 (主功能)' VerticalAlignment='Center' Margin='2,0,0,0'/>
                                        </StackPanel>
                                    </Button>
                                    <Button x:Name='btnTabScan' Foreground='#38BDF8' Margin='0,0,8,0' Cursor='Hand'>
                                        <StackPanel Orientation='Horizontal'>
                                            <TextBlock Text='🎮' FontSize='13' VerticalAlignment='Center'/>
                                            <TextBlock Text='  双端同款全盘检测' VerticalAlignment='Center' Margin='2,0,0,0'/>
                                        </StackPanel>
                                    </Button>
                                    <Button x:Name='btnTabBackups' Foreground='#34D399' Cursor='Hand'>
                                        <StackPanel Orientation='Horizontal'>
                                            <TextBlock Text='📦' FontSize='13' VerticalAlignment='Center'/>
                                            <TextBlock Text='  ZIP 备份库' VerticalAlignment='Center' Margin='2,0,0,0'/>
                                        </StackPanel>
                                    </Button>
                                </StackPanel>
                            </Grid>
                        </Border>

                        <!-- TAB 1: MAIN DRAG-FIRST PANELS -->
                        <Grid x:Name='panelMainTab' Grid.Row='1' Margin='24,18'>
                            <Grid.RowDefinitions>
                                <RowDefinition Height='240'/>
                                <RowDefinition Height='*'/>
                            </Grid.RowDefinitions>

                            <!-- BIG DROP CARD -->
                            <Border Grid.Row='0' CornerRadius='18' BorderBrush='#8B5CF6' BorderThickness='1.5'>
                                <Border.Background>
                                    <LinearGradientBrush StartPoint='0,0' EndPoint='0,1'>
                                        <GradientStop Color='#121B2E' Offset='0'/>
                                        <GradientStop Color='#0F1524' Offset='1'/>
                                    </LinearGradientBrush>
                                </Border.Background>
                                <Border.Effect>
                                    <DropShadowEffect Color='#7C3AED' BlurRadius='40' ShadowDepth='0' Opacity='0.35'/>
                                </Border.Effect>
                                <Grid Margin='30,22'>
                                    <StackPanel VerticalAlignment='Center' HorizontalAlignment='Center'>
                                        <TextBlock Text='📥' FontSize='44' HorizontalAlignment='Center' Margin='0,0,0,10'/>
                                        <TextBlock Text='将存档文件夹或文件拖入此处' FontSize='20' FontWeight='Bold' Foreground='#E2E8F0' HorizontalAlignment='Center'/>
                                        <TextBlock Text='支持拖拽 Steam 散文件目录、Xbox WGS 容器或挑选备份压缩包' FontSize='12.5' Foreground='#64748B' HorizontalAlignment='Center' Margin='0,6,0,18'/>
                                        <StackPanel Orientation='Horizontal' HorizontalAlignment='Center'>
                                            <Button x:Name='btnAddCustomPathMain' Style='{StaticResource SteamBtn}' Cursor='Hand' Margin='0,0,14,0' Padding='20,12'>
                                                <StackPanel Orientation='Horizontal'>
                                                    <TextBlock Text='📂' FontSize='14' VerticalAlignment='Center'/>
                                                    <TextBlock Text='  浏览选择存档文件夹' VerticalAlignment='Center' Margin='4,0,0,0'/>
                                                </StackPanel>
                                            </Button>
                                            <Button x:Name='btnPickCustomFileMain' Style='{StaticResource XboxBtn}' Cursor='Hand' Padding='20,12'>
                                                <StackPanel Orientation='Horizontal'>
                                                    <TextBlock Text='📄' FontSize='14' VerticalAlignment='Center'/>
                                                    <TextBlock Text='  挑选存档文件' VerticalAlignment='Center' Margin='4,0,0,0'/>
                                                </StackPanel>
                                            </Button>
                                        </StackPanel>
                                    </StackPanel>
                                </Grid>
                            </Border>

                            <!-- STEP 2 & 3 SELECTION CARD -->
                            <Border Grid.Row='1' CornerRadius='16' BorderBrush='#1E293B' BorderThickness='1' Margin='0,16,0,0' Padding='24,20'>
                                <Border.Background>
                                    <LinearGradientBrush StartPoint='0,0' EndPoint='0,1'>
                                        <GradientStop Color='#0A1020' Offset='0'/>
                                        <GradientStop Color='#070C18' Offset='1'/>
                                    </LinearGradientBrush>
                                </Border.Background>
                                <Grid>
                                    <Grid.RowDefinitions>
                                        <RowDefinition Height='Auto'/>
                                        <RowDefinition Height='Auto'/>
                                        <RowDefinition Height='Auto'/>
                                        <RowDefinition Height='*'/>
                                    </Grid.RowDefinitions>

                                    <!-- LOADED ARCHIVE STATUS -->
                                    <Border Grid.Row='0' Background='#0F172A' BorderBrush='#334155' BorderThickness='1' CornerRadius='10' Padding='16,12' Margin='0,0,0,16'>
                                        <TextBlock x:Name='txtMainLoadedStatus' Text='📌  当前载入源存档：尚未拖入或选择，请在上方拖入存档文件夹或点击按钮选择' FontSize='13' FontWeight='Bold' Foreground='#E2E8F0'/>
                                    </Border>

                                    <!-- STEP 2: PLATFORM SWITCH -->
                                    <StackPanel Grid.Row='1' Margin='0,0,0,16'>
                                        <TextBlock Text='【第 2 步】选择要移植的目标平台：' FontSize='13' FontWeight='Bold' Foreground='#A78BFA' Margin='0,0,0,8'/>
                                        <StackPanel Orientation='Horizontal'>
                                            <Button x:Name='btnTargetXbox' Style='{StaticResource XboxBtn}' Cursor='Hand' Margin='0,0,12,0' Padding='20,12'>
                                                <StackPanel Orientation='Horizontal'>
                                                    <TextBlock Text='💚' FontSize='15' VerticalAlignment='Center'/>
                                                    <TextBlock Text='  移植写入至 Xbox PC Game Pass (在位 Blob 注入 &amp; 云同步)' VerticalAlignment='Center' Margin='4,0,0,0'/>
                                                </StackPanel>
                                            </Button>
                                            <Button x:Name='btnTargetSteam' Style='{StaticResource SteamBtn}' Cursor='Hand' Padding='20,12'>
                                                <StackPanel Orientation='Horizontal'>
                                                    <TextBlock Text='💙' FontSize='15' VerticalAlignment='Center'/>
                                                    <TextBlock Text='  移植写入至 Steam 平台 (解包脱壳至 Steam 散文件)' VerticalAlignment='Center' Margin='4,0,0,0'/>
                                                </StackPanel>
                                            </Button>
                                        </StackPanel>
                                    </StackPanel>

                                    <!-- STEP 3: TARGET GAME DROPDOWN -->
                                    <StackPanel Grid.Row='2' Margin='0,0,0,20'>
                                        <TextBlock Text='【第 3 步】确认目标关联游戏 (自动识别预选 / 下拉点选更换)：' FontSize='13' FontWeight='Bold' Foreground='#A78BFA' Margin='0,0,0,8'/>
                                        <ComboBox x:Name='cbMainTargetGame' Height='38' Background='#0F172A' Foreground='#38BDF8' FontSize='13.5' FontWeight='Bold' Padding='12,8' BorderBrush='#334155'/>
                                    </StackPanel>

                                    <!-- START ACTION BUTTON -->
                                    <Button x:Name='btnStartMainMigrate' Grid.Row='3' Style='{StaticResource PurpleBtn}' Cursor='Hand' VerticalAlignment='Bottom' HorizontalAlignment='Stretch'>
                                        <StackPanel Orientation='Horizontal' HorizontalAlignment='Center'>
                                            <TextBlock Text='🚀' FontSize='18' VerticalAlignment='Center'/>
                                            <TextBlock Text='  立刻开始移植 (在位脱壳写入 &amp; 自动 ZIP 安全备份)' FontSize='15' FontWeight='Bold' VerticalAlignment='Center' Margin='8,0,0,0'/>
                                        </StackPanel>
                                    </Button>
                                </Grid>
                            </Border>
                        </Grid>

                        <!-- TAB 2: DUAL SCAN PANEL (COLLAPSED BY DEFAULT) -->
                        <Grid x:Name='panelScanTab' Grid.Row='1' Margin='20,16,20,0' Visibility='Collapsed'>
                            <Grid.ColumnDefinitions>
                                <ColumnDefinition Width='*'/>
                                <ColumnDefinition Width='24'/>
                                <ColumnDefinition Width='*'/>
                            </Grid.ColumnDefinitions>

                            <!-- STEAM CARD -->
                            <Border Grid.Column='0' CornerRadius='16' BorderBrush='#1E4976' BorderThickness='1'>
                                <Border.Background>
                                    <LinearGradientBrush StartPoint='0,0' EndPoint='0,1'>
                                        <GradientStop Color='#080F20' Offset='0'/>
                                        <GradientStop Color='#0A1428' Offset='1'/>
                                    </LinearGradientBrush>
                                </Border.Background>
                                <Grid>
                                    <Grid.RowDefinitions>
                                        <RowDefinition Height='Auto'/>
                                        <RowDefinition Height='*'/>
                                        <RowDefinition Height='Auto'/>
                                    </Grid.RowDefinitions>
                                    <Border Grid.Row='0' CornerRadius='15,15,0,0' Padding='18,14'>
                                        <Border.Background>
                                            <LinearGradientBrush StartPoint='0,0' EndPoint='1,0'>
                                                <GradientStop Color='#071828' Offset='0'/>
                                                <GradientStop Color='#0A2035' Offset='1'/>
                                            </LinearGradientBrush>
                                        </Border.Background>
                                        <StackPanel Orientation='Horizontal'>
                                            <Ellipse Width='8' Height='8' Fill='#38BDF8' VerticalAlignment='Center' Margin='0,0,10,0'/>
                                            <TextBlock Text='Steam  已安装游戏存档' FontSize='14' FontWeight='Bold' Foreground='#38BDF8' VerticalAlignment='Center'/>
                                        </StackPanel>
                                    </Border>
                                    <ListView x:Name='lvSteam' Grid.Row='1' Background='Transparent' BorderThickness='0' Padding='10,6' SelectionMode='Single'>
                                        <ListView.View>
                                            <GridView>
                                                <GridViewColumn Header='GAME  ·  ACCOUNT' DisplayMemberBinding='{Binding GameTitle}' Width='250'/>
                                                <GridViewColumn Header='MODIFIED' DisplayMemberBinding='{Binding LastModifiedText}' Width='130'/>
                                                <GridViewColumn Header='SIZE  ·  FILES' DisplayMemberBinding='{Binding SizeText}' Width='150'/>
                                            </GridView>
                                        </ListView.View>
                                    </ListView>
                                    <Border Grid.Row='2' BorderBrush='#0F2240' BorderThickness='0,1,0,0' Padding='14,12'>
                                        <StackPanel>
                                            <Button x:Name='btnSteamToXbox' Style='{StaticResource SteamBtn}' IsEnabled='False' Cursor='Hand'>
                                                <StackPanel Orientation='Horizontal'>
                                                    <TextBlock Text='➡️  打包 Steam 存档  →  写入 Xbox PC (WGS 容器)' VerticalAlignment='Center'/>
                                                </StackPanel>
                                            </Button>
                                            <Button x:Name='btnOpenSteamFolder' Style='{StaticResource GhostBtn}' Foreground='#38BDF8' Margin='0,8,0,0' Cursor='Hand'>
                                                <TextBlock Text='📁 打开选中的 Steam 物理目录' VerticalAlignment='Center'/>
                                            </Button>
                                        </StackPanel>
                                    </Border>
                                </Grid>
                            </Border>

                            <!-- CENTER DIVIDER -->
                            <TextBlock Grid.Column='1' Text='⇄' FontSize='22' Foreground='#1E293B' HorizontalAlignment='Center' VerticalAlignment='Center'/>

                            <!-- XBOX CARD -->
                            <Border Grid.Column='2' CornerRadius='16' BorderBrush='#1A4036' BorderThickness='1'>
                                <Border.Background>
                                    <LinearGradientBrush StartPoint='0,0' EndPoint='0,1'>
                                        <GradientStop Color='#071A14' Offset='0'/>
                                        <GradientStop Color='#091F18' Offset='1'/>
                                    </LinearGradientBrush>
                                </Border.Background>
                                <Grid>
                                    <Grid.RowDefinitions>
                                        <RowDefinition Height='Auto'/>
                                        <RowDefinition Height='*'/>
                                        <RowDefinition Height='Auto'/>
                                    </Grid.RowDefinitions>
                                    <Border Grid.Row='0' CornerRadius='15,15,0,0' Padding='18,14'>
                                        <Border.Background>
                                            <LinearGradientBrush StartPoint='0,0' EndPoint='1,0'>
                                                <GradientStop Color='#051510' Offset='0'/>
                                                <GradientStop Color='#071C15' Offset='1'/>
                                            </LinearGradientBrush>
                                        </Border.Background>
                                        <StackPanel Orientation='Horizontal'>
                                            <Ellipse Width='8' Height='8' Fill='#34D399' VerticalAlignment='Center' Margin='0,0,10,0'/>
                                            <TextBlock Text='Xbox PC  WGS 容器存档' FontSize='14' FontWeight='Bold' Foreground='#34D399' VerticalAlignment='Center'/>
                                        </StackPanel>
                                    </Border>
                                    <ListView x:Name='lvXbox' Grid.Row='1' Background='Transparent' BorderThickness='0' Padding='10,6' SelectionMode='Single'>
                                        <ListView.View>
                                            <GridView>
                                                <GridViewColumn Header='GAME  ·  TITLE' DisplayMemberBinding='{Binding GameTitle}' Width='220'/>
                                                <GridViewColumn Header='MODIFIED' DisplayMemberBinding='{Binding LastModifiedText}' Width='120'/>
                                                <GridViewColumn Header='WGS CONTAINERS' DisplayMemberBinding='{Binding SizeText}' Width='130'/>
                                                <GridViewColumn Header='XUID ACCOUNT (P-02)' DisplayMemberBinding='{Binding XuidAccount}' Width='160'/>
                                            </GridView>
                                        </ListView.View>
                                    </ListView>
                                    <Border Grid.Row='2' BorderBrush='#0C2820' BorderThickness='0,1,0,0' Padding='14,12'>
                                        <StackPanel>
                                            <Button x:Name='btnXboxToSteam' Style='{StaticResource XboxBtn}' IsEnabled='False' Cursor='Hand'>
                                                <StackPanel Orientation='Horizontal'>
                                                    <TextBlock Text='⬅️  解包 Xbox 存档  →  导出至 Steam / 本地' VerticalAlignment='Center'/>
                                                </StackPanel>
                                            </Button>
                                            <Button x:Name='btnOpenXboxFolder' Style='{StaticResource GhostBtn}' Foreground='#34D399' Margin='0,8,0,0' Cursor='Hand'>
                                                <TextBlock Text='📁 打开选中的 Xbox WGS 容器目录' VerticalAlignment='Center'/>
                                            </Button>
                                        </StackPanel>
                                    </Border>
                                </Grid>
                            </Border>
                        </Grid>

                        <!-- TAB 3: BACKUP TAB (COLLAPSED BY DEFAULT) -->
                        <Border x:Name='panelBackupTab' Grid.Row='1' CornerRadius='16' BorderBrush='#1E293B' BorderThickness='1' Margin='24,18' Padding='20' Visibility='Collapsed'>
                            <Border.Background>
                                <LinearGradientBrush StartPoint='0,0' EndPoint='0,1'>
                                    <GradientStop Color='#0A1020' Offset='0'/>
                                    <GradientStop Color='#070C18' Offset='1'/>
                                </LinearGradientBrush>
                            </Border.Background>
                            <StackPanel>
                                <TextBlock Text='📦  ZIP 存档历史备份列表管理器' FontSize='16' FontWeight='Bold' Foreground='#34D399' Margin='0,0,0,12'/>
                                <TextBlock Text='每次执行覆盖移植时，控制台均已全自动在 Backups/ 目录下生成了包含完整原状态的 ZIP 归档压缩包。' FontSize='12' Foreground='#64748B' Margin='0,0,0,16'/>
                                <Button x:Name='btnBackupViewDetails' Content='📦  查看所有 ZIP 备份归档详情' Width='240' HorizontalAlignment='Left' Style='{StaticResource XboxBtn}'/>
                            </StackPanel>
                        </Border>

                        <!-- INSPECTOR PANEL -->
                        <Border Grid.Row='2' CornerRadius='14' BorderBrush='#1E293B' BorderThickness='1' Margin='20,8,20,8' Padding='18,14'>
                            <Border.Background>
                                <LinearGradientBrush StartPoint='0,0' EndPoint='0,1'>
                                    <GradientStop Color='#0A1020' Offset='0'/>
                                    <GradientStop Color='#080D1A' Offset='1'/>
                                </LinearGradientBrush>
                            </Border.Background>
                            <Grid>
                                <Grid.RowDefinitions>
                                    <RowDefinition Height='Auto'/>
                                    <RowDefinition Height='Auto'/>
                                    <RowDefinition Height='*'/>
                                </Grid.RowDefinitions>
                                <TextBlock x:Name='txtDetailTitle' Grid.Row='0' Text='🔍  点击表格或在主界面选择存档，在此展开文件明细与 MD5 校验...' FontSize='13' FontWeight='Bold' Foreground='#334155'/>
                                <TextBlock x:Name='txtDetailPath' Grid.Row='1' Text='📁  存档路径：尚未选择' FontSize='11.5' Foreground='#1E293B' Margin='0,5,0,5'/>
                                <ListView x:Name='lvFileDetails' Grid.Row='2' Background='Transparent' BorderThickness='0' MaxHeight='65'>
                                    <ListView.View>
                                        <GridView>
                                            <GridViewColumn Header='FILENAME' DisplayMemberBinding='{Binding FileName}' Width='200'/>
                                            <GridViewColumn Header='SIZE' DisplayMemberBinding='{Binding SizeText}' Width='100'/>
                                            <GridViewColumn Header='MD5 CHECKSUM' DisplayMemberBinding='{Binding Md5Hash}' Width='300'/>
                                        </GridView>
                                    </ListView.View>
                                </ListView>
                            </Grid>
                        </Border>

                        <!-- STATUS BAR -->
                        <Border Grid.Row='3' BorderBrush='#0F172A' BorderThickness='0,1,0,0' Padding='22,0' Background='#060A14'>
                            <TextBlock x:Name='txtStatus' Text='就绪。请在上方大框拖入存档文件夹，或在下方选择目标游戏直接移植。' FontSize='12' Foreground='#334155' VerticalAlignment='Center'/>
                        </Border>

                        <!-- OVERLAY DRAG DROP DIALOG (FALLBACK OVERLAY) -->
                        <Border x:Name='dropOverlay' Grid.RowSpan='4' Background='#E5060A14' Visibility='Collapsed'>
                            <Border Width='600' VerticalAlignment='Center' HorizontalAlignment='Center' CornerRadius='20' BorderThickness='1.5' BorderBrush='#8B5CF6'>
                                <Border.Background>
                                    <LinearGradientBrush StartPoint='0,0' EndPoint='0,1'>
                                        <GradientStop Color='#141C30' Offset='0'/>
                                        <GradientStop Color='#101525' Offset='1'/>
                                    </LinearGradientBrush>
                                </Border.Background>
                                <StackPanel Margin='30,28'>
                                    <TextBlock Text='📥  捕获到拖拽存档资源' FontSize='20' FontWeight='Bold' Foreground='#A78BFA' HorizontalAlignment='Center'/>
                                    <Border Background='#0A1020' BorderBrush='#1E2A40' BorderThickness='1' CornerRadius='12' Padding='18,14' Margin='0,16,0,16'>
                                        <StackPanel>
                                            <TextBlock x:Name='txtDropTitle' Text='🎮  识别游戏：...' FontSize='15' FontWeight='Bold' Foreground='#E2E8F0'/>
                                            <TextBlock x:Name='txtDropSub' Text='📄  属性明细：读取中...' FontSize='12' Foreground='#475569' Margin='0,6,0,10' TextWrapping='Wrap'/>
                                            <TextBlock Text='🎯  绑定目标游戏 (自动映射/点选已检出游戏直接移植)：' FontSize='12' FontWeight='Bold' Foreground='#A78BFA' Margin='0,0,0,6'/>
                                            <ComboBox x:Name='cbDropTargetGame' Height='36' Background='#0F172A' Foreground='#38BDF8' FontSize='13' FontWeight='Bold' Padding='10,6' BorderBrush='#334155'/>
                                        </StackPanel>
                                    </Border>
                                    <Button x:Name='btnDropToXbox' Style='{StaticResource SteamBtn}' Cursor='Hand' Margin='0,0,0,10' Padding='18,14'>
                                        <TextBlock Text='➡️  打包封装写入 Xbox PC Game Pass' FontSize='14' FontWeight='Bold' Foreground='White'/>
                                    </Button>
                                    <Button x:Name='btnDropToSteam' Style='{StaticResource XboxBtn}' Cursor='Hand' Margin='0,0,0,10' Padding='18,14'>
                                        <TextBlock Text='⬅️  解包提取导出至 Steam / PC 本地' FontSize='14' FontWeight='Bold' Foreground='White'/>
                                    </Button>
                                    <Button x:Name='btnDropCancel' Style='{StaticResource GhostBtn}' Cursor='Hand' Foreground='#475569'>
                                        <TextBlock Text='✕ 取消' FontSize='13'/>
                                    </Button>
                                </StackPanel>
                            </Border>
                        </Border>
                    </Grid>
                </Window>";

            Window win = (Window)XamlReader.Parse(xaml);

            // Find Elements
            panelMainTab = (Grid)win.FindName("panelMainTab");
            panelScanTab = (Grid)win.FindName("panelScanTab");
            panelBackupTab = (Border)win.FindName("panelBackupTab");

            btnTabMain = (Button)win.FindName("btnTabMain");
            btnTabScan = (Button)win.FindName("btnTabScan");
            btnTabBackups = (Button)win.FindName("btnTabBackups");

            txtMainLoadedStatus = (TextBlock)win.FindName("txtMainLoadedStatus");
            btnTargetSteam = (Button)win.FindName("btnTargetSteam");
            btnTargetXbox = (Button)win.FindName("btnTargetXbox");
            cbMainTargetGame = (ComboBox)win.FindName("cbMainTargetGame");
            btnStartMainMigrate = (Button)win.FindName("btnStartMainMigrate");

            Button btnAddCustomPathMain = (Button)win.FindName("btnAddCustomPathMain");
            Button btnPickCustomFileMain = (Button)win.FindName("btnPickCustomFileMain");

            dropOverlay = (Border)win.FindName("dropOverlay");
            cbDropTargetGame = (ComboBox)win.FindName("cbDropTargetGame");
            txtDropTitle = (TextBlock)win.FindName("txtDropTitle");
            txtDropSub = (TextBlock)win.FindName("txtDropSub");
            btnDropToXbox = (Button)win.FindName("btnDropToXbox");
            btnDropToSteam = (Button)win.FindName("btnDropToSteam");
            btnDropCancel = (Button)win.FindName("btnDropCancel");

            // Tab Switching Logic
            btnTabMain.Click += (s, e) =>
            {
                panelMainTab.Visibility = Visibility.Visible;
                panelScanTab.Visibility = Visibility.Collapsed;
                panelBackupTab.Visibility = Visibility.Collapsed;
            };

            btnTabScan.Click += (s, e) =>
            {
                panelMainTab.Visibility = Visibility.Collapsed;
                panelScanTab.Visibility = Visibility.Visible;
                panelBackupTab.Visibility = Visibility.Collapsed;
            };

            btnTabBackups.Click += (s, e) =>
            {
                panelMainTab.Visibility = Visibility.Collapsed;
                panelScanTab.Visibility = Visibility.Collapsed;
                panelBackupTab.Visibility = Visibility.Visible;
            };

            // Main Tab Buttons Action
            btnAddCustomPathMain.Click += (s, e) => AddCustomFolderDialog();
            btnPickCustomFileMain.Click += (s, e) => PickCustomFilesDialog();

            btnTargetXbox.Click += (s, e) =>
            {
                isMainTargetXbox = true;
                btnTargetXbox.Opacity = 1.0;
                btnTargetSteam.Opacity = 0.4;
            };

            btnTargetSteam.Click += (s, e) =>
            {
                isMainTargetXbox = false;
                btnTargetSteam.Opacity = 1.0;
                btnTargetXbox.Opacity = 0.4;
            };

            btnStartMainMigrate.Click += (s, e) => ExecuteMainTabMigration();

            Button btnBackupViewDetails = (Button)win.FindName("btnBackupViewDetails");
            if (btnBackupViewDetails != null)
            {
                btnBackupViewDetails.Click += (s, e) => ShowBackupsDialog();
            }

            // Overlay events
            btnDropCancel.Click += (s, e) => { dropOverlay.Visibility = Visibility.Collapsed; };
            btnDropToXbox.Click += (s, e) => ExecuteDropAction(true);
            btnDropToSteam.Click += (s, e) => ExecuteDropAction(false);

            win.AllowDrop = true;
            win.DragOver += (s, e) =>
            {
                if (e.Data.GetDataPresent(DataFormats.FileDrop))
                {
                    e.Effects = DragDropEffects.Copy;
                    e.Handled = true;
                }
            };
            win.Drop += (s, e) =>
            {
                if (e.Data.GetDataPresent(DataFormats.FileDrop))
                {
                    string[] droppedPaths = (string[])e.Data.GetData(DataFormats.FileDrop);
                    if (droppedPaths != null && droppedPaths.Length > 0)
                    {
                        ShowInAppDropDialog(droppedPaths);
                    }
                }
            };

            lvSteam = (ListView)win.FindName("lvSteam");
            lvSteam.SelectionChanged += OnSteamSelectionChanged;

            lvXbox = (ListView)win.FindName("lvXbox");
            lvXbox.SelectionChanged += OnXboxSelectionChanged;

            lvFileDetails = (ListView)win.FindName("lvFileDetails");

            btnSteamToXbox = (Button)win.FindName("btnSteamToXbox");
            btnSteamToXbox.Click += (s, e) => ExecuteSteamToXbox();

            Button btnOpenSteamFolder = (Button)win.FindName("btnOpenSteamFolder");
            btnOpenSteamFolder.Click += (s, e) => OpenSteamFolder();

            btnXboxToSteam = (Button)win.FindName("btnXboxToSteam");
            btnXboxToSteam.Click += (s, e) => ExecuteXboxToSteam();

            Button btnOpenXboxFolder = (Button)win.FindName("btnOpenXboxFolder");
            btnOpenXboxFolder.Click += (s, e) => OpenXboxFolder();

            txtDetailTitle = (TextBlock)win.FindName("txtDetailTitle");
            txtDetailPath = (TextBlock)win.FindName("txtDetailPath");
            txtStatus = (TextBlock)win.FindName("txtStatus");

            PerformAutoScan();
            app.Run(win);
        }

        private static void OnShowBackupsClick(object sender, RoutedEventArgs e)
        {
            ShowBackupsDialog();
        }

        private static void ExecuteMainTabMigration()
        {
            if (string.IsNullOrEmpty(currentMainLoadedPath) && (currentDroppedPaths == null || currentDroppedPaths.Length == 0))
            {
                MessageBox.Show("请先拖入存档文件夹，或点击上方的【浏览选择存档文件夹】/【挑选存档文件】按钮选择要移植的源存档！", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            ExecuteDropAction(isMainTargetXbox);
        }

        private static void ShowInAppDropDialog(string[] paths)
        {
            currentDroppedPaths = paths;
            string targetPath = paths[0];
            bool isFolder = Directory.Exists(targetPath);

            string gameTitle = WgsEngine.IdentifyDroppedGameTitle(targetPath);
            bool isWgsContainer = isFolder && File.Exists(Path.Combine(targetPath, "containers.index"));

            string formatType = isWgsContainer ? "Xbox WGS 容器索引" : (isFolder ? "Steam / 本地散文件目录" : "单个/多个存档文件");

            int fileCount = 1;
            if (isFolder)
            {
                try { fileCount = Directory.GetFiles(targetPath, "*", SearchOption.AllDirectories).Length; } catch { }
            }
            else
            {
                fileCount = paths.Length;
            }

            txtDropTitle.Text = string.Format("🎮 智能匹配识别：{0}", gameTitle);
            txtDropSub.Text = string.Format("📄 数据类型：{0} (共 {1} 个文件)\n📁 拖入绝对路径：{2}", formatType, fileCount, targetPath);

            currentMainLoadedPath = targetPath;
            if (txtMainLoadedStatus != null)
            {
                txtMainLoadedStatus.Text = string.Format("📌 已载入源存档：{0}\n🎮 智能算法识别结果：【{1}】 (共 {2} 个存档文件)", targetPath, gameTitle, fileCount);
            }

            Action<ComboBox> fillCombo = (cb) =>
            {
                if (cb == null) return;
                cb.Items.Clear();
                HashSet<string> options = new HashSet<string>();

                if (!string.IsNullOrEmpty(gameTitle) && !gameTitle.Contains("未识别") && !gameTitle.Contains("自定义"))
                {
                    options.Add(gameTitle);
                }

                if (steamSaves != null)
                {
                    foreach (var s in steamSaves)
                    {
                        if (!string.IsNullOrEmpty(s.GameTitle)) options.Add(s.GameTitle);
                    }
                }
                if (xboxSaves != null)
                {
                    foreach (var x in xboxSaves)
                    {
                        if (!string.IsNullOrEmpty(x.GameTitle)) options.Add(x.GameTitle);
                    }
                }
                foreach (var p in WgsEngine.Presets)
                {
                    if (!string.IsNullOrEmpty(p.Name)) options.Add(p.Name);
                }

                foreach (string opt in options)
                {
                    cb.Items.Add(opt);
                }

                if (cb.Items.Count > 0)
                {
                    cb.SelectedIndex = 0;
                }
            };

            fillCombo(cbDropTargetGame);
            fillCombo(cbMainTargetGame);

            dropOverlay.Visibility = Visibility.Collapsed;
        }

        private static void ExecuteDropAction(bool toXbox)
        {
            dropOverlay.Visibility = Visibility.Collapsed;
            if (currentDroppedPaths == null || currentDroppedPaths.Length == 0) return;

            string targetPath = currentDroppedPaths[0];
            bool isFolder = Directory.Exists(targetPath);
            bool isWgsContainer = isFolder && File.Exists(Path.Combine(targetPath, "containers.index"));

            string selectedGame = "";
            ComboBox targetCombo = (cbMainTargetGame != null && panelMainTab != null && panelMainTab.Visibility == Visibility.Visible) ? cbMainTargetGame : cbDropTargetGame;

            if (targetCombo != null && targetCombo.SelectedItem != null)
            {
                selectedGame = targetCombo.SelectedItem.ToString();
            }
            if (string.IsNullOrEmpty(selectedGame))
            {
                selectedGame = WgsEngine.IdentifyDroppedGameTitle(targetPath);
            }

            // P-01: 主拖拽路径同样执行进程在线阻断
            string blockGameId = selectedGame;
            if (toXbox && WgsEngine.IsGameProcessRunning(blockGameId))
            {
                if (MessageBox.Show(string.Format("⚠️ 安全防线感知提示：\n\n检测到游戏《{0}》当前正在后台运行中！\n在游戏运行期间强行覆盖存档，可能会导致数据冲突或被游戏云同步重新覆盖。\n\n建议：请先保存并退出游戏后再执行移植。\n\n您确定仍然要强制继续写入移植吗？", selectedGame), "运行状态冲突警告", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
                {
                    return;
                }
            }

            // P-04: 将耗时迁移写入封装在 Task.Run 中，防止 WPF UI 主线程卡死
            if (txtStatus != null) txtStatus.Text = "🔄 正在执行移植写入，请稍候...";
            System.Threading.Tasks.Task.Run(() =>
            {
                try
                {
                    if (toXbox)
                    {
                        string targetWgs = "";
                        // Try to find Xbox path matching selectedGame
                        if (xboxSaves != null)
                        {
                            foreach (var x in xboxSaves)
                            {
                                if (x.GameTitle.Equals(selectedGame, StringComparison.OrdinalIgnoreCase) || x.GameTitle.Contains(selectedGame) || selectedGame.Contains(x.GameTitle))
                                {
                                    targetWgs = x.XboxPath;
                                    break;
                                }
                            }
                        }
                        if (string.IsNullOrEmpty(targetWgs) && steamSaves != null)
                        {
                            foreach (var s in steamSaves)
                            {
                                if ((s.GameTitle.Equals(selectedGame, StringComparison.OrdinalIgnoreCase) || s.GameTitle.Contains(selectedGame) || selectedGame.Contains(s.GameTitle)) && !string.IsNullOrEmpty(s.MatchingXboxPath))
                                {
                                    targetWgs = s.MatchingXboxPath;
                                    break;
                                }
                            }
                        }
                        if (string.IsNullOrEmpty(targetWgs))
                        {
                            foreach (var p in WgsEngine.Presets)
                            {
                                if (p.Name.Equals(selectedGame, StringComparison.OrdinalIgnoreCase) || p.Name.Contains(selectedGame) || selectedGame.Contains(p.Name))
                                {
                                    targetWgs = WgsEngine.FindXboxWgs(p.XboxPkgPattern);
                                    break;
                                }
                            }
                        }

                        if (string.IsNullOrEmpty(targetWgs) || !Directory.Exists(targetWgs))
                        {
                            string pickedWgs = null;
                            app.Dispatcher.Invoke(() =>
                            {
                                using (System.Windows.Forms.FolderBrowserDialog folderDialog = new System.Windows.Forms.FolderBrowserDialog())
                                {
                                    folderDialog.Description = string.Format("请选择【{0}】的目标 Xbox WGS 目录 (Packages\\...\\SystemAppData\\wgs\\...)：", selectedGame);
                                    if (folderDialog.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                                        pickedWgs = folderDialog.SelectedPath;
                                }
                            });
                            if (pickedWgs != null) targetWgs = pickedWgs;
                            else return;
                        }

                        string backup = WgsEngine.CreateZipBackup(targetWgs, "dropped_xbox", "xbox");
                        string result = isFolder ? WgsEngine.PackFolderToWgs(targetPath, targetWgs, "DroppedSave") : WgsEngine.PackFilesToWgs(currentDroppedPaths, targetWgs, "DroppedSave");
                        string msg = string.Format("已成功打包写入【{0}】Xbox WGS 容器！\n\n{1}", selectedGame, result);
                        if (!string.IsNullOrEmpty(backup)) msg += string.Format("\n\n[安全防线] 已自动生成压缩包备份:\n{0}", backup);

                        // P-03: Xbox 写入成功后加入云端同步冲突安全提醒
                        msg += "\n\n⚠️ [云同步安全提醒] 重新打开 Xbox 游戏时，若弹出云同步确认框，请务必选择【使用本地存档 / Use Local Save】，否则云端旧存档可能再次覆盖刚移植好的本地存档！";

                        app.Dispatcher.Invoke(() =>
                        {
                            MessageBox.Show(msg, "移植至 Xbox 成功", MessageBoxButton.OK, MessageBoxImage.Information);
                            PerformAutoScan();
                        });
                    }
                    else
                    {
                        string targetSteam = "";
                        // Try to find Steam path matching selectedGame
                        if (steamSaves != null)
                        {
                            foreach (var s in steamSaves)
                            {
                                if (s.GameTitle.Equals(selectedGame, StringComparison.OrdinalIgnoreCase) || s.GameTitle.Contains(selectedGame) || selectedGame.Contains(s.GameTitle))
                                {
                                    targetSteam = s.SteamPath;
                                    break;
                                }
                            }
                        }
                        if (string.IsNullOrEmpty(targetSteam) && xboxSaves != null)
                        {
                            foreach (var x in xboxSaves)
                            {
                                if ((x.GameTitle.Equals(selectedGame, StringComparison.OrdinalIgnoreCase) || x.GameTitle.Contains(selectedGame) || selectedGame.Contains(x.GameTitle)) && !string.IsNullOrEmpty(x.MatchingSteamPath))
                                {
                                    targetSteam = x.MatchingSteamPath;
                                    break;
                                }
                            }
                        }
                        if (string.IsNullOrEmpty(targetSteam))
                        {
                            foreach (var p in WgsEngine.Presets)
                            {
                                if (p.Name.Equals(selectedGame, StringComparison.OrdinalIgnoreCase) || p.Name.Contains(selectedGame) || selectedGame.Contains(p.Name))
                                {
                                    targetSteam = WgsEngine.ResolvePath(p.SteamRelPath);
                                    break;
                                }
                            }
                        }

                        if (string.IsNullOrEmpty(targetSteam) || !Directory.Exists(targetSteam))
                        {
                            string pickedSteam = null;
                            app.Dispatcher.Invoke(() =>
                            {
                                using (System.Windows.Forms.FolderBrowserDialog folderDialog = new System.Windows.Forms.FolderBrowserDialog())
                                {
                                    folderDialog.Description = string.Format("请选择导出【{0}】至 Steam 的目标目录：", selectedGame);
                                    if (folderDialog.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                                        pickedSteam = folderDialog.SelectedPath;
                                }
                            });
                            if (pickedSteam != null) targetSteam = pickedSteam;
                            else return;
                        }

                        string backup = WgsEngine.CreateZipBackup(targetSteam, "dropped_steam", "steam");
                        string result = "";
                        if (isWgsContainer)
                        {
                            result = WgsEngine.ExtractWgsFolder(targetPath, targetSteam);
                        }
                        else if (isFolder)
                        {
                            string[] files = Directory.GetFiles(targetPath, "*", SearchOption.AllDirectories);
                            foreach (string f in files)
                            {
                                string dest = Path.Combine(targetSteam, Path.GetFileName(f));
                                File.Copy(f, dest, true);
                            }
                            result = string.Format("成功解包导出 {0} 个文件至 Steam 【{1}】目录:\n{2}", files.Length, selectedGame, targetSteam);
                        }
                        else
                        {
                            foreach (string f in currentDroppedPaths)
                            {
                                if (File.Exists(f))
                                {
                                    string dest = Path.Combine(targetSteam, Path.GetFileName(f));
                                    File.Copy(f, dest, true);
                                }
                            }
                            result = string.Format("成功导出 {0} 个存档文件至 Steam 【{1}】目录:\n{2}", currentDroppedPaths.Length, selectedGame, targetSteam);
                        }

                        string msg = result;
                        if (!string.IsNullOrEmpty(backup)) msg += string.Format("\n\n[安全防线] 已自动生成压缩包备份:\n{0}", backup);

                        app.Dispatcher.Invoke(() =>
                        {
                            MessageBox.Show(msg, "导出至 Steam 成功", MessageBoxButton.OK, MessageBoxImage.Information);
                            PerformAutoScan();
                        });
                    }
                }
                catch (Exception ex)
                {
                    app.Dispatcher.Invoke(() =>
                        MessageBox.Show(string.Format("移植发生错误: {0}", ex.Message), "错误", MessageBoxButton.OK, MessageBoxImage.Error));
                }
                finally
                {
                    if (app != null) app.Dispatcher.Invoke(() => { if (txtStatus != null) txtStatus.Text = "就绪。请在上方大框拖入存档文件夹，或在下方选择目标游戏直接移植。"; });
                }
            });
        }

        private static void PickCustomFilesDialog()
        {
            using (System.Windows.Forms.OpenFileDialog fileDialog = new System.Windows.Forms.OpenFileDialog())
            {
                fileDialog.Title = "请挑选要转换移植的单个或多个存档文件 (按住 Ctrl 键可多选)：";
                fileDialog.Multiselect = true;
                fileDialog.Filter = "所有存档文件 (*.*)|*.*|SAV/DAT/JSON 存档 (*.sav;*.dat;*.json)|*.sav;*.dat;*.json";

                System.Windows.Forms.DialogResult res = fileDialog.ShowDialog();
                if (res == System.Windows.Forms.DialogResult.OK && fileDialog.FileNames.Length > 0)
                {
                    ShowInAppDropDialog(fileDialog.FileNames);
                }
            }
        }

        private static void AddCustomFolderDialog()
        {
            using (System.Windows.Forms.FolderBrowserDialog folderDialog = new System.Windows.Forms.FolderBrowserDialog())
            {
                folderDialog.Description = "请选择要加入扫描或直接操作的本地存档文件夹：";
                System.Windows.Forms.DialogResult res = folderDialog.ShowDialog();
                if (res == System.Windows.Forms.DialogResult.OK && Directory.Exists(folderDialog.SelectedPath))
                {
                    WgsEngine.SaveCustomPath(folderDialog.SelectedPath);
                    ShowInAppDropDialog(new string[] { folderDialog.SelectedPath });
                }
            }
        }

        private static void PerformAutoScan()
        {
            if (lvSteam != null) lvSteam.Items.Clear();
            if (lvXbox != null) lvXbox.Items.Clear();

            if (txtStatus != null)
            {
                txtStatus.Text = "🔄 正在全盘深度智能检索双端存档，请稍候...";
            }

            System.Threading.ThreadPool.QueueUserWorkItem((state) =>
            {
                List<SteamSaveRecord> sList;
                List<XboxSaveRecord> xList;
                WgsEngine.ScanAllLocalSaves(out sList, out xList);

                int dualMatchCount = 0;
                foreach (var item in sList)
                {
                    if (!string.IsNullOrEmpty(item.MatchingXboxPath)) dualMatchCount++;
                }

                if (app != null)
                {
                    app.Dispatcher.BeginInvoke(new Action(() =>
                    {
                        steamSaves = sList;
                        xboxSaves = xList;

                        if (lvSteam != null)
                        {
                            lvSteam.Items.Clear();
                            foreach (var item in steamSaves) lvSteam.Items.Add(item);
                        }
                        if (lvXbox != null)
                        {
                            lvXbox.Items.Clear();
                            foreach (var item in xboxSaves) lvXbox.Items.Add(item);
                        }

                        if (txtStatus != null)
                        {
                            txtStatus.Text = string.Format("🎉 全维检索完成！共检出 Steam/PC 存档 {0} 个，Xbox WGS 存档 {1} 个 (其中 {2} 款游戏匹配到双端同款，支持 1-秒一键移植！)", steamSaves.Count, xboxSaves.Count, dualMatchCount);
                        }
                    }));
                }
            });
        }

        private static void OnSteamSelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (lvSteam.SelectedItem is SteamSaveRecord)
            {
                selectedSteam = (SteamSaveRecord)lvSteam.SelectedItem;
                btnSteamToXbox.IsEnabled = true;

                bool hasMatch = !string.IsNullOrEmpty(selectedSteam.MatchingXboxPath);
                txtDetailTitle.Text = string.Format("🔍 已选中 Steam 存档：{0} {1}", selectedSteam.GameTitle, hasMatch ? "⚡ [双端匹配就绪: 点击按钮即可1-秒一键写入 Xbox]" : "");
                txtDetailPath.Text = string.Format("📁 绝对路径：{0}", selectedSteam.SteamPath);

                if (lvFileDetails != null)
                {
                    lvFileDetails.Items.Clear();
                    List<FileDetailItem> files = WgsEngine.InspectFolderFiles(selectedSteam.SteamPath);
                    foreach (var f in files) lvFileDetails.Items.Add(f);
                }
            }
            else
            {
                selectedSteam = null;
                btnSteamToXbox.IsEnabled = false;
            }
        }

        private static void OnXboxSelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (lvXbox.SelectedItem is XboxSaveRecord)
            {
                selectedXbox = (XboxSaveRecord)lvXbox.SelectedItem;
                btnXboxToSteam.IsEnabled = true;

                bool hasMatch = !string.IsNullOrEmpty(selectedXbox.MatchingSteamPath);
                txtDetailTitle.Text = string.Format("🔍 已选中 Xbox WGS 存档：{0} {1}", selectedXbox.GameTitle, hasMatch ? "⚡ [双端匹配就绪: 点击按钮即可1-秒一键导出至 Steam]" : "");
                txtDetailPath.Text = string.Format("📁 WGS 容器路径：{0}{1}", selectedXbox.XboxPath, string.IsNullOrEmpty(selectedXbox.XuidAccount) ? "" : "\n👤 绑定 XUID 账号：" + selectedXbox.XuidAccount);

                if (lvFileDetails != null)
                {
                    lvFileDetails.Items.Clear();
                    List<FileDetailItem> files = WgsEngine.InspectFolderFiles(selectedXbox.XboxPath);
                    foreach (var f in files) lvFileDetails.Items.Add(f);
                }
            }
            else
            {
                selectedXbox = null;
                btnXboxToSteam.IsEnabled = false;
            }
        }

        private static void ShowBackupsDialog()
        {
            List<BackupItem> backups = WgsEngine.ListBackups();
            StringBuilder sb = new StringBuilder();
            sb.AppendLine("🔒 自动 ZIP 备份归档历史清单:\n");
            if (backups.Count == 0)
            {
                sb.AppendLine("暂无任何压缩包备份。在执行任何移植时，系统将自动强制生成 ZIP 时间戳备份。");
            }
            else
            {
                foreach (var b in backups)
                {
                    sb.AppendLine(string.Format("📦 [{0}] {1} (大小: {2})", b.CreatedTimeText, b.FileName, b.SizeText));
                }
            }
            MessageBox.Show(sb.ToString(), "ZIP 备份历史管理器", MessageBoxButton.OK, MessageBoxImage.Information);
        }

        private static void OpenSteamFolder()
        {
            if (selectedSteam != null && Directory.Exists(selectedSteam.SteamPath))
            {
                Process.Start("explorer.exe", string.Format("\"{0}\"", selectedSteam.SteamPath));
            }
        }

        private static void OpenXboxFolder()
        {
            if (selectedXbox != null && Directory.Exists(selectedXbox.XboxPath))
            {
                Process.Start("explorer.exe", string.Format("\"{0}\"", selectedXbox.XboxPath));
            }
        }

        private static void ExecuteSteamToXbox()
        {
            if (selectedSteam == null) return;

            if (selectedSteam.GameTitle.Contains("正在运行") || WgsEngine.IsGameProcessRunning(selectedSteam.GameId))
            {
                if (MessageBox.Show(string.Format("⚠️ 安全防线感知提示：\n\n检测到游戏《{0}》当前正在后台运行中！\n在游戏运行期间强行覆盖或打包存档，可能会导致数据冲突或被游戏云同步重新覆盖。\n\n建议：请先保存并退出游戏后再执行移植。\n\n您确定仍然要强制继续写入移植吗？", selectedSteam.GameTitle), "运行状态冲突警告", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
                {
                    return;
                }
            }

            string sPath = selectedSteam.SteamPath;
            string xPath = selectedSteam.MatchingXboxPath;

            if (string.IsNullOrEmpty(xPath) || !Directory.Exists(xPath))
            {
                using (System.Windows.Forms.FolderBrowserDialog dialog = new System.Windows.Forms.FolderBrowserDialog())
                {
                    dialog.Description = string.Format("请选择{0}的目标 Xbox WGS 目录：", selectedSteam.GameTitle);
                    System.Windows.Forms.DialogResult res = dialog.ShowDialog();
                    if (res == System.Windows.Forms.DialogResult.OK)
                    {
                        xPath = dialog.SelectedPath;
                    }
                    else
                    {
                        return;
                    }
                }
            }

            if (MessageBox.Show(string.Format("确定要将 Steam 端的{0}存档打包并写入 Xbox WGS 容器吗？\n系统将自动在 Backups/ 目录创建 ZIP 压缩包备份。", selectedSteam.GameTitle), "确认移植", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
            {
                // P-04: 耗时写入封装到线程池，防止 UI 卡死
                System.Threading.Tasks.Task.Run(() =>
                {
                    try
                    {
                        string backup = WgsEngine.CreateZipBackup(xPath, selectedSteam.GameId, "xbox");
                        string result = WgsEngine.PackFolderToWgs(sPath, xPath, selectedSteam.GameId);
                        string msg = result;
                        if (!string.IsNullOrEmpty(backup)) msg += string.Format("\n\n[安全防线] 已自动生成压缩包备份:\n{0}", backup);
                        // P-03: Xbox 写入成功后加入云端同步冲突安全提醒
                        msg += "\n\n⚠️ [云同步安全提醒] 重新打开 Xbox 游戏时，若弹出云同步确认框，请务必选择【使用本地存档 / Use Local Save】，否则云端旧存档可能再次覆盖刚移植好的本地存档！";
                        app.Dispatcher.Invoke(() =>
                        {
                            MessageBox.Show(msg, "移植成功", MessageBoxButton.OK, MessageBoxImage.Information);
                            PerformAutoScan();
                        });
                    }
                    catch (Exception ex)
                    {
                        app.Dispatcher.Invoke(() =>
                            MessageBox.Show(string.Format("移植发生错误: {0}", ex.Message), "错误", MessageBoxButton.OK, MessageBoxImage.Error));
                    }
                });
            }
        }

        private static void ExecuteXboxToSteam()
        {
            if (selectedXbox == null) return;

            if (selectedXbox.GameTitle.Contains("正在运行") || WgsEngine.IsGameProcessRunning(selectedXbox.GameId))
            {
                if (MessageBox.Show(string.Format("⚠️ 安全防线感知提示：\n\n检测到游戏《{0}》当前正在后台运行中！\n在游戏运行期间强行覆盖或打包存档，可能会导致数据冲突或被游戏云同步重新覆盖。\n\n建议：请先保存并退出游戏后再执行移植。\n\n您确定仍然要强制继续写入移植吗？", selectedXbox.GameTitle), "运行状态冲突警告", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
                {
                    return;
                }
            }

            string xPath = selectedXbox.XboxPath;
            string sPath = selectedXbox.MatchingSteamPath;

            if (string.IsNullOrEmpty(sPath) || !Directory.Exists(sPath))
            {
                using (System.Windows.Forms.FolderBrowserDialog dialog = new System.Windows.Forms.FolderBrowserDialog())
                {
                    dialog.Description = string.Format("请选择导出{0}至 Steam 的目标目录：", selectedXbox.GameTitle);
                    System.Windows.Forms.DialogResult res = dialog.ShowDialog();
                    if (res == System.Windows.Forms.DialogResult.OK)
                    {
                        sPath = dialog.SelectedPath;
                    }
                    else
                    {
                        return;
                    }
                }
            }

            if (MessageBox.Show(string.Format("确定要将 Xbox 端的{0}存档提取并覆盖移植至 Steam 吗？\n系统将自动在 Backups/ 目录创建 ZIP 压缩包备份。", selectedXbox.GameTitle), "确认移植", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
            {
                // P-04: 耗时解包写入封装到线程池，防止 UI 卡死
                System.Threading.Tasks.Task.Run(() =>
                {
                    try
                    {
                        string backup = WgsEngine.CreateZipBackup(sPath, selectedXbox.GameId, "steam");
                        string result = WgsEngine.ExtractWgsFolder(xPath, sPath);
                        string msg = result;
                        if (!string.IsNullOrEmpty(backup)) msg += string.Format("\n\n[安全防线] 已自动生成压缩包备份:\n{0}", backup);
                        app.Dispatcher.Invoke(() =>
                        {
                            MessageBox.Show(msg, "移植成功", MessageBoxButton.OK, MessageBoxImage.Information);
                            PerformAutoScan();
                        });
                    }
                    catch (Exception ex)
                    {
                        app.Dispatcher.Invoke(() =>
                            MessageBox.Show(string.Format("移植发生错误: {0}", ex.Message), "错误", MessageBoxButton.OK, MessageBoxImage.Error));
                    }
                });
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Program Entry Point
    // ---------------------------------------------------------------------------
    public static class Program
    {
        [STAThread]
        public static void Main()
        {
            MainWindow.RunApp();
        }
    }
}
