import "dotenv/config";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { createModel } from "../lib/model.js";

const BriefSchema = z.object({
  title: z.string().describe("一句话标题"),
  bullets: z.array(z.string()).max(5).describe("最多 5 条要点"),
});

/**
 * 阶段一补充：结构化输出（Zod schema），便于前后端联调与稳定 JSON。
 */
async function main(): Promise<void> {
  const model = createModel();
  const structured = model.withStructuredOutput(BriefSchema);
  const out = await structured.invoke([
    new SystemMessage("用中文回答，简洁。"),
    new HumanMessage(
      "用标题 + 要点介绍 LangGraph：它解决什么问题、与线性 Chain 的区别。",
    ),
  ]);
  console.log(JSON.stringify(out, null, 2));
}

void main();
