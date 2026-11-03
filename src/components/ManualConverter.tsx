import React, { useState } from 'react';
import { manualExtractWgs, manualPackWgs, pickFolder } from '../services/api';
import { useToast } from './Toast';
import { Cpu, ArrowDown, ArrowUp, Folder } from 'lucide-react';

interface ManualConverterProps {
 onAddLog: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const ManualConverter: React.FC<ManualConverterProps> = ({ onAddLog }) => {
 const toast = useToast();

 const [extractWgsPath, setExtractWgsPath] = useState('');
 const [extractOutputPath, setExtractOutputPath] = useState('');
 const [packInputPath, setPackInputPath] = useState('');
 const [packTargetWgsPath, setPackTargetWgsPath] = useState('');
 const [packageName, setPackageName] = useState('GamePassSave');

 const [isExtracting, setIsExtracting] = useState(false);
 const [isPacking, setIsPacking] = useState(false);

 const handlePickFolder = async (setter: (v: string) => void) => {
 try {
 const path = await pickFolder();
 if (path) setter(path);
 } catch (err: any) {
 toast(`无法打开文件夹选择器: ${err.message}`, 'error');
 }
 };

 const handleExtract = async () => {
 if (!extractWgsPath || !extractOutputPath) {
 toast('请填写完整的 WGS 目录路径与导出目标目录路径！', 'warning');
 return;
 }

 setIsExtracting(true);
 try {
 const res = await manualExtractWgs(extractWgsPath, extractOutputPath);
 onAddLog(`手动 WGS 解包成功！共解包出 ${res.result.extractedFiles.length} 个文件至 ${extractOutputPath}`, 'success');
 toast(`提取成功！共提取出 ${res.result.extractedFiles.length} 个文件。`, 'success');
 } catch (err: any) {
 onAddLog(`手动 WGS 解包失败: ${err.message}`, 'error');
 toast(`解包失败: ${err.message}`, 'error');
 } finally {
 setIsExtracting(false);
 }
 };

 const handlePack = async () => {
 if (!packInputPath || !packTargetWgsPath) {
 toast('请填写完整的存档目录路径与目标 WGS 目录路径！', 'warning');
 return;
 }

 setIsPacking(true);
 try {
 const res = await manualPackWgs(packInputPath, packTargetWgsPath, packageName);
 onAddLog(`手动 WGS 打包成功！已重新打包容器并写入 containers.index。目标目录: ${packTargetWgsPath}`, 'success');
 toast('打包成功！已在目标目录重构 containers.index 与 Blob 容器文件。', 'success');
 } catch (err: any) {
 onAddLog(`手动 WGS 打包失败: ${err.message}`, 'error');
 toast(`打包失败: ${err.message}`, 'error');
 } finally {
 setIsPacking(false);
 }
 };

 const FolderPickButton = ({ onClick }: { onClick: () => void }) => (
 <button
 onClick={onClick}
 className="px-3 py-2 text-xs font-semibold rounded-card bg-ink-surface/[0.04] hover:bg-ink-surface/[0.08] text-zinc-300 border border-white/[0.08] transition-colors flex items-center gap-1 shrink-0"
 >
 <Folder className="w-3.5 h-3.5" />
 <span>浏览</span>
 </button>
 );

 return (
 <div className="space-y-6">
 
 {/* Description */}
 <div className="glass-panel p-6 rounded-card border border-zinc-800 flex items-center gap-4">
 <div className="w-10 h-10 rounded-card bg-ink-surface/[0.06] border border-white/[0.1] flex items-center justify-center text-zinc-300">
 <Cpu className="w-6 h-6" />
 </div>
 <div>
 <h2 className="font-bold text-base text-white">高级 WGS 工具：容器解包与打包</h2>
 <p className="text-xs text-zinc-400">
 对于未包含在预设数据库中的游戏，直接指定 WGS 目录路径进行通用解包与结构重写。点击"浏览"按钮选择目录，无需手敲路径。
 </p>
 </div>
 </div>

 {/* Grid containing Extract and Pack panels */}
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 
 {/* WGS Extract Panel */}
 <div className="glass-panel p-6 rounded-card border border-zinc-800 space-y-4">
 <div className="flex items-center gap-2 text-sm font-medium text-zinc-300 border-b border-white/[0.07] pb-3">
 <ArrowDown className="w-4 h-4" />
 <span>解包模式 (WGS → 普通存档文件)</span>
 </div>

 <div className="space-y-3 text-xs">
 <div>
 <label className="text-zinc-400 block mb-1 font-medium">源 Xbox WGS 目录 (包含 containers.index)：</label>
 <div className="flex gap-2">
 <input
 type="text"
 placeholder="点击右侧浏览按钮选择目录..."
 value={extractWgsPath}
 onChange={e => setExtractWgsPath(e.target.value)}
 className="flex-1 bg-ink-surface/[0.03] border border-white/[0.08] rounded-card px-3 py-2 font-mono text-[11px] text-zinc-200 focus:outline-none focus:border-white/25"
 />
 <FolderPickButton onClick={() => handlePickFolder(setExtractWgsPath)} />
 </div>
 </div>

 <div>
 <label className="text-zinc-400 block mb-1 font-medium">提取目的输出目录：</label>
 <div className="flex gap-2">
 <input
 type="text"
 placeholder="点击右侧浏览按钮选择目录..."
 value={extractOutputPath}
 onChange={e => setExtractOutputPath(e.target.value)}
 className="flex-1 bg-ink-surface/[0.03] border border-white/[0.08] rounded-card px-3 py-2 font-mono text-[11px] text-zinc-200 focus:outline-none focus:border-white/25"
 />
 <FolderPickButton onClick={() => handlePickFolder(setExtractOutputPath)} />
 </div>
 </div>
 </div>

 <button
 onClick={handleExtract}
 disabled={isExtracting}
 className="w-full py-2.5 text-xs font-bold rounded-card bg-ink-accent hover:bg-ink-accent-hover text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2"
 >
 {isExtracting && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>}
 {isExtracting ? '解包中...' : '解析 containers.index 并提取文件'}
 </button>
 </div>

 {/* WGS Pack Panel */}
 <div className="glass-panel p-6 rounded-card border border-zinc-800 space-y-4">
 <div className="flex items-center gap-2 text-sm font-medium text-zinc-300 border-b border-white/[0.07] pb-3">
 <ArrowUp className="w-4 h-4" />
 <span>打包模式 (普通存档文件 → Xbox WGS 格式)</span>
 </div>

 <div className="space-y-3 text-xs">
 <div>
 <label className="text-zinc-400 block mb-1 font-medium">包含存档文件的本地源目录：</label>
 <div className="flex gap-2">
 <input
 type="text"
 placeholder="点击右侧浏览按钮选择存档目录..."
 value={packInputPath}
 onChange={e => setPackInputPath(e.target.value)}
 className="flex-1 bg-ink-surface/[0.03] border border-white/[0.08] rounded-card px-3 py-2 font-mono text-[11px] text-zinc-200 focus:outline-none focus:border-white/25"
 />
 <FolderPickButton onClick={() => handlePickFolder(setPackInputPath)} />
 </div>
 </div>

 <div>
 <label className="text-zinc-400 block mb-1 font-medium">目标 Xbox WGS 导出目录：</label>
 <div className="flex gap-2">
 <input
 type="text"
 placeholder="点击右侧浏览按钮选择目标目录..."
 value={packTargetWgsPath}
 onChange={e => setPackTargetWgsPath(e.target.value)}
 className="flex-1 bg-ink-surface/[0.03] border border-white/[0.08] rounded-card px-3 py-2 font-mono text-[11px] text-zinc-200 focus:outline-none focus:border-white/25"
 />
 <FolderPickButton onClick={() => handlePickFolder(setPackTargetWgsPath)} />
 </div>
 </div>

 <div>
 <label className="text-zinc-400 block mb-1 font-medium">包名标识 (Package Family Name):</label>
 <input
 type="text"
 value={packageName}
 onChange={e => setPackageName(e.target.value)}
 className="w-full bg-ink-surface/[0.03] border border-white/[0.08] rounded-card px-3 py-2 font-mono text-[11px] text-zinc-200 focus:outline-none focus:border-white/25"
 />
 <p className="text-[10px] text-zinc-500 mt-1">填入 Xbox 包名，可在 Packages 目录下查看，如 DeveloperName.GameName</p>
 </div>
 </div>

 <button
 onClick={handlePack}
 disabled={isPacking}
 className="w-full py-2.5 text-xs font-bold rounded-card bg-ink-accent hover:bg-ink-accent-hover text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2"
 >
 {isPacking && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>}
 {isPacking ? '打包中...' : '构造 Blob 文件并重新写入 containers.index'}
 </button>
 </div>

 </div>

 </div>
 );
};
