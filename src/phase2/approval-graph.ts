import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";

import { routeAfterCheck } from "../lib/approval-routing.js";

const CheckResultSchema = z.object({
  passed: z.boolean().describe("是否通过质检"),
  feedback: z.string().describe("未通过时的修改建议；通过时可简短说明"),
});

const ApprovalState = Annotation.Root({
  topic: Annotation<string>,
  draft: Annotation<string>,
  check_passed: Annotation<boolean>,
  feedback: Annotation<string>,
  refineCount: Annotation<number>,
  maxRefinements: Annotation<number>,
});

export type ApprovalGraphState = typeof ApprovalState.State;

export function buildApprovalGraph(
  model: ChatOpenAI,
  _opts?: { maxRefinements?: number },
) {
  const checker = model.withStructuredOutput(CheckResultSchema);

  async function draftNode(state: ApprovalGraphState) {
    const res = await model.invoke([
      new SystemMessage(
        "你是技术写作助手。根据主题写一段 80～150 字的中文草稿，语气中性。",
      ),
      new HumanMessage(`主题：${state.topic}`),
    ]);
    const text = typeof res.content === "string" ? res.content : "";
    return { draft: text.trim(), check_passed: false, feedback: "" };
  }

  async function checkNode(state: ApprovalGraphState) {
    const res = await checker.invoke([
      new SystemMessage(
        "你是质检编辑。规则：必须提及主题中的核心名词；禁止空洞套话；长度合理。输出 passed 与 feedback。",
      ),
      new HumanMessage(`主题：${state.topic}\n草稿：\n${state.draft}`),
    ]);
    return { check_passed: res.passed, feedback: res.feedback };
  }

  async function refineNode(state: ApprovalGraphState) {
    const res = await model.invoke([
      new SystemMessage("根据反馈改写草稿，保持原意，仍 80～150 字。"),
      new HumanMessage(
        `主题：${state.topic}\n当前草稿：\n${state.draft}\n反馈：\n${state.feedback}`,
      ),
    ]);
    const text = typeof res.content === "string" ? res.content : "";
    return {
      draft: text.trim(),
      refineCount: state.refineCount + 1,
      check_passed: false,
      feedback: "",
    };
  }

  return new StateGraph(ApprovalState)
    .addNode("draft", draftNode)
    .addNode("check", checkNode)
    .addNode("refine", refineNode)
    .addEdge(START, "draft")
    .addEdge("draft", "check")
    .addConditionalEdges("check", (state) =>
      routeAfterCheck({
        check_passed: state.check_passed,
        refineCount: state.refineCount,
        maxRefinements: state.maxRefinements,
      }),
      {
        [END]: END,
        refine: "refine",
      },
    )
    .addEdge("refine", "check");
}
