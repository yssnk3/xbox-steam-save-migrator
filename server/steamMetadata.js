import http from 'http';
import https from 'https';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getSteamEnvironment } from './steamLocator.js';

/**
 * Steam metadata enrichment for the migrator.
 *
 * This machine (and many CN networks) redirects Steam domains to 127.0.0.1 in
 * the hosts file / blocks them outright — plain fetch() would resolve
 * cdn.cloudflare.steamstatic.com to 127.0.0.1 and never load an icon. So we:
 *  1. resolve the real A record with dns.Resolver (bypasses hosts),
 *  2. connect to that IP with SNI servername (works even when hosts is edited),
 *  3. cache the header art on disk so the renderer only ever talks to localhost.
 *
 * Chinese names: store.steampowered.com is usually unreachable on such
 * networks, so the name source is a local AppID→中文名 map, layered over the
 * registry/appmanifest name the scan already produced. If the store API IS
 * reachable, it wins.
 */

const ICON_TTL = 7 * 24 * 60 * 60 * 1000; // 7d on-disk icon cache
const ICON_DIR = path.join(os.tmpdir(), 'steam-xbox-migrator-icons');
const REQ_TIMEOUT = 8000;

// Common game knobs: steamAppId -> 中文名 fallback, used when the live sources
// are unreachable. Only include titles that actually get scanned on this box.
const CN_NAMES = {
  '1794680': '吸血鬼幸存者',
  '597170': '克隆机器人大乱斗',
  '1623730': '幻兽帕鲁',
  '1716750': '星空',
  '1627720': '匹诺曹的谎言',
  '548430': '深岩银河',
  '1551360': '极限竞速：地平线5',
  '1325200': '怪物猎人：崛起',
  '1687950': '女神异闻录5 皇家版',
  '275850': '无人深空',
  '588650': '死亡细胞',
  '1145360': '哈迪斯',
  '367520': '空洞骑士',
  '608980': '茶杯头',
  '1817230': '完美音浪',
  '962130': '禁闭求生',
  '413150': '星露谷物语',
  '1113000': '女神异闻录4 黄金版',
  '2161700': '女神异闻录3 重装版',
  '883710': '生化危机2 重制版',
  '952060': '生化危机3 重制版',
  '255710': '城市：天际线',
  '921570': '八方旅人',
  '847800': '死岛2',
  '1172620': '盗贼之海',
  '1234140': '如龙7',
  '1948280': '土豆兄弟',
  '1030300': '空洞骑士：丝之歌',
  '2149010': '小小梦魇精选版',
  '1057090': '奥日与鬼火意志',
  // Off-library games surfaced by the full-disk Steam scan (no preset entry).
  '1172470': 'Apex 英雄',
  '1446780': '怪物猎人：崛起',
  '222940': '拳皇13 街机版',
  '2358720': '黑神话：悟空',
  '346010': '围攻',
  '431960': '壁纸引擎',
  '477160': '人类一败涂地',
  '571260': '拳皇14 街机版',
  '1943950': '密室逃脱模拟器',
};

function hasCJK(s) {
  return /[\u4e00-\u9fff]/.test(s || '');
}

function isPlaceholderName(s) {
  return /^Steam 游戏/i.test(s || '');
}

/**
 * Resolve a hostname to a real IPv4. Layered because every layer can break
 * independently on CN networks:
 *   1. DoH via AliDNS 223.5.5.5 (plain HTTP + IP literal — needs no DNS
 *      itself, immune to hosts-file hijacks, ~100-300ms),
 *   2. DoH via DNSPod 120.53.53.53 (same idea, different operator),
 *   3. dns.Resolver (queries system-configured DNS servers directly; breaks
 *      when those servers time out on Steam domains — 26s hangs observed).
 * Each layer is hard-capped so a dead path costs seconds, not tens of seconds.
 */
const DOH_TIMEOUT = 3000;

function fetchJsonByIp(ipHost, urlPath, servername, timeout = DOH_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: ipHost, port: 443, path: urlPath, headers: { Host: servername, accept: 'application/dns-json', 'User-Agent': 'Mozilla/5.0' }, servername, timeout },
      (res) => {
        if (res.statusCode >= 400) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function aRecordFromDoh(json) {
  const ans = json && Array.isArray(json.Answer) ? json.Answer : [];
  const a = ans.find(x => x.type === 1 && /^\d+\.\d+\.\d+\.\d+$/.test(x.data || ''));
  return a ? a.data : null;
}

async function dohResolveAli(hostname) {
  const json = await fetchJsonByIp('223.5.5.5', `/resolve?name=${encodeURIComponent(hostname)}&type=A`, 'dns.alidns.com');
  return aRecordFromDoh(json);
}

async function dohResolvePod(hostname) {
  const json = await fetchJsonByIp('120.53.53.53', `/dns-query?name=${encodeURIComponent(hostname)}&type=A`, 'doh.pub');
  return aRecordFromDoh(json);
}

function resolverResolve(hostname, timeout = DOH_TIMEOUT) {
  return new Promise((resolve) => {
    const r = new dns.Resolver();
    const timer = setTimeout(() => { try { r.cancel(); } catch {} resolve(null); }, timeout);
    r.resolve4(hostname, (err, addrs) => {
      clearTimeout(timer);
      resolve(err || !addrs || !addrs.length ? null : addrs[0]);
    });
  });
}

async function resolveRealIpv4(hostname) {
  for (const layer of [dohResolveAli, dohResolvePod, resolverResolve]) {
    try {
      const ip = await layer(hostname);
      if (ip) return ip;
    } catch { /* try the next layer */ }
  }
  return null;
}

/** GET an HTTPS URL by connecting to its real IP with SNI (hosts-proof). */
function httpsGetReal(url, timeout = REQ_TIMEOUT) {
  return new Promise(async (resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error('bad url'));
    }
    const mod = u.protocol === 'http:' ? http : https;
    const ip = await resolveRealIpv4(u.hostname);
    if (!ip) return reject(new Error('dns fail'));
    const req = mod.request(
      {
        host: ip,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        headers: { Host: u.hostname, 'User-Agent': 'Mozilla/5.0' },
        servername: u.protocol === 'https:' ? u.hostname : undefined,
        timeout,
      },
      (res) => {
        if (res.statusCode >= 400) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

/**
 * Best-effort Steam Chinese name for an AppID. Tries the live store API first
 * (needs a network that can reach store.steampowered.com); when that fails,
 * falls back to the local map. Returns null if neither yields a CJK name.
 */
// Negative cache: store.steampowered.com is unreachable on many CN networks
// (connection reset after ~8s). Remember failed lookups so /api/games doesn't
// re-pay that cost on every scan for games missing from the local CN map.
const NEG_TTL = 60 * 60 * 1000; // 1h
const negCache = new Map(); // appId -> expiry

export async function steamCnName(appId) {
  const id = String(appId || '').trim();
  if (!/^\d+$/.test(id)) return null;
  if (CN_NAMES[id]) return CN_NAMES[id];
  if (process.env.STEAM_METADATA_OFFLINE) return null;
  const neg = negCache.get(id);
  if (neg && Date.now() < neg) return null;
  try {
    const buf = await httpsGetReal(
      `https://store.steampowered.com/api/appdetails?appids=${id}&l=schinese&cc=CN`
    );
    const data = JSON.parse(buf.toString('utf8'));
    const nm = data && data[id] && data[id].data && data[id].data.name;
    if (nm && hasCJK(nm)) {
      CN_NAMES[id] = String(nm);
      return CN_NAMES[id];
    }
    negCache.set(id, Date.now() + NEG_TTL); // reachable but no CJK name — don't retry soon
  } catch {
    negCache.set(id, Date.now() + NEG_TTL); // unreachable — don't retry soon
  }
  return null;
}

/**
 * Local icon for a Steam AppID. Sources, in order:
 *   1. This machine's Steam library cache (`<steam>\appcache\librarycache\<id>\
 *      ...library_header.jpg`, plus the legacy flat layout) — offline, instant,
 *      and the ONLY source for games whose CDN assets moved to hashed paths
 *      that cannot be constructed without the (usually blocked) store API.
 *   2. Steam CDN header.jpg via the hosts-proof fetch chain (older listings).
 *   3. Steam CDN shared-domain store_item_assets path (newer listings).
 * The winner is cached on disk. Returns a Buffer or null.
 */
function libraryCacheIcon(appId) {
  try {
    const env = getSteamEnvironment();
    for (const dir of env.steamDirs || []) {
      const base = path.join(dir, 'appcache', 'librarycache', String(appId));
      if (!fs.existsSync(base)) continue;
      // New layout: <appid>/<sha>/library_header.jpg — the sha cannot be
      // derived offline, so just take the first library_header.jpg found.
      try {
        for (const sub of fs.readdirSync(base)) {
          const p = path.join(base, sub, 'library_header.jpg');
          if (fs.existsSync(p) && fs.statSync(p).size > 1000) return fs.readFileSync(p);
        }
      } catch {}
      // Fallback: any image directly under <appid>/ (some layouts differ).
      try {
        for (const sub of fs.readdirSync(base)) {
          const p = path.join(base, sub);
          if (fs.statSync(p).isFile() && /\.(jpg|png)$/i.test(sub) && fs.statSync(p).size > 1000) {
            return fs.readFileSync(p);
          }
        }
      } catch {}
    }
    // Legacy flat layout: librarycache/<appid>_header.jpg
    for (const dir of env.steamDirs || []) {
      for (const name of [`${appId}_header.jpg`, `${appId}_header_capsule.jpg`, `${appId}_library_600x900.jpg`]) {
        const p = path.join(dir, 'appcache', 'librarycache', name);
        if (fs.existsSync(p) && fs.statSync(p).size > 1000) return fs.readFileSync(p);
      }
    }
  } catch { /* no Steam install — CDN path still applies */ }
  return null;
}

export async function steamIconFor(appId) {
  const id = String(appId || '').trim();
  if (!/^\d+$/.test(id)) return null;
  fs.mkdirSync(ICON_DIR, { recursive: true });
  const file = path.join(ICON_DIR, id + '.jpg');
  try {
    if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < ICON_TTL) {
      return fs.readFileSync(file);
    }
  } catch {}

  // 1) Local Steam library cache — offline and immune to CDN path churn.
  const local = libraryCacheIcon(id);
  if (local && local.length > 1000) {
    try { fs.writeFileSync(file, local); } catch {}
    return local;
  }

  // 2) Classic CDN header.
  try {
    const buf = await httpsGetReal(
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`
    );
    if (buf && buf.length > 1000) {
      try { fs.writeFileSync(file, buf); } catch {}
      return buf;
    }
  } catch {
    /* fall through to shared CDN */
  }

  // 3) Newer listings host assets under the shared domain.
  try {
    const buf = await httpsGetReal(
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`
    );
    if (buf && buf.length > 1000) {
      try { fs.writeFileSync(file, buf); } catch {}
      return buf;
    }
  } catch {
    /* unreachable — caller falls back to placeholder */
  }
  return null;
}

/**
 * Post-process scanned games:
 *  1. Route every Steam icon through the local proxy.
 *  2. Upgrade placeholder/English-only names to Chinese via local map / API.
 */
export async function enrichGames(games) {
  for (const g of games) {
    if (g && g.steamAppId && /^\d+$/.test(String(g.steamAppId))) {
      g.iconUrl = `/api/steam-icon/${g.steamAppId}`;
    }
  }

  const needName = games.filter(
    (g) =>
      g &&
      g.steamAppId &&
      /^\d+$/.test(String(g.steamAppId)) &&
      (isPlaceholderName(g.name) || !hasCJK(g.name))
  );

  // Naming is independent per game and I/O-bounded; process sequentially with
  // light concurrency to avoid hammering the store when it IS reachable.
  for (const g of needName) {
    try {
      const cn = await steamCnName(g.steamAppId);
      if (cn) g.name = cn;
    } catch { /* keep fallback name */ }
  }
  return games;
}