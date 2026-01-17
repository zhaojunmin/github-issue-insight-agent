
import { GoogleGenAI, Type } from "@google/genai";
import { FeatureRequirement, DesignDecision, ModelType } from "./types.ts";

export const performSemanticMerge = async (
  features: FeatureRequirement[],
  decisions: DesignDecision[],
  modelType: ModelType,
  apiKey?: string
): Promise<{ features: FeatureRequirement[], decisions: DesignDecision[] }> => {
  if ((!features || features.length === 0) && (!decisions || decisions.length === 0)) {
    return { features: [], decisions: [] };
  }

  const featureInput = (features || []).map(f => ({
    title: f.title,
    summary: f.summary,
    priority: f.priority,
    nums: f.sourceIssueNumbers
  }));

  const decisionInput = (decisions || []).map(d => ({
    topic: d.topic,
    decision: d.decision,
    nums: d.sourceIssueNumbers
  }));

  const prompt = `
    你是一个专业的软件工程数据分析师。
    我从多个 GitHub Issues 中提取了原始的功能需求点和设计决策。其中很多是重复的或高度相似的。
    你的任务是进行“语义合并”：
    
    1. **相似合并**：将指向同一个功能需求或同一个架构决策的项合并为一个。
    2. **综合描述**：合并后的摘要应结合所有来源的信息，变得更全面但保持精炼。
    3. **追溯保留**：合并后的 sourceIssueNumbers 必须包含所有被合并项的 Issue 编号（去重）。
    4. **优先级选择**：功能合并时，取其中最高的优先级 (High > Medium > Low)。
    5. **语言要求**：输出内容必须使用中文。

    原始数据如下：
    功能特性列表: ${JSON.stringify(featureInput)}
    设计决策列表: ${JSON.stringify(decisionInput)}

    输出要求：必须严格返回 JSON 格式，包含 features 和 decisions 数组。
  `;

  try {
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
                    discussion: { type: Type.STRING, description: "合并后的背景描述" },
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

      const text = response.text;
      if (!text) throw new Error("Gemini returned empty response during merge.");
      const parsed = JSON.parse(text) || {};
      return {
        features: Array.isArray(parsed.features) ? parsed.features : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : []
      };
    } else {
      let endpoint = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
      let model = "glm-4-flash";

      if (modelType === ModelType.MINIMAX) {
        endpoint = "https://api.minimax.chat/v1/text/chatcompletion_v2";
        model = "abab6.5s-chat";
      } else if (modelType === ModelType.OPENAI) {
        endpoint = "https://api.openai.com/v1/chat/completions";
        model = "gpt-4o-mini";
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: "你是一个专门做数据聚合的助手，只输出合法的 JSON 格式。" },
            { role: "user", content: prompt }
          ],
          response_format: { type: "json_object" }
        })
      });
      if (!response.ok) throw new Error(`${modelType.toUpperCase()} 合并请求失败`);
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error(`${modelType.toUpperCase()} returned empty content during merge.`);
      const parsed = JSON.parse(content) || {};
      return {
        features: Array.isArray(parsed.features) ? parsed.features : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : []
      };
    }
  } catch (error) {
    console.error("Semantic merge failed, returning empty structure:", error);
    return { features: [], decisions: [] };
  }
};
