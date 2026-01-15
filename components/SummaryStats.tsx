
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface SummaryStatsProps {
  stats: {
    totalIssuesAnalyzed: number;
    featureCount: number;
    decisionCount: number;
    totalCommentsAnalyzed: number;
  };
}

const SummaryStats: React.FC<SummaryStatsProps> = ({ stats }) => {
  const data = [
    { name: 'Features', value: stats.featureCount, color: '#f59e0b' },
    { name: 'Decisions', value: stats.decisionCount, color: '#10b981' },
    { name: 'Issues', value: stats.totalIssuesAnalyzed, color: '#6366f1' },
    { name: 'Comments', value: stats.totalCommentsAnalyzed, color: '#ec4899' }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
      <div className="md:col-span-1 space-y-3">
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">Context Depth</p>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold text-slate-900">{stats.totalIssuesAnalyzed}</p>
            <p className="text-xs text-slate-500">Issues</p>
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-xl font-bold text-pink-500">{stats.totalCommentsAnalyzed}</p>
            <p className="text-xs text-slate-500">Comments</p>
          </div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">Extracted</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xl font-bold text-amber-600">{stats.featureCount}</p>
              <p className="text-[10px] text-slate-500 uppercase">Features</p>
            </div>
            <div className="text-right">
              <p className="text-xl font-bold text-emerald-600">{stats.decisionCount}</p>
              <p className="text-[10px] text-slate-500 uppercase">Decisions</p>
            </div>
          </div>
        </div>
      </div>
      
      <div className="md:col-span-3 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h4 className="text-sm font-semibold text-slate-800 mb-6 flex items-center gap-2">
          Insight Distribution
          <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-normal">Based on deep analysis</span>
        </h4>
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} width={70} />
              <Tooltip 
                cursor={{ fill: '#f8fafc' }}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={24}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default SummaryStats;
