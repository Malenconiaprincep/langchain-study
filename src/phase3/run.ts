import "dotenv/config";

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  Command,
  INTERRUPT,
  MemorySaver,
  isInterrupted,
} from "@langchain/langgraph";

import { createModel } from "../lib/model.js";
import { buildResearchGraph } from "./research-graph.js";

async function main(): Promise<void> {
  const topic =
    process.argv.slice(2).join(" ").trim() || "LangGraph checkpoint 与 Human-in-the-loop";
  const model = createModel();
  const workflow = buildResearchGraph(model);
  const graph = workflow.compile({ checkpointer: new MemorySaver() });
  const config = { configurable: { thread_id: `research-${Date.now()}` } };

  const initial = {
    topic,
    search_blob: "",
    report: "",
    approved: false,
    status: "pending",
  };

  const rl = readline.createInterface({ input, output });
  let nextInput: Record<string, unknown> | Command = initial;

  try {
    console.error("阶段三：Wikipedia 检索 → 写报告 → 人工确认是否「发布」…");
    for (;;) {
      const out = await graph.invoke(nextInput as never, config);
      if (isInterrupted(out)) {
        const payload = out[INTERRUPT][0]?.value;
        console.error("\n--- HITL：请确认是否将报告标记为已发布 ---\n");
        console.error(JSON.stringify(payload, null, 2));
        const line = await rl.question(
          "\n输入 yes/是/approve 表示发布，其它为取消：",
        );
        nextInput = new Command({ resume: line });
        continue;
      }
      console.log(JSON.stringify(out, null, 2));
      break;
    }
  } finally {
    rl.close();
  }
}

void main();
