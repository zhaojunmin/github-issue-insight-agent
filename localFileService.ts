
import { GithubIssue, GithubComment } from './types';

export const parseLocalIssueFiles = async (files: FileList): Promise<GithubIssue[]> => {
  const issues: GithubIssue[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.name.endsWith('.md') || file.name.endsWith('.txt')) {
      const content = await file.text();
      const parsed = parseIssueContent(content);
      if (parsed) {
        issues.push(parsed);
      }
    }
  }

  return issues.sort((a, b) => b.number - a.number);
};

const parseIssueContent = (content: string): GithubIssue | null => {
  try {
    const lines = content.split('\n');
    
    // 1. Extract Header: # Issue #100: Title
    const headerMatch = content.match(/^# Issue #(\d+):\s*(.+)$/m);
    if (!headerMatch) return null;
    
    const number = parseInt(headerMatch[1]);
    const title = headerMatch[2].trim();

    // 2. Extract Metadata
    const stateMatch = content.match(/\*\*状态\*\*:\s*(.+)$/m);
    const userMatch = content.match(/\*\*作者\*\*:\s*(.+)$/m);
    const dateMatch = content.match(/\*\*时间\*\*:\s*(.+)$/m);
    const linkMatch = content.match(/\*\*链接\*\*:\s*(.+)$/m);

    // 3. Extract Problem Description
    // Look for everything between ## 问题描述 and ## 评论区域
    const descriptionStart = content.indexOf('## 问题描述');
    const commentsStart = content.indexOf('## 评论区域');
    
    let body = "";
    if (descriptionStart !== -1) {
      const startPos = content.indexOf('\n', descriptionStart) + 1;
      const endPos = commentsStart !== -1 ? commentsStart : content.length;
      body = content.substring(startPos, endPos).trim();
    }

    // 4. Extract Comments
    const comments_data: GithubComment[] = [];
    if (commentsStart !== -1) {
      const commentsSection = content.substring(commentsStart);
      // Regex to find: ### 评论 #1 - user\n--- \n body
      const commentBlocks = commentsSection.split(/### 评论 #\d+ - /).slice(1);
      
      commentBlocks.forEach((block, index) => {
        const firstLineEnd = block.indexOf('\n');
        const user = block.substring(0, firstLineEnd).trim();
        const bodyContent = block.substring(firstLineEnd).replace(/^---/m, '').trim();
        
        comments_data.push({
          id: index + 1,
          body: bodyContent,
          user: { login: user },
          created_at: "" // Not always available in this simplified format
        });
      });
    }

    return {
      id: number,
      number,
      title,
      body,
      html_url: linkMatch ? linkMatch[1].trim() : "",
      state: stateMatch ? stateMatch[1].trim() : "unknown",
      created_at: dateMatch ? dateMatch[1].trim() : "",
      user: { login: userMatch ? userMatch[1].trim() : "unknown" },
      labels: [],
      comments_data
    };
  } catch (e) {
    console.error("Failed to parse file content", e);
    return null;
  }
};
