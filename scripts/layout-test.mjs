/**
 * 布局配置自检。
 *
 * 验证三件事：
 *  1) 钳制：越界值被拉回 [min,max]，非数字回落默认值
 *  2) 规整：未知键被丢弃、缺失键补默认、小数取整
 *  3) 服务端白名单：settingsStore 只接受已知键，越界同样被钳制
 *
 * 用 SXSM_DATA_DIR 指向临时目录，不碰用户真实设置。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sxsm-layout-'));
process.env.SXSM_DATA_DIR = tmpDir;

const { DEFAULTS, LAYOUT_LIMITS, writeSettings, readSettings } = await import('../server/settingsStore.js');

// 前端那套纯函数在 .ts 里，node 直接 import 不了；这里镜像同样的常量做交叉校验
const DEFAULT_LAYOUT = DEFAULTS.layout;

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

function clamp(key, value) {
  const [min, max] = LAYOUT_LIMITS[key];
  const n = Number(value);
  // Number.isFinite('280') === false —— 字符串先转数字，再判有限
  if (!Number.isFinite(n)) return DEFAULT_LAYOUT[key];
  return Math.min(max, Math.max(min, Math.round(n)));
}

console.log('布局配置自检');

// ---------- 1) 钳制 ----------
check('下限生效', clamp('sidebarWidth', 10) === LAYOUT_LIMITS.sidebarWidth[0], String(clamp('sidebarWidth', 10)));
check('上限生效', clamp('sidebarWidth', 9999) === LAYOUT_LIMITS.sidebarWidth[1], String(clamp('sidebarWidth', 9999)));
check('区间内原样保留', clamp('sidebarWidth', 300) === 300);
check('小数取整', clamp('topbarHeight', 45.7) === 46, String(clamp('topbarHeight', 45.7)));
check('NaN 回落默认', clamp('contentPadding', NaN) === DEFAULT_LAYOUT.contentPadding);
check('Infinity 回落默认', clamp('logWidth', Infinity) === DEFAULT_LAYOUT.logWidth);
check('字符串数字可解析', clamp('aiListWidth', '280') === 280, String(clamp('aiListWidth', '280')));

// 每个键的下限都必须小于上限，否则配置本身写错了
for (const key of Object.keys(LAYOUT_LIMITS)) {
  const [min, max] = LAYOUT_LIMITS[key];
  check(`区间有效 ${key}`, min < max, `${min} !< ${max}`);
  check(`默认值在区间内 ${key}`, DEFAULT_LAYOUT[key] >= min && DEFAULT_LAYOUT[key] <= max, String(DEFAULT_LAYOUT[key]));
}

// ---------- 2) 服务端白名单 ----------
writeSettings({
  layout: {
    sidebarWidth: 10,          // 越界 → 钳到 180
    topbarHeight: 45.7,        // 小数 → 45
    contentPadding: 'abc',     // 非法 → 保留旧值
    logWidth: 500,             // 合法
    bogusKey: 999,             // 未知键 → 丢弃
  },
});

const saved = readSettings();
check('越界被钳到下限', saved.layout.sidebarWidth === 180, String(saved.layout.sidebarWidth));
check('小数被取整', saved.layout.topbarHeight === 46, String(saved.layout.topbarHeight));
check('非法输入保留旧值', saved.layout.contentPadding === DEFAULT_LAYOUT.contentPadding, String(saved.layout.contentPadding));
check('合法值写入', saved.layout.logWidth === 500, String(saved.layout.logWidth));
check('未知键被丢弃', !('bogusKey' in saved.layout));
check('未提及的键保持默认', saved.layout.aiListWidth === DEFAULT_LAYOUT.aiListWidth);

// ---------- 3) 部分补丁不影响其它字段 ----------
writeSettings({ layout: { logHeight: 400 } });
const after = readSettings();
check('部分补丁只改目标键', after.layout.logHeight === 400 && after.layout.logWidth === 500,
  `logHeight=${after.layout.logHeight} logWidth=${after.layout.logWidth}`);

// ---------- 4) 与 appearance 互不干扰 ----------
writeSettings({ appearance: { theme: 'dark', accent: 'violet' } });
const s2 = readSettings();
check('改外观不动布局', s2.layout.logHeight === 400);
check('改布局不动外观', s2.appearance.theme === 'dark' && s2.appearance.accent === 'violet');

// ---------- 5) 默认值本身合法 ----------
for (const key of Object.keys(DEFAULT_LAYOUT)) {
  const [min, max] = LAYOUT_LIMITS[key];
  check(`默认 ${key} 不越界`, DEFAULT_LAYOUT[key] >= min && DEFAULT_LAYOUT[key] <= max);
}

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

console.log(`\n${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
process.exit(failed === 0 ? 0 : 1);