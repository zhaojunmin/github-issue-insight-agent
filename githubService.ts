
import { Octokit } from 'octokit';
import { GithubIssue, GithubComment } from './types';

export const fetchRepoIssues = async (repoPath: string, token?: string): Promise<GithubIssue[]> => {
  const octokit = new Octokit({
    auth: token && token.trim() !== '' ? token.trim() : undefined
  });

  const [owner, repo] = repoPath.split('/');
  if (!owner || !repo) {
    throw new Error('无效的仓库路径。请使用 "owner/repo" 格式。');
  }

  try {
    const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
      owner,
      repo,
      state: 'all',
      sort: 'updated',
      direction: 'desc',
      per_page: 100,
    });

    if (!Array.isArray(issues)) {
      return [];
    }

    // Filter out Pull Requests and limit to 50 for analysis efficiency
    const filteredIssues = issues.filter(issue => issue && !issue.pull_request).slice(0, 50);

    // Fetch comments for the selected issues
    const processedIssues = await Promise.all(
      filteredIssues.map(async (issue: any) => {
        let commentsData: GithubComment[] = [];
        if (issue.comments > 0) {
          try {
            const commentsResponse = await octokit.rest.issues.listComments({
              owner,
              repo,
              issue_number: issue.number,
              per_page: 50
            });
            
            if (commentsResponse && Array.isArray(commentsResponse.data)) {
              commentsData = commentsResponse.data.map((c: any) => ({
                id: c.id,
                body: c.body || '',
                user: { login: c.user?.login || 'unknown' },
                created_at: c.created_at
              }));
            }
          } catch (e) {
            console.error(`无法获取 Issue #${issue.number} 的评论`, e);
          }
        }
        
        return {
          id: issue.id,
          number: issue.number,
          title: issue.title || 'Untitled',
          body: issue.body || '',
          html_url: issue.html_url || '',
          labels: Array.isArray(issue.labels) ? issue.labels.map((l: any) => ({ name: typeof l === 'string' ? l : l.name })) : [],
          state: issue.state || 'open',
          created_at: issue.created_at || '',
          user: { login: issue.user?.login || 'unknown' },
          comments_data: commentsData
        } as GithubIssue;
      })
    );

    return processedIssues;
  } catch (error: any) {
    if (error.status === 404) {
      throw new Error('未找到该代码库，请检查所有者/仓库名。');
    }
    if (error.status === 401 || error.status === 403) {
      throw new Error(error.message || 'GitHub API 鉴权失败或达到频率限制。建议配置 Token。');
    }
    throw new Error(`获取 GitHub 数据失败: ${error.message}`);
  }
};
