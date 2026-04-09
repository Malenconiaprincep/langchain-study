import "dotenv/config";

import { HumanMessage } from "@langchain/core/messages";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createAgent, tool } from "langchain";
import { z } from "zod";

import { createModel } from "../lib/model.js";
import { buildApprovalGraph } from "../phase2/approval-graph.js";

const PORT = Number(process.env.PHASE4_PORT ?? "3840");

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sseWrite(res: ServerResponse, obj: unknown): void {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

/**
 * 阶段四：SSE 推送图节点 updates + createAgent 流式事件（供前端 EventSource/fetch 消费）。
 */
async function main(): Promise<void> {
  const server = createServer(async (req, res) => {
    const url = req.url ?? "";
    if (req.method === "GET" && url === "/health") {
      json(res, 200, { ok: true, service: "phase4-sse" });
      return;
    }

    if (req.method === "POST" && url === "/api/stream/approval") {
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req);
      } catch {
        json(res, 400, { error: "invalid JSON" });
        return;
      }
      const topic = String(body.topic ?? "").trim();
      if (!topic) {
        json(res, 400, { error: "body.topic 必填" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      try {
        const model = createModel();
        const compiled = buildApprovalGraph(model).compile();
        const stream = await compiled.stream(
          {
            topic,
            draft: "",
            check_passed: false,
            feedback: "",
            refineCount: 0,
            maxRefinements: 3,
          },
          { streamMode: "updates" },
        );
        for await (const chunk of stream) {
          sseWrite(res, { type: "approval_update", chunk });
        }
        sseWrite(res, { type: "done" });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        sseWrite(res, { type: "error", message });
      }
      res.end();
      return;
    }

    if (req.method === "POST" && url === "/api/stream/agent") {
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req);
      } catch {
        json(res, 400, { error: "invalid JSON" });
        return;
      }
      const query = String(body.query ?? "").trim();
      if (!query) {
        json(res, 400, { error: "body.query 必填" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      try {
        const model = createModel();
        const echoTicket = tool(
          async ({ title, body: ticketBody }: { title: string; body: string }) =>
            JSON.stringify({
              ok: true,
              ticketId: `draft-${Date.now()}`,
              title,
              body: ticketBody,
            }),
          {
            name: "create_ticket_draft",
            description: "创建内部工单草稿（演示用，不落库）。需要标题与正文。",
            schema: z.object({
              title: z.string(),
              body: z.string(),
            }),
          },
        );

        const agent = createAgent({
          model,
          tools: [echoTicket],
          systemPrompt:
            "你是内部助手。用户若要建工单，先澄清需求，再调用 create_ticket_draft。回答简短。",
        });

        const stream = await agent.stream({
          messages: [new HumanMessage(query)],
        });

        for await (const ev of stream) {
          sseWrite(res, { type: "agent_event", ev });
        }
        sseWrite(res, { type: "done" });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        sseWrite(res, { type: "error", message });
      }
      res.end();
      return;
    }

    json(res, 404, { error: "not found" });
  });

  server.listen(PORT, () => {
    console.error(
      `阶段四 SSE 已监听 http://127.0.0.1:${PORT} （POST /api/stream/approval | /api/stream/agent）`,
    );
  });
}

void main();
