/**
 * Privacy regression: no full local path may reach the AI prompt.
 * The README promises only the last two path segments are sent; error strings
 * and log lines used to bypass maskPath because they are free text.
 */
import { buildUserMessage } from '../server/aiAssistant.js';

const P = 'C:\\Users\\nsejx\\Documents\\Steam\\userdata\\123\\remote';
const X = 'C:\\Users\\nsejx\\AppData\\Local\\Packages\\Foo\\SystemAppData\\wgs\\0009';
const prompt = buildUserMessage(
  {
    stage: 'POST /api/migrate',
    error: `未找到 Steam 存档目录：${P}`,
    gameName: '测试游戏',
    warnings: [`检测到 ${X} 云同步冲突`],
    verify: { ok: false, note: `目标 ${X} 校验失败`, targetPath: X },
    steamPath: P,
    xboxPath: X,
  },
  [{ type: 'info', message: `[落盘校验] 已安装至：${X}` }],
);

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); failures++; }
};

console.log('\n========== AI prompt path masking ==========');
check('error 中的完整路径被脱敏', !prompt.includes('C:\\Users\\nsejx'), prompt.slice(-200));
check('warnings 中的完整路径被脱敏', !prompt.includes(P));
check('log 中的完整路径被脱敏', !prompt.includes(X));
check('verify.note 中的完整路径被脱敏', !prompt.includes('目标 ' + X));
check('仍保留可用的末两级路径', prompt.includes('…\\'), prompt.slice(-200));
check('保留错误语义', prompt.includes('未找到 Steam 存档目录'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
