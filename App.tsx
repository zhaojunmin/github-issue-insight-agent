
import React, { useState, useEffect, useRef } from 'react';
import { Search, Github, LayoutDashboard, Lightbulb, Gavel, AlertCircle, Loader2, History, ShieldCheck, Settings, BrainCircuit, FolderOpen, Globe } from 'lucide-react';
import { fetchRepoIssues } from './githubService';
import { parseLocalIssueFiles } from './localFileService';
import { analyzeSingleIssueWithGemini } from './geminiService';
import { analyzeSingleIssueWithGLM } from './glmService';
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
  const [result, setResult] = useState<AnalysisResult | null>(null);
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
      setResult(null);

      const issues = await fetchRepoIssues(cleanPath, ghToken);
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
      setResult(null);

      const issues = await parseLocalIssueFiles(files);
      if (issues.length === 0) {
        throw new Error('在所选目录中未找到有效的 Issue 文件 (需为 .md 或 .txt)。');
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
    
    const aggregatedFeatures: FeatureRequirement[] = [];
    const aggregatedDecisions: DesignDecision[] = [];
    let totalComments = 0;

    try {
      for (let i = 0; i < issues.length; i++) {
        setAnalysisProgress({ current: i + 1, total: issues.length });
        const issue = issues[i];
        totalComments += (issue.comments_data?.length || 0);

        let partial;
        if (selectedModel === ModelType.GEMINI) {
          partial = await analyzeSingleIssueWithGemini(issue);
        } else {
          partial = await analyzeSingleIssueWithGLM(issue, glmKey);
        }

        if (partial.features) aggregatedFeatures.push(...partial.features);
        if (partial.decisions) aggregatedDecisions.push(...partial.decisions);
        
        // Brief delay to prevent hitting API rate limits if no token/low tier
        if (i < issues.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      setResult({
        features: aggregatedFeatures,
        decisions: aggregatedDecisions,
        stats: {
          totalIssuesAnalyzed: issues.length,
          featureCount: aggregatedFeatures.length,
          decisionCount: aggregatedDecisions.length,
          totalCommentsAnalyzed: totalComments
        }
      });
      setStatus(AnalysisState.COMPLETED);
    } catch (err: any) {
      setError(err.message || '大模型逐条分析失败。');
      setStatus(AnalysisState.ERROR);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg text-white shadow-lg shadow-indigo-200">
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
            <a 
              href="https://github.com" 
              target="_blank" 
              rel="noreferrer" 
              className="text-slate-500 hover:text-indigo-600"
            >
              <Github size={20} />
            </a>
          </div>
        </div>
        
        {showSettings && (
          <div className="bg-slate-50 border-b border-slate-200 p-6 animate-in slide-in-from-top-2">
            <div className="max-w-7xl mx-auto space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                    <ShieldCheck size={14} /> GitHub Token
                  </label>
                  <input
                    type="password"
                    placeholder="GitHub Personal Access Token"
                    value={ghToken}
                    onChange={(e) => setGhToken(e.target.value)}
                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm shadow-inner"
                  />
                  <p className="text-[10px] text-slate-400">用于在线抓取，提高 API 频率限制。</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                    <BrainCircuit size={14} /> GLM API Key
                  </label>
                  <input
                    type="password"
                    placeholder="智谱 AI GLM API Key"
                    value={glmKey}
                    onChange={(e) => setGlmKey(e.target.value)}
                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm shadow-inner"
                  />
                  <p className="text-[10px] text-slate-400">使用 GLM 模型分析时必填。</p>
                </div>
              </div>
              <div className="pt-4 border-t border-slate-200 flex justify-end">
                <button 
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-md shadow-indigo-100"
                >
                  保存并关闭
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        <div className="mb-12">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-extrabold text-slate-900 sm:text-4xl mb-3 tracking-tight">
              GitHub 深度挖掘智能体
            </h2>
            <div className="flex justify-center mb-6">
               <div className="inline-flex p-1 bg-slate-200 rounded-2xl shadow-inner">
                <button 
                  onClick={() => setMode('online')}
                  className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${mode === 'online' ? 'bg-white text-indigo-600 shadow-sm scale-105' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Globe size={16} /> 在线仓库
                </button>
                <button 
                  onClick={() => setMode('local')}
                  className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${mode === 'local' ? 'bg-white text-indigo-600 shadow-sm scale-105' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <FolderOpen size={16} /> 本地文件
                </button>
              </div>
            </div>
          </div>

          <div className="max-w-2xl mx-auto">
            {mode === 'online' ? (
              <form onSubmit={handleOnlineAnalyze} className="animate-in fade-in zoom-in-95 duration-300">
                <div className="relative flex items-center group">
                  <div className="absolute left-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                    <Search size={20} />
                  </div>
                  <input
                    type="text"
                    placeholder="代码库路径 (例如 google/perfetto)"
                    value={repoPath}
                    onChange={(e) => setRepoPath(e.target.value)}
                    disabled={status === AnalysisState.FETCHING || status === AnalysisState.ANALYZING}
                    className="w-full pl-12 pr-40 py-4 bg-white border-2 border-slate-200 rounded-2xl focus:border-indigo-500 focus:outline-none transition-all shadow-sm hover:border-slate-300"
                  />
                  <button
                    type="submit"
                    disabled={status === AnalysisState.FETCHING || status === AnalysisState.ANALYZING}
                    className="absolute right-2 px-6 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:bg-slate-300 transition-all shadow-md shadow-indigo-100"
                  >
                    {status === AnalysisState.FETCHING || status === AnalysisState.ANALYZING ? (
                      <Loader2 className="animate-spin" size={20} />
                    ) : (
                      '开始分析'
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <div className="text-center animate-in fade-in zoom-in-95 duration-300 bg-white border-2 border-dashed border-slate-300 rounded-3xl p-10 hover:border-indigo-400 transition-colors group">
                <div className="bg-indigo-50 w-16 h-16 rounded-full flex items-center justify-center text-indigo-600 mx-auto mb-4 group-hover:scale-110 transition-transform">
                  <FolderOpen size={32} />
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-1">分析本地 Issue 导出目录</h3>
                <p className="text-slate-500 text-sm mb-6 max-w-sm mx-auto">
                  选择文件夹（包含 Markdown/TXT 文件），智能体将逐一分析每一个 Issue。
                </p>
                <input 
                  type="file" 
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={handleLocalAnalyze}
                  // @ts-ignore
                  webkitdirectory="" 
                  directory="" 
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={status === AnalysisState.FETCHING || status === AnalysisState.ANALYZING}
                  className="px-8 py-3 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 disabled:bg-slate-300 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2 mx-auto"
                >
                  {status === AnalysisState.FETCHING || status === AnalysisState.ANALYZING ? (
                    <Loader2 className="animate-spin" size={20} />
                  ) : (
                    <>
                      <FolderOpen size={20} />
                      选择文件夹并分析
                    </>
                  )}
                </button>
              </div>
            )}

            {error && (
              <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-3 text-red-700 text-sm animate-in fade-in slide-in-from-top-4">
                <div className="bg-red-100 p-1.5 rounded-full"><AlertCircle size={16} /></div>
                {error}
              </div>
            )}
          </div>
        </div>

        {(status === AnalysisState.FETCHING || status === AnalysisState.ANALYZING) && (
          <div className="flex flex-col items-center justify-center py-20 animate-in fade-in">
            <div className="relative mb-6">
               <div className="w-24 h-24 bg-indigo-100 rounded-3xl flex items-center justify-center text-indigo-600 animate-pulse">
                <BrainCircuit size={48} className="animate-bounce" />
              </div>
              <div className="absolute -bottom-2 -right-2 bg-white p-2 rounded-full shadow-lg">
                 <Loader2 className="animate-spin text-indigo-600" size={24} />
              </div>
            </div>
            <h3 className="text-xl font-bold text-slate-800">
              {status === AnalysisState.FETCHING ? '正在读取讨论数据...' : `正在通过 ${selectedModel === ModelType.GEMINI ? 'Gemini' : 'GLM'} 进行深度洞察...`}
            </h3>
            {status === AnalysisState.ANALYZING && (
              <div className="mt-6 w-full max-w-md">
                <div className="flex justify-between text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">
                  <span>正在处理第 {analysisProgress.current} 个 Issue</span>
                  <span>共 {analysisProgress.total} 个</span>
                </div>
                <div className="w-full bg-slate-200 h-3 rounded-full overflow-hidden shadow-inner">
                  <div 
                    className="bg-gradient-to-r from-indigo-500 to-violet-500 h-full transition-all duration-500 ease-out"
                    style={{ width: `${(analysisProgress.current / analysisProgress.total) * 100}%` }}
                  />
                </div>
                <p className="text-slate-400 mt-4 text-center text-sm italic">
                  正在逐条解析 Issue 及其上下文，确保不遗漏任何细节。
                </p>
              </div>
            )}
          </div>
        )}

        {result && status === AnalysisState.COMPLETED && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <SummaryStats stats={result.stats} />
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <section className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                <div className="flex items-center gap-3 mb-6 border-b border-slate-50 pb-4">
                  <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl">
                    <Lightbulb size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-800 leading-tight">功能特性汇总</h3>
                    <p className="text-xs text-slate-400 font-medium">从逐条 Issue 中提取的需求点</p>
                  </div>
                </div>
                <div className="flex-1">
                   <FeatureList features={result.features} repoPath={repoPath} issues={allIssues} />
                </div>
              </section>

              <section className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                <div className="flex items-center gap-3 mb-6 border-b border-slate-50 pb-4">
                  <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
                    <Gavel size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-800 leading-tight">关键设计决策</h3>
                    <p className="text-xs text-slate-400 font-medium">在 Issue 中发现的技术路线共识</p>
                  </div>
                </div>
                <div className="flex-1">
                  <DecisionList decisions={result.decisions} repoPath={repoPath} issues={allIssues} />
                </div>
              </section>
            </div>
          </div>
        )}

        {status === AnalysisState.IDLE && !result && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 opacity-80 group/intro">
            {[
              { 
                icon: <BrainCircuit className="text-indigo-500" />, 
                title: "逐条深度分析", 
                desc: "智能体不再批量堆叠数据，而是逐一深入解析每个 Issue，获取更高精度的洞察。" 
              },
              { 
                icon: <Globe className="text-blue-500" />, 
                title: "实时进度追踪", 
                desc: "可视化分析进度，您可以清晰看到大模型处理到了哪一条讨论，不错过任何进度。" 
              },
              { 
                icon: <FolderOpen className="text-amber-500" />, 
                title: "灵活数据来源", 
                desc: "无论是通过 GitHub 实时同步还是加载本地 Markdown 导出，都能获得一致的分析体验。" 
              }
            ].map((item, i) => (
              <div key={i} className="p-8 bg-white border border-slate-200 rounded-3xl transition-all duration-300 hover:shadow-xl hover:-translate-y-1">
                <div className="mb-6 bg-slate-50 w-12 h-12 rounded-2xl flex items-center justify-center">{item.icon}</div>
                <h4 className="font-bold text-lg mb-2 text-slate-800">{item.title}</h4>
                <p className="text-sm text-slate-500 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="mt-auto py-10 border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-sm text-slate-400 flex items-center gap-2">
            <LayoutDashboard size={14} />
            <span>IssueMind 智能分析智能体 &copy; 2024</span>
          </div>
          <div className="flex items-center gap-6 text-xs font-bold uppercase tracking-widest text-slate-400">
            <span>Powered by Gemini 3 / GLM-4</span>
            <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
            <span>Iterative Analysis Mode</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
