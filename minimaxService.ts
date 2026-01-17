
import { GithubIssue, FeatureRequirement, DesignDecision } from "./types.ts";

export const analyzeSingleIssueWithMiniMax = async (issue: GithubIssue, apiKey: string): Promise<{ features: FeatureRequirement[], decisions: DesignDecision[] }> => {
  if (!apiKey) throw new Error("请先在设置中配置 MiniMax API Key");

  try {
    const issueData = {
      n: issue.number,
      t: issue.title,
      b: (issue.body || '').substring(0, 1000),
      s: issue.state,
      c: (issue.comments_data || []).slice(0, 15).map(comment => ({
        u: comment.user.login,
        b: comment.body.substring(0, 500)
      }))
    };

    const prompt = `
      你是一个高级软件架构师和产品经理。请分析以下这一条 GitHub Issue 及其评论内容。
      
      任务目标：
      1. **功能特性需求**：识别提出的功能建议或改进。
      2. **关键设计决策**：识别技术设计讨论并提取共识。

      输入数据:
      ${JSON.stringify(issueData)}

      JSON 输出要求（必须返回合法的 JSON 对象，内容使用中文）：
      {
        "features": [
          { "title": "标题", "summary": "汇总描述", "priority": "High/Medium/Low", "sourceIssueNumbers": [${issue.number}] }
        ],
        "decisions": [
          { "topic": "讨论主题", "discussion": "核心争议点摘要", "decision": "最终决策内容", "sourceIssueNumbers": [${issue.number}] }
        ]
      }
      如果没有发现，请返回空数组。
    `;

    const response = await fetch("https://api.minimax.chat/v1/text/chatcompletion_v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "abab6.5s-chat",
        messages: [
          { role: "system", content: "你是一个专门分析软件工程数据的助手，只返回 JSON 格式。" },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || `MiniMax API 调用失败: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.warn(`Issue #${issue.number}: MiniMax returned no content in choices.`);
      return { features: [], decisions: [] };
    }

    return JSON.parse(content);
  } catch (e) {
    console.error(`Error in analyzeSingleIssueWithMiniMax for #${issue.number}:`, e);
    return { features: [], decisions: [] };
  }
};
