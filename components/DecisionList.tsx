
import React from 'react';
import { ExternalLink, CheckCircle2 } from 'lucide-react';
import { DesignDecision, GithubIssue } from '../types';

interface DecisionListProps {
  decisions: DesignDecision[];
  repoPath: string;
  issues?: GithubIssue[];
}

const DecisionList: React.FC<DecisionListProps> = ({ decisions = [], repoPath, issues = [] }) => {
  if (!decisions || decisions.length === 0) {
    return <p className="text-slate-400 text-center py-10 italic">No significant design decisions identified.</p>;
  }

  const getIssueState = (num: number) => issues.find(i => i.number === num)?.state;

  return (
    <div className="space-y-6">
      {decisions.map((decision, idx) => (
        <div key={idx} className="relative pl-6 border-l-2 border-emerald-100 py-1 hover:border-emerald-300 transition-colors group">
          <div className="absolute -left-[9px] top-2 w-4 h-4 rounded-full bg-emerald-500 border-4 border-white shadow-sm" />
          
          <h4 className="font-bold text-slate-800 mb-2 group-hover:text-emerald-700 transition-colors">{decision.topic}</h4>
          
          <div className="mb-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">Context</p>
            <p className="text-sm text-slate-600 italic">"{decision.discussion}"</p>
          </div>

          <div className="mb-4 bg-emerald-50/50 p-3 rounded-lg border border-emerald-100">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 uppercase tracking-wider mb-1.5">
              <CheckCircle2 size={12} />
              Decision Made
            </div>
            <p className="text-sm text-emerald-900 leading-relaxed font-medium">{decision.decision}</p>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
             <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Traceability:</span>
            {(decision.sourceIssueNumbers || []).map(num => {
              const state = getIssueState(num);
              return (
                <a 
                  key={num}
                  href={`https://github.com/${repoPath}/issues/${num}`}
                  target="_blank"
                  rel="noreferrer"
                  className={`flex items-center gap-0.5 px-2 py-1 border rounded text-xs transition-colors ${
                    state === 'closed' 
                    ? 'bg-slate-50 border-slate-200 text-slate-400 line-through' 
                    : 'bg-white border-slate-200 text-slate-600 hover:text-indigo-600'
                  }`}
                  title={state === 'closed' ? 'Closed Issue' : 'Open Issue'}
                >
                  #{num}
                  <ExternalLink size={10} />
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default DecisionList;
