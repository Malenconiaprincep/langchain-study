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
import { buildDocTicketGraph } from "./doc-ticket-graph.js";

async function main(): Promise<void> {
  const question =
    process.argv.slice(2).join(" ").trim() || "新员工要配 VPN，该怎么走流程？";
  const model = createModel();
  const workflow = buildDocTicketGraph(model);
  const graph = workflow.compile({ checkpointer: new MemorySaver() });
  const config = { configurable: { thread_id: `capstone-${Date.now()}` } };

  const initial = {
    question,
    context: "",
    answer: "",
    want_ticket: false,
    ticket_draft: "",
    status: "pending",
  };

  const rl = readline.createInterface({ input, output });
  let nextInput: Record<string, unknown> | Command = initial;

  try {
    console.error("结业 Capstone：检索内存文档 → 回答 → 人工确认是否生成工单草稿…");
    for (;;) {
      const out = await graph.invoke(nextInput as never, config);
      if (isInterrupted(out)) {
        const payload = out[INTERRUPT][0]?.value;
        console.error("\n--- 是否根据上述回答生成工单草稿？---\n");
        console.error(JSON.stringify(payload, null, 2));
        const line = await rl.question(
          "\n输入 yes/是/建单 生成工单，其它跳过：",
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
