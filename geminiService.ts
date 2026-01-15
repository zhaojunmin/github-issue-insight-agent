
import { GoogleGenAI, Type } from "@google/genai";
import { GithubIssue, AnalysisResult } from "./types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeIssuesWithGemini = async (issues: GithubIssue[]): Promise<AnalysisResult> => {
  // Extract critical info: Title, Body, and top 8 most relevant comments per issue
  // We use slightly more comments here for better context on design decisions
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
    1. **功能特性需求 (Feature Requirements)**：识别用户提出的新功能建议或改进。从 Issue 描述及其后续评论的讨论中总结出这些需求。
    2. **设计决策 (Design Decisions)**：识别深度的技术设计讨论。寻找开发者之间关于架构、实现方案的辩论，并提取出最终达成的共识或做出的决策。

    输入数据 (n=编号, t=标题, b=描述, s=状态, c=评论列表):
    ${JSON.stringify(issueData)}

    JSON 输出要求（请使用中文回答内容）：
    - features: 包含 title (标题), summary (功能汇总描述), priority (优先级: High/Medium/Low), sourceIssueNumbers (来源编号数组)。
    - decisions: 包含 topic (讨论主题), discussion (核心争议或讨论点摘要), decision (最终决策内容), sourceIssueNumbers (来源编号数组)。
    
    请确保总结具有前瞻性和准确性。如果某个 Issue 没有达成决策，请在 decision 中说明“讨论中”。
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          features: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
                priority: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] },
                sourceIssueNumbers: { type: Type.ARRAY, items: { type: Type.NUMBER } }
              },
              required: ['title', 'summary', 'priority', 'sourceIssueNumbers']
            }
          },
          decisions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                topic: { type: Type.STRING },
                discussion: { type: Type.STRING },
                decision: { type: Type.STRING },
                sourceIssueNumbers: { type: Type.ARRAY, items: { type: Type.NUMBER } }
              },
              required: ['topic', 'discussion', 'decision', 'sourceIssueNumbers']
            }
          }
        },
        required: ['features', 'decisions']
      }
    }
  });

  const result = JSON.parse(response.text);
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
