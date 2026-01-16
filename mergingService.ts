
import { GoogleGenAI, Type } from "@google/genai";
import { FeatureRequirement, DesignDecision, ModelType } from "./types";

export const mergeInsights = async (
  features: FeatureRequirement[], 
  decisions: DesignDecision[], 
  modelType: ModelType, 
  apiKey?: string
): Promise<{ features: FeatureRequirement[], decisions: DesignDecision[] }> => {
  if (features.length === 0 && decisions.length === 0) return { features: [], decisions: [] };

  const prompt = `
    你是一个专业的数据聚合分析师。下面是从多个 GitHub Issue 中提取出的原始功能特性和设计决策列表。
    由于同一个功能或决策可能在多个 Issue 中被提及，你的任务是进行**语义合并**。

    合并规则：
    1. **识别重复**：将描述相同功能需求或相同技术决策的项合并为一项。
    2. **综合描述**：合并后的标题应简洁明了，摘要应结合所有来源项的信息，变得更全面。
    3. **保留溯源**：合并后的 sourceIssueNumbers 必须是所有被合并项的 Issue 编号的合集（去重）。
    4. **优先级选择**：合并功能特性时，取被合并项中最高的优先级（High > Medium > Low）。
    5. **语言要求**：输出内容必须使用中文。

    输入数据：
    - 原始特性: ${JSON.stringify(features)}
    - 原始决策: ${JSON.stringify(decisions)}

    输出要求：必须返回合法的 JSON 对象。
  `;

  if (modelType === ModelType.GEMINI) {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
    return JSON.parse(response.text);
  } else {
    // GLM-4 Merging
    const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "glm-4-flash",
        messages: [
          { role: "system", content: "你是一个专门进行数据语义合并的助手，只返回 JSON 格式。" },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" }
      })
    });
    if (!response.ok) throw new Error("GLM 合并请求失败");
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  }
};
