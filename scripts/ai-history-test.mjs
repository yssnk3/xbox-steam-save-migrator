/**
 * AI 诊断会话存储自检。
 *
 * 验证 aiHistoryStore 的六条不变量：
 *  1) 旧格式（扁平数组）自动迁移成单轮会话
 *  2) 新建会话 → 列表里能看到
 *  3) 带 sessionId 追加轮次 → 轮数递增，不新建会话
 *  4) 重命名 / 置顶生效，置顶排最前
 *  5) 会话数上限（MAX_SESSIONS）生效，置顶的不被淘汰
 *  6) Markdown 导出包含标题与正文
 *
 * 用 SXSM_DATA_DIR 指向临时目录，不碰用户真实数据。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

// 必须在 import 之前设置：模块加载时就会算出 HISTORY_PATH
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sxsm-ai-history-'));
process.env.SXSM_DATA_DIR = tmpDir;

const { HISTORY_PATH, MAX_SESSIONS } = await import('../server/aiHistoryStore.js');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('AI 会话存储自检');
console.log(`  数据目录：${tmpDir}\n`);

// ---- 1) 旧格式迁移 ----
fs.writeFileSync(
  HISTORY_PATH,
  JSON.stringify([
    {
      id: 'legacy-1',
      createdAt: '2026-11-01T10:00:00.000Z',
      gameName: '幻兽帕鲁',
      direction: 'steam_to_xbox',
      code: 'BYTE_INCOMPATIBLE',
      question: '字节不兼容',
      answer: '原因：两端格式不同\n可能方案：使用外部转换工具',
      model: 'gpt-x',
    },
  ]),
  'utf8',
);

const store = await import('../server/aiHistoryStore.js');
const migrated = store.listAiHistory();
check('旧格式被迁移为单轮会话', migrated.length === 1, `实际 ${migrated.length}`);
check('迁移后保留游戏名', migrated[0]?.title === '幻兽帕鲁', migrated[0]?.title);
check('迁移后保留错误码', migrated[0]?.code === 'BYTE_INCOMPATIBLE', String(migrated[0]?.code));
check('迁移后轮数为 1', migrated[0]?.turnCount === 1, String(migrated[0]?.turnCount));

// ---- 2) 新建会话 ----
const created = store.appendAiHistory({
  context: { gameName: '空洞骑士', code: 'VERIFY_FAILED', error: '落盘校验未通过' },
  answer: '原因：MD5 不符\n可能方案：检查权限\n下一步操作：重新迁移',
  model: 'gpt-x',
});
check('新建会话返回 id', !!created?.id, String(created?.id));

const afterCreate = store.listAiHistory();
check('列表包含新会话', afterCreate.some(s => s.id === created.id));
check('新会话排在最前', afterCreate[0]?.id === created.id, afterCreate[0]?.id);

// ---- 3) 追加轮次 ----
store.appendAiHistory({
  sessionId: created.id,
  context: { gameName: '空洞骑士' },
  question: '那怎么恢复备份？',
  answer: '原因：备份可回滚\n可能方案：打开备份中心',
  model: 'gpt-x',
});
const appended = store.getAiHistoryEntry(created.id);
check('追加后轮数为 2', appended?.turns?.length === 2, String(appended?.turns?.length));
check('追加后仍是同一个会话', store.listAiHistory().filter(s => s.id === created.id).length === 1);
check('追问内容被记录', appended?.turns?.[1]?.question === '那怎么恢复备份？', String(appended?.turns?.[1]?.question));

// ---- 4) 重命名 / 置顶 ----
store.updateAiHistory(created.id, { title: '空洞骑士·校验失败' });
check('重命名生效', store.getAiHistoryEntry(created.id)?.title === '空洞骑士·校验失败');

store.updateAiHistory(created.id, { pinned: true });
const pinnedList = store.listAiHistory();
check('置顶后排最前', pinnedList[0]?.id === created.id, pinnedList[0]?.id);
check('置顶标记为 true', pinnedList[0]?.pinned === true);

// ---- 5) 会话数上限 ----
// 造 MAX_SESSIONS + 5 个普通会话，置顶的那个必须还在
for (let i = 0; i < MAX_SESSIONS + 5; i++) {
  store.appendAiHistory({
    context: { gameName: `游戏${i}` },
    answer: `回答${i}`,
    model: 'gpt-x',
  });
}
const capped = store.listAiHistory();
check(`会话数被裁剪到 ${MAX_SESSIONS}`, capped.length === MAX_SESSIONS, `实际 ${capped.length}`);
check('置顶会话未被淘汰', capped.some(s => s.id === created.id));

// ---- 6) 导出 Markdown ----
const md = store.exportAiSessionMarkdown(store.getAiHistoryEntry(created.id));
check('导出包含标题', md.includes('# 空洞骑士·校验失败'), md.slice(0, 60));
check('导出包含正文', md.includes('落盘校验未通过'));
check('导出包含追问', md.includes('那怎么恢复备份？'));

// ---- 7) 删除 / 清空 ----
check('删除返回 true', store.deleteAiHistory(created.id) === true);
check('删除后不再存在', store.getAiHistoryEntry(created.id) === null);
store.clearAiHistory();
check('清空后列表为空', store.listAiHistory().length === 0);

// 清理临时目录
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

console.log(`\n${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
process.exit(failed === 0 ? 0 : 1);
