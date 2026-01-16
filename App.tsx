import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, Github, LayoutDashboard, Lightbulb, Gavel, 
  AlertCircle, Loader2, ShieldCheck, Settings, 
  BrainCircuit, FolderOpen, Globe, Download, 
  Sparkles, ListFilter, BarChart3
} from 'lucide-react';
import { fetchRepoIssues } from './githubService';
import { parseLocalIssueFiles } from './localFileService';
import { analyzeSingleIssueWithGemini } from './geminiService';
import { analyzeSingleIssueWithGLM } from './glmService';
import { performSemanticMerge } from './mergingService';
import { AnalysisState, AnalysisResult, GithubIssue, ModelType, FeatureRequirement, DesignDecision } from './types';
import FeatureList from './components/FeatureList';
import DecisionList from './components/DecisionList';
import SummaryStats from './components/SummaryStats';

const App: React.FC = () => {
  const [mode, setMode] = useState<'online' | 'local'>('online');
  const [repoPath, setRepoPath] = useState('');
  const [ghToken, setGhToken] = useState(localStorage.getItem('gh_token') || '');
  const [glmKey, setGlmKey] = useState(localStorage.getItem('glm_key') || '');
  const [selectedModel, setSelectedModel] = useState<ModelType>((localStorage.getItem('selected_model') as ModelType) || ModelType.GEMINI);
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState<AnalysisState>(AnalysisState.IDLE);
  const [error, setError] = useState<string | null>(null);
  
  const [rawResult, setRawResult] = useState<AnalysisResult | null>(null);
  const [mergedResult, setMergedResult] = useState<AnalysisResult | null>(null);
  const [viewMode, setViewMode] = useState<'merged' | 'raw'>('merged');

  const [allIssues, setAllIssues] = useState<GithubIssue[]>([]);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('gh_token', ghToken);
    localStorage.setItem('glm_key', glmKey);
    localStorage.setItem('selected_model', selectedModel);
  }, [ghToken, glmKey, selectedModel]);

  const handleOnlineAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPath = repoPath.trim().replace(/^https:\/\/github.com\//, '').replace(/\/$/, '');
    if (!cleanPath.includes('/')) {
      setError('请输入有效的仓库路径 (例如: facebook/react)');
      return;
    }

    try {
      setError(null);
      setStatus(AnalysisState.FETCHING);
      setRawResult(null);
      setMergedResult(null);

      const issues = await fetchRepoIssues(cleanPath, ghToken);
      if (!issues || issues.length === 0) {
        throw new Error('该仓库没有可供分析的 Issue。');
      }
      await startAnalysis(issues);
    } catch (err: any) {
      console.error(err);
      setError(err.message || '分析过程中发生意外错误。');
      setStatus(AnalysisState.ERROR);
    }
  };

  const handleLocalAnalyze = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      setError(null);
      setStatus(AnalysisState.FETCHING);
      setRawResult(null);
      setMergedResult(null);

      const issues = await parseLocalIssueFiles(files);
      if (!issues || issues.length === 0) {
        throw new Error('在所选目录中未找到有效的 Issue 文件。');
      }
      
      await startAnalysis(issues);
    } catch (err: any) {
      console.error(err);
      setError(err.message || '本地文件解析失败。');
      setStatus(AnalysisState.ERROR);
    }
  };

  const startAnalysis = async (issues: GithubIssue[]) => {
    setAllIssues(issues);
    setStatus(AnalysisState.ANALYZING);
    setAnalysisProgress({ current: 0, total: issues.length });
    
    const rawFeatures: FeatureRequirement[] = [];
    const rawDecisions: DesignDecision[] = [];
    let totalComments = 0;

    try {
      issues.forEach(issue => {
        if (issue && issue.comments_data) {
          totalComments += (issue.comments_data.length || 0);
        }
      });

      const CONCURRENCY_LIMIT = 10;
      let finishedCount = 0;
      const iterator = issues.entries();

      const worker = async () => {
        for (const [_, issue] of iterator) {
          try {
            let partial;
            if (selectedModel === ModelType.GEMINI) {
              partial = await analyzeSingleIssueWithGemini(issue);
            } else {
              partial = await analyzeSingleIssueWithGLM(issue, glmKey);
            }

            if (partial?.features && Array.isArray(partial.features)) {
              rawFeatures.push(...partial.features);
            }
            if (partial?.decisions && Array.isArray(partial.decisions)) {
              rawDecisions.push(...partial.decisions);
            }
          } catch (issueErr) {
            console.error(`Error analyzing issue #${issue.number}:`, issueErr);
          } finally {
            finishedCount++;
            setAnalysisProgress({ current: finishedCount, total: issues.length });
          }
        }
      };

      const workers = Array.from({ length: Math.min(CONCURRENCY_LIMIT, issues.length) }, () => worker());
      await Promise.all(workers);
      
      const rawRes: AnalysisResult = {
        features: rawFeatures,
        decisions: rawDecisions,
        stats: {
          totalIssuesAnalyzed: issues.length,
          featureCount: rawFeatures.length,
          decisionCount: rawDecisions.length,
          totalCommentsAnalyzed: totalComments
        }
      };
      setRawResult(rawRes);

      setStatus(AnalysisState.MERGING);
      const merged = await performSemanticMerge(rawFeatures, rawDecisions, selectedModel, glmKey);
      
      setMergedResult({
        features: (merged && Array.isArray(merged.features)) ? merged.features : [],
        decisions: (merged && Array.isArray(merged.decisions)) ? merged.decisions : [],
        stats: {
          ...rawRes.stats,
          featureCount: (merged?.features || []).length,
          decisionCount: (merged?.decisions || []).length
        }
      });

      setStatus(AnalysisState.COMPLETED);
      setViewMode('merged');
    } catch (err: any) {
      setError(err.message || '分析或聚合过程中发生错误。');
      setStatus(AnalysisState.ERROR);
    }
  };

  const currentResult = viewMode === 'merged' ? mergedResult : rawResult;

  const exportReport = () => {
    if (!currentResult) return;

    const timestamp = new Date().toLocaleString();
    const sourceLabel = mode === 'online' ? `GitHub Repository: ${repoPath}` : 'Local Issue Files';
    const viewLabel = viewMode === 'merged' ? '语义聚合视图 (Consolidated)' : '原始逐条视图 (Raw Extracts)';
    
    let md = `# IssueMind 智能分析报告\n\n`;
    md += `> **分析时间**: ${timestamp}\n`;
    md += `> **数据来源**: ${sourceLabel}\n`;
    md += `> **视图模式**: ${viewLabel}\n`;
    md += `> **分析模型**: ${selectedModel.toUpperCase()}\n\n`;
    
    md += `## 1. 分析概览\n\n`;
    md += `- **分析 Issue 总数**: ${currentResult.stats.totalIssuesAnalyzed}\n`;
    md += `- **提取项数量**: ${currentResult.stats.featureCount} 特性 / ${currentResult.stats.decisionCount} 决策\n`;
    md += `- **累计处理评论**: ${currentResult.stats.totalCommentsAnalyzed}\n\n`;

    md += `## 2. 功能特性汇总\n\n`;
    const features = currentResult.features || [];
    if (features.length === 0) {
      md += `*未提取到明确的功能需求。*\n\n`;
    } else {
      features.forEach((f) => {
        md += `### [${f.priority}] ${f.title}\n`;
        md += `**摘要**: ${f.summary}\n`;
        md += `**来源 Issue**: ${(f.sourceIssueNumbers || []).map(n => `#${n}`).join(', ')}\n\n`;
      });
    }

    md += `## 3. 关键设计决策\n\n`;
    const decisions = currentResult.decisions || [];
    if (decisions.length === 0) {
      md += `*未提取到明确的设计决策。*\n\n`;
    } else {
      decisions.forEach((d) => {
        md += `### ${d.topic}\n`;
        md += `**讨论/决策**: ${d.decision}\n`;
        md += `**溯源**: ${(d.sourceIssueNumbers || []).map(n => `#${n}`).join(', ')}\n\n`;
      });
    }

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IssueMind_${viewMode}_${repoPath.replace(/[/\\?%*:|"<>]/g, '-') || 'Local'}_${new Date().getTime()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const progressPercent = analysisProgress.total > 0 
    ? (analysisProgress.current / analysisProgress.total) * 100 
    : 0;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg text-white shadow-lg">
              <LayoutDashboard size={20} />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">
              IssueMind 智能体
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex bg-slate-100 p-1 rounded-xl">
              <button 
                onClick={() => setSelectedModel(ModelType.GEMINI)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${selectedModel === ModelType.GEMINI ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Gemini
              </button>
              <button 
                onClick={() => setSelectedModel(ModelType.GLM)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${selectedModel === ModelType.GLM ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                GLM
              </button>
            </div>
            <button 
              onClick={() => setShowSettings(!showSettings)} 
              className={`p-2 rounded-lg transition-colors ${showSettings ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-100'}`}
              title="配置"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>
        {showSettings && (
          <div className="bg-white border-b border-slate-200 p-6 animate-in slide-in-from-top-2">
            <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                  <ShieldCheck size={14} /> GitHub Token
                </label>
                <input type="password" placeholder="GitHub PAT (可选)" value={ghToken} onChange={(e) => setGhToken(e.target.value)} className="w-full px-4 py-2 border rounded-xl focus:border-indigo-500 focus:outline-none" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                  <BrainCircuit size={14} /> GLM Key
                </label>
                <input type="password" placeholder="智谱 AI API Key" value={glmKey} onChange={(e) => setGlmKey(e.target.value)} className="w-full px-4 py-2 border rounded-xl focus:border-indigo-500 focus:outline-none" />
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        <div className="mb-12 text-center">
          <h2 className="text-4xl font-extrabold text-slate-900 mb-6 tracking-tight">GitHub 讨论深度挖掘智能体</h2>
          <div className="max-w-2xl mx-auto flex flex-col gap-4">
             <div className="flex justify-center mb-2">
                <div className="inline-flex p-1 bg-slate-200 rounded-2xl shadow-inner">
                  <button onClick={() => setMode('online')} className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${mode === 'online' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    <Globe size={16} /> 在线仓库
                  </button>
                  <button onClick={() => setMode('local')} className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${mode === 'local' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    <FolderOpen size={16} /> 本地解析
                  </button>
                </div>
             </div>
             {mode === 'online' ? (
                <form onSubmit={handleOnlineAnalyze} className="relative flex items-center group">
                  <input 
                    type="text" 
                    placeholder="请输入代码库路径 (例如: google/perfetto)" 
                    value={repoPath} 
                    onChange={(e) => setRepoPath(e.target.value)} 
                    disabled={status !== AnalysisState.IDLE && status !== AnalysisState.COMPLETED && status !== AnalysisState.ERROR} 
                    className="w-full pl-6 pr-40 py-4 border-2 rounded-2xl focus:border-indigo-500 outline-none shadow-sm transition-all" 
                  />
                  <button 
                    type="submit" 
                    disabled={status === AnalysisState.ANALYZING || status === AnalysisState.FETCHING || status === AnalysisState.MERGING} 
                    className="absolute right-2 px-6 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:bg-slate-300 shadow-md shadow-indigo-100 transition-all"
                  >
                    {status === AnalysisState.IDLE || status === AnalysisState.COMPLETED || status === AnalysisState.ERROR ? '开始分析' : <Loader2 className="animate-spin" size={20} />}
                  </button>
                </form>
             ) : (
                <button 
                  onClick={() => fileInputRef.current?.click()} 
                  className="py-6 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center gap-2 hover:bg-slate-50 hover:border-indigo-400 transition-all group"
                >
                  <div className="bg-indigo-50 p-3 rounded-full text-indigo-600 group-hover:scale-110 transition-transform">
                    <FolderOpen size={32} />
                  </div>
                  <span className="font-bold text-slate-700">点击选择包含 Issue 导出的文件夹</span>
                  <span className="text-xs text-slate-400">支持分析 .md 或 .txt 格式的本地导出文件</span>
                  <input type="file" ref={fileInputRef} style={{display:'none'}} onChange={handleLocalAnalyze} {...({webkitdirectory: "", directory: ""} as any)} />
                </button>
             )}
          </div>
        </div>

        {(status === AnalysisState.ANALYZING || status === AnalysisState.MERGING) && (
          <div className="flex flex-col items-center py-20 animate-in fade-in">
            <div className="relative mb-6">
              <div className="w-20 h-20 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
                {status === AnalysisState.MERGING ? <Sparkles size={40} className="animate-pulse" /> : <BrainCircuit size={40} className="animate-bounce" />}
              </div>
              <div className="absolute -bottom-1 -right-1 bg-white p-1 rounded-full shadow-lg">
                <Loader2 className="animate-spin text-indigo-600" size={24} />
              </div>
            </div>
            <h3 className="text-xl font-bold text-slate-800">
              {status === AnalysisState.MERGING ? '正在进行跨 Issue 的语义深度聚合...' : '正在利用并发能力逐个解析 Issue...'}
            </h3>
            {status === AnalysisState.ANALYZING && (
              <div className="mt-6 w-full max-w-xs">
                <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wider">
                  <span>进度: {analysisProgress.current} / {analysisProgress.total}</span>
                  <span className="text-indigo-600">并发提取中</span>
                </div>
                <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden shadow-inner">
                  <div className="bg-gradient-to-r from-indigo-500 to-violet-500 h-full transition-all duration-500" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>
            )}
            {status === AnalysisState.MERGING && (
              <p className="text-slate-400 mt-3 text-sm italic">正在消除重复项并合并相似的功能需求与技术决策...</p>
            )}
          </div>
        )}

        {error && (
          <div className="max-w-2xl mx-auto p-4 mb-6 bg-red-50 text-red-700 border border-red-200 rounded-2xl flex items-center gap-3 text-sm animate-in fade-in slide-in-from-top-4">
            <AlertCircle size={20} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {currentResult && status === AnalysisState.COMPLETED && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl w-full sm:w-auto">
                <button 
                  onClick={() => setViewMode('merged')} 
                  className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${viewMode === 'merged' ? 'bg-white shadow-sm text-indigo-600 scale-[1.02]' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Sparkles size={16} /> 语义聚合模式
                </button>
                <button 
                  onClick={() => setViewMode('raw')} 
                  className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${viewMode === 'raw' ? 'bg-white shadow-sm text-indigo-600 scale-[1.02]' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <ListFilter size={16} /> 原始提取模式
                </button>
              </div>
              <button onClick={exportReport} className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-md shadow-emerald-100 transition-all">
                <Download size={18}/> 导出 Markdown 报告
              </button>
            </div>

            <SummaryStats stats={currentResult.stats} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col min-h-[500px]">
                <div className="flex items-center justify-between mb-8 border-b border-slate-50 pb-4">
                  <h3 className="text-xl font-bold flex items-center gap-3 text-slate-800">
                    <div className="p-2 bg-amber-50 text-amber-600 rounded-lg"><Lightbulb /></div>
                    功能特性列表
                  </h3>
                  <span className="bg-slate-50 px-3 py-1 rounded-full text-xs font-bold text-slate-400">
                    {(currentResult.features || []).length} 项
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                  <FeatureList features={currentResult.features || []} repoPath={repoPath} issues={allIssues} />
                </div>
              </div>
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col min-h-[500px]">
                <div className="flex items-center justify-between mb-8 border-b border-slate-50 pb-4">
                  <h3 className="text-xl font-bold flex items-center gap-3 text-slate-800">
                    <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><Gavel /></div>
                    关键设计决策
                  </h3>
                  <span className="bg-slate-50 px-3 py-1 rounded-full text-xs font-bold text-slate-400">
                    {(currentResult.decisions || []).length} 项
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                  <DecisionList decisions={currentResult.decisions || []} repoPath={repoPath} issues={allIssues} />
                </div>
              </div>
            </div>
          </div>
        )}

        {status === AnalysisState.IDLE && !currentResult && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16 max-w-6xl mx-auto opacity-90 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {[
              { 
                icon: <BrainCircuit className="text-indigo-500" />, 
                title: "高并发提取", 
                desc: "智能体以 10 路并发形式深度扫描 Issue 及其评论区，哪怕是上千条对话也能快速梳理出核心技术点。" 
              },
              { 
                icon: <Sparkles className="text-violet-500" />, 
                title: "语义聚合去重", 
                desc: "通过大模型的语义理解能力，自动合并跨 Issue 的重复需求，为您过滤信息噪音，保留最纯净的架构共识。" 
              },
              { 
                icon: <BarChart3 className="text-emerald-500" />, 
                title: "可视化报告", 
                desc: "将碎片化的 GitHub 讨论转化为结构化的 Markdown 报告与可视化统计，支持一键导出以便团队决策使用。" 
              }
            ].map((item, i) => (
              <div key={i} className="p-8 bg-white border border-slate-200 rounded-3xl transition-all duration-300 hover:shadow-xl hover:-translate-y-2 group">
                <div className="mb-6 bg-slate-50 w-14 h-14 rounded-2xl flex items-center justify-center group-hover:bg-indigo-50 transition-colors">
                  {React.cloneElement(item.icon as React.ReactElement, { size: 28 })}
                </div>
                <h4 className="font-bold text-xl mb-3 text-slate-800 group-hover:text-indigo-600 transition-colors">{item.title}</h4>
                <p className="text-slate-500 leading-relaxed text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="mt-auto py-12 border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="bg-slate-100 p-2 rounded-lg text-slate-400">
              <Github size={20} />
            </div>
            <div className="text-sm">
              <p className="font-bold text-slate-700">IssueMind 智能分析平台</p>
              <p className="text-slate-400 text-xs">基于大模型驱动的 GitHub 讨论区挖掘工具 &copy; 2024</p>
            </div>
          </div>
          <div className="flex items-center gap-6 text-xs font-bold uppercase tracking-widest text-slate-400">
            <span className="flex items-center gap-1.5"><BrainCircuit size={14}/> Gemini / GLM-4</span>
            <span className="w-1.5 h-1.5 bg-slate-200 rounded-full hidden sm:block"></span>
            <span className="flex items-center gap-1.5"><Sparkles size={14}/> Semantic Merging Enabled</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;