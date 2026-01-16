
import React from 'react';
import { ExternalLink } from 'lucide-react';
import { FeatureRequirement, GithubIssue } from '../types';

interface FeatureListProps {
  features: FeatureRequirement[];
  repoPath: string;
  issues?: GithubIssue[];
}

const FeatureList: React.FC<FeatureListProps> = ({ features = [], repoPath, issues = [] }) => {
  if (!features || features.length === 0) {
    return <p className="text-slate-400 text-center py-10 italic">No clear feature requirements found.</p>;
  }

  const getIssueState = (num: number) => issues.find(i => i.number === num)?.state;

  return (
    <div className="space-y-4">
      {features.map((feature, idx) => (
        <div key={idx} className="p-4 rounded-xl border border-slate-100 hover:border-amber-200 hover:bg-amber-50/30 transition-all group">
          <div className="flex justify-between items-start mb-2">
            <h4 className="font-bold text-slate-800 leading-tight group-hover:text-amber-700">{feature.title}</h4>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
              feature.priority === 'High' ? 'bg-red-100 text-red-600' : 
              feature.priority === 'Medium' ? 'bg-amber-100 text-amber-600' : 
              'bg-slate-100 text-slate-600'
            }`}>
              {feature.priority}
            </span>
          </div>
          <p className="text-sm text-slate-600 mb-4 line-clamp-3">{feature.summary}</p>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Sources:</span>
            {(feature.sourceIssueNumbers || []).map(num => {
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

export default FeatureList;
