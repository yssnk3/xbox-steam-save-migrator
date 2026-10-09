import os
import sys
import json
import struct
import uuid
import time
import zipfile
import shutil
import re
import tkinter as tk
from tkinter import ttk, messagebox, filedialog

# ---------------------------------------------------------------------------
# WGS Binary Engine
# ---------------------------------------------------------------------------

def read_utf16_str(f):
    try:
        length_bytes = f.read(4)
        if len(length_bytes) < 4:
            return ""
        char_len = struct.unpack("<i", length_bytes)[0]
        if char_len <= 0:
            return ""
        str_bytes = f.read(char_len * 2)
        return str_bytes.decode("utf-16le", errors="ignore").rstrip("\0")
    except Exception:
        return ""

def write_utf16_bytes(s):
    encoded = s.encode("utf-16le")
    char_count = len(encoded) // 2
    return struct.pack("<i", char_count) + encoded

def parse_containers_index(index_path):
    if not os.path.exists(index_path):
        raise FileNotFoundError(f"containers.index file not found: {index_path}")

    with open(index_path, "rb") as f:
        buf = f.read()

    if len(buf) < 8:
        raise ValueError("containers.index is too small or invalid")

    offset = 0
    format_version = struct.unpack_from("<i", buf, offset)[0]
    offset += 4
    container_count = struct.unpack_from("<i", buf, offset)[0]
    offset += 4

    char_len = struct.unpack_from("<i", buf, offset)[0]
    offset += 4
    pkg_name = ""
    if char_len > 0:
        pkg_name = buf[offset:offset+char_len*2].decode("utf-16le", errors="ignore").rstrip("\0")
        offset += char_len * 2

    containers = []
    for _ in range(container_count):
        if offset >= len(buf):
            break
        name_len = struct.unpack_from("<i", buf, offset)[0]
        offset += 4
        c_name = buf[offset:offset+name_len*2].decode("utf-16le", errors="ignore").rstrip("\0")
        offset += name_len * 2

        cloud_len = struct.unpack_from("<i", buf, offset)[0]
        offset += 4
        cloud_name = buf[offset:offset+cloud_len*2].decode("utf-16le", errors="ignore").rstrip("\0")
        offset += cloud_len * 2

        seq_idx = buf[offset]
        offset += 1

        guid_bytes = buf[offset:offset+16]
        guid_hex = guid_bytes.hex().upper()
        offset += 16

        filetime, size = struct.unpack_from("<qi", buf, offset)
        offset += 16

        containers.append({
            "containerName": c_name,
            "cloudName": cloud_name,
            "guidHex": guid_hex,
            "size": size,
            "filetime": filetime
        })

    return {
        "formatVersion": format_version,
        "containerCount": len(containers),
        "packageName": pkg_name,
        "containers": containers
    }

def extract_wgs_folder(wgs_folder_path, output_folder_path):
    index_path = os.path.join(wgs_folder_path, "containers.index")
    index_data = parse_containers_index(index_path)

    os.makedirs(output_folder_path, exist_ok=True)
    extracted = []

    for container in index_data["containers"]:
        c_dir = os.path.join(wgs_folder_path, container["guidHex"])
        if not os.path.exists(c_dir):
            continue

        entries = os.listdir(c_dir)
        manifest = next((e for e in entries if e.startswith("container.") or e == "container"), None)

        if manifest:
            m_path = os.path.join(c_dir, manifest)
            with open(m_path, "rb") as mf:
                m_buf = mf.read()
            if len(m_buf) >= 8:
                m_off = 4
                f_count = struct.unpack_from("<i", m_buf, m_off)[0]
                m_off += 4
                for _ in range(f_count):
                    f_name_len = struct.unpack_from("<i", m_buf, m_off)[0]
                    m_off += 4
                    f_name = m_buf[m_off:m_off+f_name_len*2].decode("utf-16le", errors="ignore").rstrip("\0")
                    m_off += f_name_len * 2
                    blob_guid = m_buf[m_off:m_off+16].hex().upper()
                    m_off += 16

                    blob_path = os.path.join(c_dir, blob_guid)
                    if os.path.exists(blob_path):
                        dest_path = os.path.join(output_folder_path, f_name or f"{container['containerName']}.sav")
                        shutil.copy2(blob_path, dest_path)
                        extracted.append(dest_path)
        else:
            blobs = [e for e in entries if len(e) == 32]
            for idx, b in enumerate(blobs):
                dest = os.path.join(output_folder_path, f"{container['containerName']}_{idx}.sav")
                shutil.copy2(os.path.join(c_dir, b), dest)
                extracted.append(dest)

    return extracted

def pack_folder_to_wgs(input_folder_path, target_wgs_path, package_name="GamePassSave"):
    os.makedirs(target_wgs_path, exist_ok=True)
    files = [f for f in os.listdir(input_folder_path) if os.path.isfile(os.path.join(input_folder_path, f))]

    containers = []
    for f_name in files:
        src_path = os.path.join(input_folder_path, f_name)
        c_guid = uuid.uuid4().hex.upper()
        b_guid = uuid.uuid4().hex.upper()

        c_dir = os.path.join(target_wgs_path, c_guid)
        os.makedirs(c_dir, exist_ok=True)

        blob_path = os.path.join(c_dir, b_guid)
        shutil.copy2(src_path, blob_path)

        c_manifest = os.path.join(c_dir, "container.1")
        m_buf = bytearray()
        m_buf.extend(struct.pack("<i", 4))
        m_buf.extend(struct.pack("<i", 1))
        m_buf.extend(write_utf16_bytes(f_name))
        m_buf.extend(bytes.fromhex(b_guid))

        with open(c_manifest, "wb") as mf:
            mf.write(m_buf)

        f_size = os.path.getsize(src_path)
        c_name = os.path.splitext(f_name)[0]

        containers.append({
            "containerName": c_name,
            "cloudName": f_name,
            "guidHex": c_guid,
            "size": f_size
        })

    idx_buf = bytearray()
    idx_buf.extend(struct.pack("<i", 4))
    idx_buf.extend(struct.pack("<i", len(containers)))
    idx_buf.extend(write_utf16_bytes(package_name))

    for c in containers:
        idx_buf.extend(write_utf16_bytes(c["containerName"]))
        idx_buf.extend(write_utf16_bytes(c["cloudName"]))
        idx_buf.append(1)
        idx_buf.extend(bytes.fromhex(c["guidHex"]))
        filetime = int(time.time() * 10000000 + 116444736000000000)
        idx_buf.extend(struct.pack("<qi", filetime, c["size"]))

    with open(os.path.join(target_wgs_path, "containers.index"), "wb") as f:
        f.write(idx_buf)

    return len(containers)

def create_zip_backup(source_folder, game_id, platform):
    if not os.path.exists(source_folder):
        return None
    backup_dir = os.path.join(os.getcwd(), "Backups")
    os.makedirs(backup_dir, exist_ok=True)

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    zip_name = f"backup_{game_id}_{platform}_{timestamp}.zip"
    zip_path = os.path.join(backup_dir, zip_name)

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(source_folder):
            for file in files:
                full_p = os.path.join(root, file)
                rel_p = os.path.relpath(full_p, source_folder)
                zf.write(full_p, rel_p)

    return zip_path

# ---------------------------------------------------------------------------
# Presets Database & Game Detector
# ---------------------------------------------------------------------------

PRESET_GAMES = [
    { "id": "palworld", "name": "《幻兽帕鲁》(Palworld)", "steamRel": r"%LOCALAPPDATA%\Pal\Saved\SaveGames", "xboxPkg": "PocketpairInc.Palworld_*" },
    { "id": "starfield", "name": "《星空》(Starfield)", "steamRel": r"%USERPROFILE%\Documents\My Games\Starfield\Saves", "xboxPkg": "BethesdaSoftworks.ProjectGold_*" },
    { "id": "lies-of-p", "name": "《匹诺曹的谎言》(Lies of P)", "steamRel": r"%APPDATA%\Neowiz\Lies of P\Saved\SaveGames", "xboxPkg": "NEOWIZ.LiesofP_*" },
    { "id": "deep-rock-galactic", "name": "《深岩银河》(Deep Rock Galactic)", "steamRel": r"%LOCALAPPDATA%\FSD\Saved\SaveGames", "xboxPkg": "CoffeeStainPublishing.DeepRockGalactic_*" },
    { "id": "forza-horizon-5", "name": "《极限竞速：地平线5》(Forza Horizon 5)", "steamRel": r"%LOCALAPPDATA%\ForzaHorizon5\User_Data", "xboxPkg": "Microsoft.624F8B84B80_*" },
    { "id": "monster-hunter-rise", "name": "《怪物猎人：崛起》(Monster Hunter Rise)", "steamRel": r"%LOCALAPPDATA%\CAPCOM\MonsterHunterRise", "xboxPkg": "CAPCOM.MonsterHunterRise_*" },
    { "id": "persona-5-royal", "name": "《女神异闻录5 皇家版》(Persona 5 Royal)", "steamRel": r"%APPDATA%\SEGA\P5R\Steam", "xboxPkg": "SEGAofAmericaInc.F0CDA2EB77_*" },
    { "id": "no-mans-sky", "name": "《无人深空》(No Man's Sky)", "steamRel": r"%APPDATA%\HelloGames\NMS", "xboxPkg": "HelloGames.NoMansSky_*" },
    { "id": "sea-of-thieves", "name": "《盗贼之海》(Sea of Thieves)", "steamRel": r"%LOCALAPPDATA%\Athena\Saved\SaveGames", "xboxPkg": "Microsoft.SeaofThieves_*" },
    { "id": "yakuza-7", "name": "《如龙7：光与暗的去向》(Yakuza 7)", "steamRel": r"%APPDATA%\SEGA\YakuzaLikeADragon", "xboxPkg": "SEGAofAmericaInc.YakuzaLikeADragon_*" }
]

KNOWN_PACKAGE_TITLES = {
    "pocketpairinc.palworld": "《幻兽帕鲁 (Palworld)》",
    "bethesdasoftworks.projectgold": "《星空 (Starfield)》",
    "neowiz.liesofp": "《匹诺曹的谎言 (Lies of P)》",
    "coffeestainpublishing.deeprockgalactic": "《深岩银河 (Deep Rock Galactic)》",
    "microsoft.624f8b84b80": "《极限竞速：地平线5 (Forza Horizon 5)》",
    "capcom.monsterhunterrise": "《怪物猎人：崛起 (Monster Hunter Rise)》",
    "segaofamericainc.f0cda2eb77": "《女神异闻录5 皇家版 (Persona 5 Royal)》",
    "hellogames.nomanssky": "《无人深空 (No Man's Sky)》",
    "microsoft.seaofthieves": "《盗贼之海 (Sea of Thieves)》",
    "segaofamericainc.yakuzalikeadragon": "《如龙7：光与暗的去向 (Yakuza 7)》"
}

def resolve_friendly_game_title(pkg_name):
    clean_base = pkg_name.split("_")[0].lower()
    if clean_base in KNOWN_PACKAGE_TITLES:
        return KNOWN_PACKAGE_TITLES[clean_base]
    parts = pkg_name.split("_")[0].split(".")
    raw_title = parts[-1] if len(parts) > 1 else parts[0]
    formatted_title = re.sub(r'([a-z])([A-Z])', r'\1 \2', raw_title)
    return f"《{formatted_title}》"

def resolve_path(p):
    return os.path.expandvars(p)

def find_xbox_wgs(pkg_pattern):
    local_appdata = os.environ.get("LOCALAPPDATA", "")
    packages_dir = os.path.join(local_appdata, "Packages")
    if not os.path.exists(packages_dir):
        return None

    regex = re.compile("^" + pkg_pattern.replace("*", ".*") + "$", re.IGNORECASE)
    for pkg in os.listdir(packages_dir):
        if regex.match(pkg):
            wgs_dir = os.path.join(packages_dir, pkg, "SystemAppData", "wgs")
            if os.path.exists(wgs_dir):
                for sub in os.listdir(wgs_dir):
                    sub_p = os.path.join(wgs_dir, sub)
                    if os.path.isdir(sub_p) and os.path.exists(os.path.join(sub_p, "containers.index")):
                        return sub_p
    return None

def scan_all_local_saves_split():
    """Scans and returns separate lists for Steam saves and Xbox saves."""
    steam_list = []
    xbox_list = []
    
    for game in PRESET_GAMES:
        steam_p = resolve_path(game["steamRel"])
        steam_exists = os.path.exists(steam_p)
        xbox_p = find_xbox_wgs(game["xboxPkg"])
        xbox_exists = bool(xbox_p)

        if steam_exists:
            mtime = time.strftime("%m-%d %H:%M", time.localtime(os.path.getmtime(steam_p)))
            steam_list.append({
                "game_title": game["name"],
                "game_id": game["id"],
                "steam_path": steam_p,
                "mtime": mtime,
                "matching_xbox_path": xbox_p if xbox_exists else ""
            })

        if xbox_exists:
            idx_p = os.path.join(xbox_p, "containers.index")
            mtime = time.strftime("%m-%d %H:%M", time.localtime(os.path.getmtime(idx_p)))
            xbox_list.append({
                "game_title": game["name"],
                "game_id": game["id"],
                "xbox_path": xbox_p,
                "mtime": mtime,
                "matching_steam_path": steam_p if steam_exists else ""
            })

    # Deep scan Packages for unlisted Xbox saves
    local_appdata = os.environ.get("LOCALAPPDATA", "")
    packages_dir = os.path.join(local_appdata, "Packages")
    if os.path.exists(packages_dir):
        existing_ids = {x["game_id"] for x in xbox_list}
        for pkg in os.listdir(packages_dir):
            clean_base = pkg.split("_")[0].lower()
            if any(eid in clean_base for eid in existing_ids):
                continue
            wgs_dir = os.path.join(packages_dir, pkg, "SystemAppData", "wgs")
            if os.path.exists(wgs_dir):
                for sub in os.listdir(wgs_dir):
                    sub_p = os.path.join(wgs_dir, sub)
                    if os.path.isdir(sub_p) and os.path.exists(os.path.join(sub_p, "containers.index")):
                        friendly_title = resolve_friendly_game_title(pkg)
                        idx_p = os.path.join(sub_p, "containers.index")
                        mtime = time.strftime("%m-%d %H:%M", time.localtime(os.path.getmtime(idx_p)))
                        xbox_list.append({
                            "game_title": friendly_title,
                            "game_id": clean_base,
                            "xbox_path": sub_p,
                            "mtime": mtime,
                            "matching_steam_path": ""
                        })
                        break

    return steam_list, xbox_list

# ---------------------------------------------------------------------------
# Two-Column Side-by-Side Split GUI
# ---------------------------------------------------------------------------

class TwoColumnAppGUI(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Steam ↔ Xbox PC 游戏存档双栏极简分列移植工具 Pro")
        self.geometry("1100x720")
        self.configure(bg="#0f172a")

        self.style = ttk.Style(self)
        self.style.theme_use("clam")

        self.style.configure("Treeview.Heading", font=("Microsoft YaHei", 9.5, "bold"), background="#1e293b", foreground="#38bdf8")
        self.style.configure("Treeview", font=("Microsoft YaHei", 9), rowheight=30, background="#0f172a", fieldbackground="#0f172a", foreground="#f8fafc")
        self.style.map("Treeview", background=[("selected", "#0284c7")], foreground=[("selected", "#ffffff")])

        self.steam_records = []
        self.xbox_records = []
        self.selected_steam_item = None
        self.selected_xbox_item = None

        self.create_ui()
        self.auto_scan_on_launch()

    def create_ui(self):
        # Header
        header = tk.Frame(self, bg="#1e293b", height=75)
        header.pack(fill="x", side="top")
        
        lbl_title = tk.Label(
            header, 
            text="⚡ Steam ↔ Xbox 游戏存档双栏极简分列移植工具", 
            font=("Segoe UI", 15, "bold"), 
            bg="#1e293b", 
            fg="#38bdf8"
        )
        lbl_title.pack(side="left", padx=20, pady=10)

        lbl_subtitle = tk.Label(
            header,
            text="左栏：Steam 本地存档    |    右栏：Xbox WGS 容器存档    |    选中任一侧直接一键双向移植",
            font=("Microsoft YaHei", 9),
            bg="#1e293b",
            fg="#94a3b8"
        )
        lbl_subtitle.pack(side="left", padx=5, pady=16)

        btn_rescan = tk.Button(
            header,
            text="🔄 重新全盘检索双端存档",
            font=("Microsoft YaHei", 9.5, "bold"),
            bg="#0284c7",
            fg="#ffffff",
            relief="flat",
            padx=14,
            pady=5,
            command=self.auto_scan_on_launch
        )
        btn_rescan.pack(side="right", padx=20)

        # Main Split Frame (Two Columns)
        main_split = tk.Frame(self, bg="#0f172a")
        main_split.pack(fill="both", expand=True, padx=15, pady=10)

        # LEFT COLUMN: STEAM SAVES
        left_box = tk.LabelFrame(
            main_split,
            text=" 🔹 Steam 端已就绪存档列表 (Steam Local Saves) ",
            font=("Microsoft YaHei", 10, "bold"),
            fg="#38bdf8",
            bg="#0f172a",
            bd=1,
            relief="solid",
            padx=10,
            pady=10
        )
        left_box.pack(side="left", fill="both", expand=True, padx=(0, 7))

        self.tree_steam = ttk.Treeview(left_box, columns=("title", "mtime", "path"), show="headings")
        self.tree_steam.heading("title", text="🎮 游戏名称")
        self.tree_steam.heading("mtime", text="🕒 修改时间")
        self.tree_steam.heading("path", text="📁 存档路径")

        self.tree_steam.column("title", width=160)
        self.tree_steam.column("mtime", width=90)
        self.tree_steam.column("path", width=220)
        self.tree_steam.pack(fill="both", expand=True, pady=5)
        self.tree_steam.bind("<<TreeviewSelect>>", self.on_steam_select)

        self.btn_s2x = tk.Button(
            left_box,
            text="➡️ 打包此 Steam 存档 ➔ 移植至 Xbox",
            font=("Microsoft YaHei", 10, "bold"),
            bg="#0284c7",
            fg="#ffffff",
            state="disabled",
            pady=8,
            command=self.execute_steam_to_xbox
        )
        self.btn_s2x.pack(fill="x", pady=(5, 0))

        # RIGHT COLUMN: XBOX SAVES
        right_box = tk.LabelFrame(
            main_split,
            text=" 🟢 Xbox PC 端已就绪 WGS 容器存档列表 (Xbox WGS Saves) ",
            font=("Microsoft YaHei", 10, "bold"),
            fg="#34d399",
            bg="#0f172a",
            bd=1,
            relief="solid",
            padx=10,
            pady=10
        )
        right_box.pack(side="right", fill="both", expand=True, padx=(7, 0))

        self.tree_xbox = ttk.Treeview(right_box, columns=("title", "mtime", "path"), show="headings")
        self.tree_xbox.heading("title", text="🎮 游戏名称")
        self.tree_xbox.heading("mtime", text="🕒 修改时间")
        self.tree_xbox.heading("path", text="📁 WGS 容器路径")

        self.tree_xbox.column("title", width=160)
        self.tree_xbox.column("mtime", width=90)
        self.tree_xbox.column("path", width=220)
        self.tree_xbox.pack(fill="both", expand=True, pady=5)
        self.tree_xbox.bind("<<TreeviewSelect>>", self.on_xbox_select)

        self.btn_x2s = tk.Button(
            right_box,
            text="⬅️ 提取此 Xbox 存档 ➔ 移植至 Steam",
            font=("Microsoft YaHei", 10, "bold"),
            bg="#059669",
            fg="#ffffff",
            state="disabled",
            pady=8,
            command=self.execute_xbox_to_steam
        )
        self.btn_x2s.pack(fill="x", pady=(5, 0))

        # Bottom Summary Bar
        self.lbl_summary = tk.Label(
            self,
            text="正在扫描全盘双端存档...",
            font=("Microsoft YaHei", 9.5, "bold"),
            fg="#34d399",
            bg="#0f172a"
        )
        self.lbl_summary.pack(side="bottom", pady=8)

    def auto_scan_on_launch(self):
        for item in self.tree_steam.get_children(): self.tree_steam.delete(item)
        for item in self.tree_xbox.get_children(): self.tree_xbox.delete(item)

        self.steam_records, self.xbox_records = scan_all_local_saves_split()

        for idx, item in enumerate(self.steam_records):
            self.tree_steam.insert("", "end", values=(item["game_title"], item["mtime"], item["steam_path"]), iid=f"s_{idx}")

        for idx, item in enumerate(self.xbox_records):
            self.tree_xbox.insert("", "end", values=(item["game_title"], item["mtime"], item["xbox_path"]), iid=f"x_{idx}")

        self.lbl_summary.config(
            text=f"🎉 双栏全盘自动检索完成！已找到 {len(self.steam_records)} 个 Steam 存档（左栏），{len(self.xbox_records)} 个 Xbox WGS 存档（右栏）。选中对应行即可一键同步！"
        )

    def on_steam_select(self, event):
        sel = self.tree_steam.selection()
        if sel:
            idx = int(sel[0].replace("s_", ""))
            if idx < len(self.steam_records):
                self.selected_steam_item = self.steam_records[idx]
                self.btn_s2x.config(state="normal")
                return
        self.btn_s2x.config(state="disabled")

    def on_xbox_select(self, event):
        sel = self.tree_xbox.selection()
        if sel:
            idx = int(sel[0].replace("x_", ""))
            if idx < len(self.xbox_records):
                self.selected_xbox_item = self.xbox_records[idx]
                self.btn_x2s.config(state="normal")
                return
        self.btn_x2s.config(state="disabled")

    def execute_steam_to_xbox(self):
        if not self.selected_steam_item: return
        item = self.selected_steam_item
        sPath = item["steam_path"]
        xPath = item["matching_xbox_path"]

        if not xPath or not os.path.exists(xPath):
            xPath = filedialog.askdirectory(title=f"请选择{item['game_title']}的目标 Xbox WGS 文件夹：")
            if not xPath: return

        if messagebox.askyesno("确认一键移植", f"确定要将 Steam 端的{item['game_title']}存档打包并写入 Xbox WGS 容器吗？\n系统将自动在 Backups/ 目录创建安全 ZIP 备份。"):
            try:
                zip_b = create_zip_backup(xPath, item["game_id"], "xbox")
                count = pack_folder_to_wgs(sPath, xPath, item["game_id"])
                msg = f"🎉 移植成功！已成功打包 Steam 存档并写入 Xbox WGS 目录：\n{xPath}"
                if zip_b: msg += f"\n\n[安全防线] 已自动创建备份归档：\n{zip_b}"
                messagebox.showinfo("移植成功", msg)
                self.auto_scan_on_launch()
            except Exception as e:
                messagebox.showerror("移植失败", str(e))

    def execute_xbox_to_steam(self):
        if not self.selected_xbox_item: return
        item = self.selected_xbox_item
        xPath = item["xbox_path"]
        sPath = item["matching_steam_path"]

        if not sPath or not os.path.exists(sPath):
            sPath = filedialog.askdirectory(title=f"请选择导出{item['game_title']}至 Steam 的目标文件夹：")
            if not sPath: return

        if messagebox.askyesno("确认一键移植", f"确定要将 Xbox 端的{item['game_title']}存档提取并覆盖移植至 Steam 吗？\n系统将自动在 Backups/ 目录创建安全 ZIP 备份。"):
            try:
                zip_b = create_zip_backup(sPath, item["game_id"], "steam")
                extracted = extract_wgs_folder(xPath, sPath)
                msg = f"🎉 移植成功！已成功提取并写入 {len(extracted)} 个文件至 Steam 目录：\n{sPath}"
                if zip_b: msg += f"\n\n[安全防线] 已自动创建备份归档：\n{zip_b}"
                messagebox.showinfo("移植成功", msg)
                self.auto_scan_on_launch()
            except Exception as e:
                messagebox.showerror("移植失败", str(e))

if __name__ == "__main__":
    app = TwoColumnAppGUI()
    app.mainloop()
