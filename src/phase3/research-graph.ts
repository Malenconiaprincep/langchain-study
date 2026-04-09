import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph, interrupt } from "@langchain/langgraph";

import { wikipediaSearch } from "../lib/wikipedia.js";

const ResearchState = Annotation.Root({
  topic: Annotation<string>,
  search_blob: Annotation<string>,
  report: Annotation<string>,
  approved: Annotation<boolean>,
  status: Annotation<string>,
});

export type ResearchStateType = typeof ResearchState.State;

export function buildResearchGraph(model: ChatOpenAI) {
  async function searchNode(state: ResearchStateType) {
    const ms = Number(process.env.TOOL_HTTP_TIMEOUT_MS ?? "8000");
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try {
      const hits = await wikipediaSearch(state.topic, ac.signal);
      return {
        search_blob: JSON.stringify(hits, null, 2),
        report: "",
        approved: false,
        status: "search_done",
      };
    } finally {
      clearTimeout(t);
    }
  }

  async function writeReportNode(state: ResearchStateType) {
    const res = await model.invoke([
      new SystemMessage(
        "你是研究助理。仅根据提供的检索摘要写作，勿编造出处。用中文输出结构化短文：概述、要点列表、末尾注明「摘要来自 Wikipedia 搜索，需自行核实」。",
      ),
      new HumanMessage(
        `研究主题：${state.topic}\n\n检索结果（JSON）：\n${state.search_blob}`,
      ),
    ]);
    const text = typeof res.content === "string" ? res.content : "";
    return { report: text.trim(), status: "draft_ready" };
  }

  function humanGateNode(state: ResearchStateType) {
    const decision = interrupt({
      step: "confirm_publish",
      topic: state.topic,
      reportPreview: state.report.slice(0, 2500),
    });
    const s = String(decision).trim().toLowerCase();
    const ok =
      s === "y" ||
      s === "yes" ||
      s === "approve" ||
      s === "是" ||
      s === "确认";
    return { approved: ok };
  }

  function publishNode() {
    return { status: "published" };
  }

  function cancelNode() {
    return { status: "cancelled" };
  }

  function routeAfterHuman(state: ResearchStateType): "publish" | "cancel" {
    return state.approved ? "publish" : "cancel";
  }

  return new StateGraph(ResearchState)
    .addNode("search", searchNode)
    .addNode("write_report", writeReportNode)
    .addNode("human_gate", humanGateNode)
    .addNode("publish", publishNode)
    .addNode("cancel", cancelNode)
    .addEdge(START, "search")
    .addEdge("search", "write_report")
    .addEdge("write_report", "human_gate")
    .addConditionalEdges("human_gate", routeAfterHuman, {
      publish: "publish",
      cancel: "cancel",
    })
    .addEdge("publish", END)
    .addEdge("cancel", END);
}
