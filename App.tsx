
import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, Github, LayoutDashboard, Lightbulb, Gavel, 
  AlertCircle, Loader2, ShieldCheck, Settings, 
  BrainCircuit, FolderOpen, Globe, Download, 
  Sparkles, ListFilter, BarChart3, ChevronDown, Key, ExternalLink, Cpu
} from 'lucide-react';
import { fetchRepoIssues } from './githubService.ts';
import { parseLocalIssueFiles } from './localFileService.ts';
import { analyzeSingleIssueWithGemini } from './geminiService.ts';
import { analyzeSingleIssueWithGLM } from './glmService.ts';
import { analyzeSingleIssueWithMiniMax } from './minimaxService.ts';
import { analyzeSingleIssueWithOpenAI } from './openaiService.ts';
import { performSemanticMerge } from './mergingService.ts';
import { AnalysisState, AnalysisResult, GithubIssue, ModelType, FeatureRequirement, DesignDecision } from './types.ts';
import FeatureList from './components/FeatureList.tsx';
import DecisionList from './components/DecisionList.tsx';
import SummaryStats from './components/SummaryStats.tsx';

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

const App: React.FC = () => {
  const [mode, setMode] = useState<'online' | 'local'>('online');
  const [repoPath, setRepoPath] = useState('');
  const [ghToken, setGhToken] = useState(localStorage.getItem('gh_token') || '');
  const [glmKey, setGlmKey] = useState(localStorage.getItem('glm_key') || '');
  const [minimaxKey, setMinimaxKey] = useState(localStorage.getItem('minimax_key') || '');
  const [openaiKey, setOpenaiKey] = useState(localStorage.getItem('openai_key') || '');
  
  const [selectedModel, setSelectedModel] = useState<ModelType>((localStorage.getItem('selected_model') as ModelType) || ModelType.GEMINI);
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState<AnalysisState>(AnalysisState.IDLE);
  const [error, setError] = useState<string | null>(null);
  
  const [rawResult, setRawResult] = useState<AnalysisResult | null>(null);
  const [mergedResult, setMergedResult] = useState<AnalysisResult | null>(null);
  const [viewMode, setViewMode] = useState<'merged' | 'raw'>('merged');

  const [allIssues, setAllIssues] = useState<GithubIssue[]>([]);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('gh_token', ghToken);
    localStorage.setItem('glm_key', glmKey);
    localStorage.setItem('minimax_key', minimaxKey);
    localStorage.setItem('openai_key', openaiKey);
    localStorage.setItem('selected_model', selectedModel);
  }, [ghToken, glmKey, minimaxKey, openaiKey, selectedModel]);

  useEffect(() => {
    const checkKey = async () => {
      // @ts-ignore
      if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasGeminiKey(hasKey);
      }
    };
    checkKey();
    const interval = setInterval(checkKey, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleSelectGeminiKey = async () => {
    try {
      // @ts-ignore
      if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
        await window.aistudio.openSelectKey();
        setHasGeminiKey(true);
      }
    } catch (e) {
      console.error("Failed to open key selection", e);
    }
  };

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

  const callWithRetry = async (fn: () => Promise<any>, maxRetries = 3) => {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const errStr = String(err);
        const isRateLimit = errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED') || err.status === 429;
        
        if (isRateLimit && i < maxRetries - 1) {
          const waitTime = Math.pow(2, i + 1) * 3000 + Math.random() * 1000;
          await delay(waitTime);
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  };

  const getCurrentKey = () => {
    switch (selectedModel) {
      case ModelType.GLM: return glmKey;
      case ModelType.MINIMAX: return minimaxKey;
      case ModelType.OPENAI: return openaiKey;
      default: return undefined;
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

      const CONCURRENCY_LIMIT = 3;
      let finishedCount = 0;
      const iterator = issues.entries();

      const worker = async () => {
        for (const [_, issue] of iterator) {
          try {
            await delay(Math.random() * 500);

            let partial = await callWithRetry(async () => {
              if (selectedModel === ModelType.GEMINI) {
                return await analyzeSingleIssueWithGemini(issue);
              } else if (selectedModel === ModelType.GLM) {
                return await analyzeSingleIssueWithGLM(issue, glmKey);
              } else if (selectedModel === ModelType.MINIMAX) {
                return await analyzeSingleIssueWithMiniMax(issue, minimaxKey);
              } else if (selectedModel === ModelType.OPENAI) {
                return await analyzeSingleIssueWithOpenAI(issue, openaiKey);
              }
            });

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
      const activeKey = getCurrentKey();
      const merged = await callWithRetry(async () => {
        return await performSemanticMerge(rawFeatures, rawDecisions, selectedModel, activeKey);
      });
      
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
      console.error("Critical analysis error:", err);
      setError(err.message || '分析或聚合过程中发生错误。');
      setStatus(AnalysisState.ERROR);
    }
  };

  const currentResult = viewMode === 'merged' ? mergedResult : rawResult;

  const exportReport = () => {
    if (!currentResult) return;
    const timestamp = new Date().toLocaleString();
    const sourceLabel = mode === 'online' ? `GitHub Repository: ${repoPath}` : 'Local Issue Files';
    const viewLabel = viewMode === 'merged' ? '语义聚合视图' : '原始提取视图';
    
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
            <div className="relative group">
              <select 
                value={selectedModel} 
                onChange={(e) => setSelectedModel(e.target.value as ModelType)}
                className="appearance-none bg-slate-100 hover:bg-slate-200 border-none pl-4 pr-10 py-2 rounded-xl text-sm font-bold text-slate-700 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              >
                <option value={ModelType.GEMINI}>Google Gemini 3 (推荐)</option>
                <option value={ModelType.GLM}>智谱 GLM-4 Flash</option>
                <option value={ModelType.MINIMAX}>MiniMax abab6.5s</option>
                <option value={ModelType.OPENAI}>OpenAI GPT-4o-mini</option>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <ChevronDown size={16} />
              </div>
            </div>

            <button 
              onClick={() => setShowSettings(!showSettings)} 
              className={`p-2 rounded-xl transition-all ${showSettings ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}
              title="配置中心"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>

        {showSettings && (
          <div className="bg-white border-b border-slate-200 p-8 animate-in slide-in-from-top-4 duration-300">
            <div className="max-w-7xl mx-auto">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                <div className="space-y-6">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Github size={16} /> 数据源与访问权限
                  </h3>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-600">GitHub Access Token</label>
                      <div className="relative">
                        <input 
                          type="password" 
                          placeholder="配置 Token 以提高 API 限制" 
                          value={ghToken} 
                          onChange={(e) => setGhToken(e.target.value)} 
                          className="w-full pl-4 pr-10 py-2.5 border rounded-xl focus:border-indigo-500 focus:outline-none bg-slate-50 transition-colors" 
                        />
                        <ShieldCheck className="absolute right-3 top-3 text-slate-300" size={18} />
                      </div>
                      <p className="text-[10px] text-slate-400 italic">建议为私有仓库或大规模分析配置只读权限的 PAT。</p>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-6">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Key size={16} /> 模型密钥管理
                  </h3>
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-600">智谱 GLM API Key</label>
                        <div className="relative">
                          <input 
                            type="password" 
                            placeholder="GLM Key" 
                            value={glmKey} 
                            onChange={(e) => setGlmKey(e.target.value)} 
                            className="w-full pl-3 pr-8 py-2 border rounded-xl focus:border-indigo-500 focus:outline-none text-xs bg-slate-50" 
                          />
                          <BrainCircuit className="absolute right-2 top-2 text-slate-300" size={14} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-600">MiniMax API Key</label>
                        <div className="relative">
                          <input 
                            type="password" 
                            placeholder="MiniMax Key" 
                            value={minimaxKey} 
                            onChange={(e) => setMinimaxKey(e.target.value)} 
                            className="w-full pl-3 pr-8 py-2 border rounded-xl focus:border-indigo-500 focus:outline-none text-xs bg-slate-50" 
                          />
                          <Cpu className="absolute right-2 top-2 text-slate-300" size={14} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-600">OpenAI API Key</label>
                        <div className="relative">
                          <input 
                            type="password" 
                            placeholder="OpenAI Key" 
                            value={openaiKey} 
                            onChange={(e) => setOpenaiKey(e.target.value)} 
                            className="w-full pl-3 pr-8 py-2 border rounded-xl focus:border-indigo-500 focus:outline-none text-xs bg-slate-50" 
                          />
                          <Sparkles className="absolute right-2 top-2 text-slate-300" size={14} />
                        </div>
                      </div>
                    </div>
                    
                    <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100 flex items-start gap-4">
                      <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                        <Sparkles size={16} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                           <p className="text-xs font-bold text-indigo-900">Google Gemini 3</p>
                           <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${hasGeminiKey ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                             {hasGeminiKey ? '已连接' : '未连接'}
                           </span>
                        </div>
                        <p className="text-[10px] text-indigo-700 leading-relaxed mb-3">
                          点击下方按钮以选择您的付费 API 密钥（Gemini 3 Pro/Flash 需要付费账户以避免频率限制）。
                        </p>
                        <div className="flex items-center gap-3">
                          <button 
                            onClick={handleSelectGeminiKey}
                            className="text-[10px] font-bold bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
                          >
                            选择/切换 API 密钥
                          </button>
                          <a 
                            href="https://ai.google.dev/gemini-api/docs/billing" 
                            target="_blank" 
                            rel="noreferrer"
                            className="text-[10px] text-indigo-500 hover:underline flex items-center gap-1"
                          >
                            计费说明 <ExternalLink size={10} />
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        <div className="mb-12 text-center">
          <h2 className="text-4xl font-extrabold text-slate-900 mb-6 tracking-tight leading-tight">
            GitHub 讨论深度挖掘智能体
          </h2>
          <div className="max-w-2xl mx-auto flex flex-col gap-4">
             <div className="flex justify-center mb-2">
                <div className="inline-flex p-1 bg-slate-200 rounded-2xl shadow-inner">
                  <button onClick={() => setMode('online')} className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${mode === 'online' ? 'bg-white text-indigo-600 shadow-sm scale-[1.02]' : 'text-slate-500 hover:text-slate-700'}`}>
                    <Globe size={16} /> 在线仓库
                  </button>
                  <button onClick={() => setMode('local')} className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${mode === 'local' ? 'bg-white text-indigo-600 shadow-sm scale-[1.02]' : 'text-slate-500 hover:text-slate-700'}`}>
                    <FolderOpen size={16} /> 本地解析
                  </button>
                </div>
             </div>
             {mode === 'online' ? (
                <form onSubmit={handleOnlineAnalyze} className="relative flex items-center group">
                  <input 
                    type="text" 
                    placeholder="代码库路径，如: google/perfetto" 
                    value={repoPath} 
                    onChange={(e) => setRepoPath(e.target.value)} 
                    disabled={status !== AnalysisState.IDLE && status !== AnalysisState.COMPLETED && status !== AnalysisState.ERROR} 
                    className="w-full pl-6 pr-40 py-4 border-2 rounded-2xl focus:border-indigo-500 outline-none shadow-sm hover:shadow transition-all bg-white" 
                  />
                  <button 
                    type="submit" 
                    disabled={status === AnalysisState.ANALYZING || status === AnalysisState.FETCHING || status === AnalysisState.MERGING} 
                    className="absolute right-2 px-6 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:bg-slate-300 shadow-md shadow-indigo-100 transition-all flex items-center gap-2"
                  >
                    {status === AnalysisState.IDLE || status === AnalysisState.COMPLETED || status === AnalysisState.ERROR ? (
                      <>开始分析 <Search size={18}/></>
                    ) : <Loader2 className="animate-spin" size={20} />}
                  </button>
                </form>
             ) : (
                <button 
                  onClick={() => fileInputRef.current?.click()} 
                  className="py-10 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center gap-2 hover:bg-white hover:border-indigo-400 transition-all group shadow-sm bg-slate-50/50"
                >
                  <div className="bg-indigo-50 p-4 rounded-full text-indigo-600 group-hover:scale-110 transition-transform">
                    <FolderOpen size={36} />
                  </div>
                  <span className="font-bold text-slate-700">选择包含 Issue 导出的文件夹</span>
                  <span className="text-xs text-slate-400">支持分析本地 .md 或 .txt 文件</span>
                  <input type="file" ref={fileInputRef} style={{display:'none'}} onChange={handleLocalAnalyze} {...({webkitdirectory: "", directory: ""} as any)} />
                </button>
             )}
          </div>
        </div>

        {(status === AnalysisState.ANALYZING || status === AnalysisState.MERGING) && (
          <div className="flex flex-col items-center py-20 animate-in fade-in">
            <div className="relative mb-6">
              <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center text-indigo-600 shadow-sm">
                {status === AnalysisState.MERGING ? <Sparkles size={40} className="animate-pulse" /> : <BrainCircuit size={40} className="animate-bounce" />}
              </div>
              <div className="absolute -bottom-1 -right-1 bg-white p-1.5 rounded-full shadow-lg border border-slate-100">
                <Loader2 className="animate-spin text-indigo-600" size={20} />
              </div>
            </div>
            <h3 className="text-xl font-bold text-slate-800 text-center px-4">
              {status === AnalysisState.MERGING ? '正在进行跨 Issue 的语义深度聚合...' : '正在解析 GitHub 原始讨论数据...'}
            </h3>
            {status === AnalysisState.ANALYZING && (
              <div className="mt-8 w-full max-w-xs">
                <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-widest">
                  <span>解析进度: {analysisProgress.current} / {analysisProgress.total}</span>
                  <span className="text-indigo-600">并发提取中</span>
                </div>
                <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden shadow-inner p-[1px]">
                  <div className="bg-gradient-to-r from-indigo-500 to-violet-500 h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>
            )}
            {status === AnalysisState.MERGING && (
              <p className="text-slate-400 mt-4 text-sm italic text-center px-6 leading-relaxed">
                正在通过大模型消除冗余项，并将相似的功能描述与技术决策合并为统一视图...
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="max-w-2xl mx-auto p-5 mb-8 bg-red-50 text-red-700 border border-red-100 rounded-3xl flex items-start gap-4 text-sm animate-in slide-in-from-top-4 shadow-sm">
            <AlertCircle size={22} className="shrink-0 mt-0.5 text-red-500" />
            <div className="flex-1">
              <p className="font-bold mb-1.5">分析中断</p>
              <p className="leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        {currentResult && status === AnalysisState.COMPLETED && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-6 duration-1000">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl w-full sm:w-auto">
                <button 
                  onClick={() => setViewMode('merged')} 
                  className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${viewMode === 'merged' ? 'bg-white shadow-sm text-indigo-600 scale-[1.02]' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Sparkles size={16} /> 语义聚合视图
                </button>
                <button 
                  onClick={() => setViewMode('raw')} 
                  className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${viewMode === 'raw' ? 'bg-white shadow-sm text-indigo-600 scale-[1.02]' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <ListFilter size={16} /> 原始提取视图
                </button>
              </div>
              <button onClick={exportReport} className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-md shadow-emerald-100 transition-all hover:scale-[1.02] active:scale-[0.98]">
                <Download size={18}/> 导出 Markdown 报告
              </button>
            </div>

            <SummaryStats stats={currentResult.stats} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col min-h-[500px]">
                <div className="flex items-center justify-between mb-8 border-b border-slate-50 pb-5">
                  <h3 className="text-xl font-bold flex items-center gap-3 text-slate-800">
                    <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl"><Lightbulb /></div>
                    功能特性列表
                  </h3>
                  <span className="bg-slate-50 px-3 py-1 rounded-full text-[10px] font-extrabold text-slate-400 uppercase tracking-widest border border-slate-100">
                    {(currentResult.features || []).length} 项发现
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                  <FeatureList features={currentResult.features || []} repoPath={repoPath} issues={allIssues} />
                </div>
              </div>
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col min-h-[500px]">
                <div className="flex items-center justify-between mb-8 border-b border-slate-50 pb-5">
                  <h3 className="text-xl font-bold flex items-center gap-3 text-slate-800">
                    <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl"><Gavel /></div>
                    关键设计决策
                  </h3>
                  <span className="bg-slate-50 px-3 py-1 rounded-full text-[10px] font-extrabold text-slate-400 uppercase tracking-widest border border-slate-100">
                    {(currentResult.decisions || []).length} 项共识
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16 max-w-6xl mx-auto opacity-90 animate-in fade-in slide-in-from-bottom-12 duration-1000">
            {[
              { 
                icon: <BrainCircuit className="text-indigo-500" />, 
                title: "高并发提取", 
                desc: "智能体以并发工作模式深度扫描 Issue，内置指数退避机制，即使是上千条对话也能快速、稳定地梳理出核心技术点。" 
              },
              { 
                icon: <Sparkles className="text-violet-500" />, 
                title: "语义聚合去重", 
                desc: "基于 LLM 深度理解，自动合并跨 Issue 的冗余项。将碎片化的技术对话转化为精炼的特性集与架构共识树。" 
              },
              { 
                icon: <BarChart3 className="text-emerald-500" />, 
                title: "可视化报告", 
                desc: "生成结构化的 Markdown 报告与动态分析统计，并支持追溯原始对话来源，辅助团队进行科学、高效的技术决策。" 
              }
            ].map((item, i) => (
              <div key={i} className="p-8 bg-white border border-slate-200 rounded-[2rem] transition-all duration-500 hover:shadow-2xl hover:shadow-indigo-100 hover:-translate-y-3 group border-b-4 border-b-slate-100 hover:border-b-indigo-400">
                <div className="mb-8 bg-slate-50 w-16 h-16 rounded-2xl flex items-center justify-center group-hover:bg-indigo-50 transition-colors duration-500">
                  {React.cloneElement(item.icon as React.ReactElement<any>, { size: 32 })}
                </div>
                <h4 className="font-bold text-xl mb-4 text-slate-800 group-hover:text-indigo-600 transition-colors duration-500">{item.title}</h4>
                <p className="text-slate-500 leading-relaxed text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="mt-auto py-12 border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-4">
            <div className="bg-slate-100 p-2.5 rounded-xl text-slate-400 shadow-inner">
              <Github size={24} />
            </div>
            <div className="text-sm">
              <p className="font-extrabold text-slate-700 tracking-tight">IssueMind AI Agent</p>
              <p className="text-slate-400 text-xs">基于大模型驱动的 GitHub 讨论区挖掘工具 &copy; 2024</p>
            </div>
          </div>
          <div className="flex items-center gap-8 text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">
            <span className="flex items-center gap-2 group cursor-help"><BrainCircuit size={14} className="group-hover:text-indigo-500 transition-colors"/> Multi-Model Configured</span>
            <span className="w-1.5 h-1.5 bg-slate-200 rounded-full hidden sm:block"></span>
            <span className="flex items-center gap-2 group cursor-help"><Sparkles size={14} className="group-hover:text-violet-500 transition-colors"/> Semantic Merging Enabled</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
