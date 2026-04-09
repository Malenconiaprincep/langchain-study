import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { z } from "zod";

import { retrieveContext } from "./corpus.js";

const CapstoneState = Annotation.Root({
  question: Annotation<string>,
  context: Annotation<string>,
  answer: Annotation<string>,
  want_ticket: Annotation<boolean>,
  ticket_draft: Annotation<string>,
  status: Annotation<string>,
});

export type CapstoneStateType = typeof CapstoneState.State;

export function buildDocTicketGraph(model: ChatOpenAI) {
  function retrieveNode(state: CapstoneStateType) {
    const context = retrieveContext(state.question, 2);
    return { context, answer: "", want_ticket: false, ticket_draft: "", status: "retrieved" };
  }

  async function answerNode(state: CapstoneStateType) {
    const res = await model.invoke([
      new SystemMessage(
        "你是内部知识助手。仅依据「参考资料」作答；若资料不足请明确说不知道并建议联系 IT。回答简洁。",
      ),
      new HumanMessage(
        `用户问题：${state.question}\n\n参考资料：\n${state.context}`,
      ),
    ]);
    const text = typeof res.content === "string" ? res.content : "";
    return { answer: text.trim(), status: "answered" };
  }

  function humanTicketNode(state: CapstoneStateType) {
    const decision = interrupt({
      step: "confirm_ticket",
      question: state.question,
      answerPreview: state.answer.slice(0, 2000),
    });
    const s = String(decision).trim().toLowerCase();
    const yes =
      s === "y" ||
      s === "yes" ||
      s === "是" ||
      s === "好" ||
      s === "建单";
    return { want_ticket: yes };
  }

  async function writeTicketNode(state: CapstoneStateType) {
    const TicketSchema = z.object({
      title: z.string(),
      body: z.string(),
    });
    const structured = model.withStructuredOutput(TicketSchema);
    const out = await structured.invoke([
      new SystemMessage(
        "根据用户问题与助手回答，生成一条内部工单草稿（标题简短、正文含复现步骤或需求描述）。",
      ),
      new HumanMessage(
        `问题：${state.question}\n\n助手回答：\n${state.answer}`,
      ),
    ]);
    return {
      ticket_draft: JSON.stringify(out, null, 2),
      status: "ticket_draft",
    };
  }

  function skipTicketNode() {
    return { ticket_draft: "", status: "no_ticket" };
  }

  function routeTicket(state: CapstoneStateType): "write_ticket" | "skip" {
    return state.want_ticket ? "write_ticket" : "skip";
  }

  return new StateGraph(CapstoneState)
    .addNode("retrieve", retrieveNode)
    .addNode("answer", answerNode)
    .addNode("human_ticket", humanTicketNode)
    .addNode("write_ticket", writeTicketNode)
    .addNode("skip", skipTicketNode)
    .addEdge(START, "retrieve")
    .addEdge("retrieve", "answer")
    .addEdge("answer", "human_ticket")
    .addConditionalEdges("human_ticket", routeTicket, {
      write_ticket: "write_ticket",
      skip: "skip",
    })
    .addEdge("write_ticket", END)
    .addEdge("skip", END);
}
