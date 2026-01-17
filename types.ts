
export interface GithubComment {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
}

export interface GithubIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  html_url: string;
  labels: { name: string }[];
  state: string;
  created_at: string;
  user: { login: string };
  comments_data?: GithubComment[];
}

export interface FeatureRequirement {
  id: string;
  title: string;
  summary: string;
  priority: 'High' | 'Medium' | 'Low';
  sourceIssueNumbers: number[];
}

export interface DesignDecision {
  id: string;
  topic: string;
  discussion: string;
  decision: string;
  alternatives?: string[];
  sourceIssueNumbers: number[];
}

export interface AnalysisResult {
  features: FeatureRequirement[];
  decisions: DesignDecision[];
  stats: {
    totalIssuesAnalyzed: number;
    featureCount: number;
    decisionCount: number;
    totalCommentsAnalyzed: number;
  };
}

export enum AnalysisState {
  IDLE = 'IDLE',
  FETCHING = 'FETCHING',
  ANALYZING = 'ANALYZING',
  MERGING = 'MERGING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export enum ModelType {
  GEMINI = 'gemini',
  GLM = 'glm',
  MINIMAX = 'minimax',
  OPENAI = 'openai'
}
