
import { GithubIssue, AnalysisResult } from "./types";

export const analyzeIssuesWithGLM = async (issues: GithubIssue[], apiKey: string): Promise<AnalysisResult> => {
  if (!apiKey) throw new Error("请先在设置中配置 GLM API Key");

  const issueData = issues.map(i => ({
    n: i.number,
    t: i.title,
    b: (i.body || '').substring(0, 500),
    s: i.state,
    c: (i.comments_data || []).slice(0, 8).map(comment => ({
      u: comment.user.login,
      b: comment.body.substring(0, 300)
    }))
  }));

  const prompt = `
    你是一个高级软件架构师和产品经理。请分析以下 GitHub Issues 及其评论内容。
    
    任务目标：
    1. **功能特性需求 (Feature Requirements)**：识别用户提出的新功能建议或改进。
    2. **关键设计决策 (Design Decisions)**：识别深度的技术设计讨论，提取最终达成的共识。

    输入数据:
    ${JSON.stringify(issueData)}

    JSON 输出要求（必须返回合法的 JSON 对象，内容使用中文）：
    {
      "features": [
        { "title": "标题", "summary": "汇总描述", "priority": "High/Medium/Low", "sourceIssueNumbers": [1, 2] }
      ],
      "decisions": [
        { "topic": "讨论主题", "discussion": "核心争议点摘要", "decision": "最终决策内容", "sourceIssueNumbers": [3] }
      ]
    }
  `;

  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "glm-4-flash",
      messages: [
        { role: "system", content: "你是一个专门分析软件工程数据的助手，只返回 JSON 格式。" },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || `GLM API 调用失败: ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  const result = JSON.parse(content);

  const totalComments = issues.reduce((acc, curr) => acc + (curr.comments_data?.length || 0), 0);

  return {
    ...result,
    stats: {
      totalIssuesAnalyzed: issues.length,
      featureCount: result.features.length,
      decisionCount: result.decisions.length,
      totalCommentsAnalyzed: totalComments
    }
  };
};
