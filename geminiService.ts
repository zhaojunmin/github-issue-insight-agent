
import { GoogleGenAI, Type } from "@google/genai";
import { GithubIssue, FeatureRequirement, DesignDecision } from "./types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeSingleIssueWithGemini = async (issue: GithubIssue): Promise<{ features: FeatureRequirement[], decisions: DesignDecision[] }> => {
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
    1. **功能特性需求 (Feature Requirements)**：识别该 Issue 提出的功能建议或改进。
    2. **设计决策 (Design Decisions)**：识别该 Issue 中的技术设计讨论，提取最终达成的共识。

    输入数据 (n=编号, t=标题, b=描述, s=状态, c=评论列表):
    ${JSON.stringify(issueData)}

    JSON 输出要求（必须返回合法的 JSON 对象，内容使用中文）：
    - features: 包含 title (标题), summary (简短总结), priority (优先级: High/Medium/Low), sourceIssueNumbers (固定为 [${issue.number}])。
    - decisions: 包含 topic (讨论主题), discussion (核心争议或讨论点摘要), decision (最终决策内容), sourceIssueNumbers (固定为 [${issue.number}])。
    
    如果没有发现明确的功能或决策，请返回空数组。
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
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

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("Parse error for issue", issue.number, e);
    return { features: [], decisions: [] };
  }
};
