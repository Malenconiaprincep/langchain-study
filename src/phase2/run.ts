import "dotenv/config";

import { MemorySaver } from "@langchain/langgraph";

import { createModel } from "../lib/model.js";
import { buildApprovalGraph } from "./approval-graph.js";

async function main(): Promise<void> {
  const topic = process.argv.slice(2).join(" ").trim() || "为内部开发者写一则 LangGraph 入门公告";
  const model = createModel();
  const workflow = buildApprovalGraph(model);
  const graph = workflow.compile({ checkpointer: new MemorySaver() });
  const config = { configurable: { thread_id: `approval-${Date.now()}` } };

  const initial = {
    topic,
    draft: "",
    check_passed: false,
    feedback: "",
    refineCount: 0,
    maxRefinements: 3,
  };

  console.error("阶段二：起草 → 质检 → 不通过则改写（最多 3 次）…");
  const out = await graph.invoke(initial, config);
  console.log(JSON.stringify(out, null, 2));
}

void main();
