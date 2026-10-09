/**
 * Friendly error message mapping — translates raw Node fs errors into
 * Chinese user-facing messages with actionable guidance.
 */

const ERROR_MAP = [
  { test: /ENOENT/i, message: '目录或文件不存在。请检查路径是否正确，或游戏是否已安装。' },
  { test: /EACCES|EPERM/i, message: '权限不足。请尝试以管理员身份运行本工具，或将工具移动到非系统保护目录。' },
  { test: /EBUSY/i, message: '文件被其他程序占用。请确保游戏已完全退出后重试。' },
  { test: /ELOCKED/i, message: '文件被锁定。游戏可能仍在运行，请完全关闭游戏后重试。' },
  { test: /ENOSPC|ENODISK/i, message: '磁盘空间不足。请清理目标盘符后重试。' },
  { test: /EADDRINUSE/i, message: '端口 3001 已被占用。请关闭其他正在运行的本工具实例后重试。' },
  { test: /containers\.index/i, message: '未找到 containers.index。指定的目录可能不是有效的 Xbox WGS 存档目录。' },
  { test: /not a valid wgs/i, message: '目录结构不符合 WGS 格式规范。' },
];

export function friendlyError(err) {
  if (!err) return '未知错误';
  const raw = err.message || String(err);
  for (const { test, message } of ERROR_MAP) {
    if (test.test(raw)) return `${message}（原始信息：${raw}）`;
  }
  return raw;
}
