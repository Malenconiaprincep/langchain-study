import "dotenv/config";

import { createModel } from "../lib/model.js";
import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import { tool } from "@langchain/core/tools";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { z } from "zod";

const MAX_HISTORY_MESSAGES = 24;
const MAX_TOOL_ROUNDS = 10;

const githubRepoTool = tool(
  async ({ owner, repo }) => {
    const ms = Number(process.env.TOOL_HTTP_TIMEOUT_MS ?? "8000");
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    try {
      const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
      const res = await fetch(url, {
        signal: ac.signal,
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "langchain-new-phase1",
        },
      });
      const text = await res.text();
      if (!res.ok) {
        return JSON.stringify({
          error: `HTTP ${res.status}`,
          body: text.slice(0, 500),
        });
      }
      const data = JSON.parse(text) as Record<string, unknown>;
      return JSON.stringify({
        full_name: data.full_name,
        description: data.description,
        stargazers_count: data.stargazers_count,
        language: data.language,
        html_url: data.html_url,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return JSON.stringify({ error: msg });
    } finally {
      clearTimeout(timer);
    }
  },
  {
    name: "github_repo_lookup",
    description:
      "查询 GitHub 公开仓库的元信息（描述、星标、语言、链接）。用户提到具体 owner/repo、想对比或了解某开源项目时使用。",
    schema: z.object({
      owner: z.string().describe("所有者或组织，如 langchain-ai"),
      repo: z.string().describe("仓库名，如 langchain"),
    }),
  },
);

const tools = [githubRepoTool];

function trimHistory(messages: BaseMessage[]): void {
  if (messages.length <= 1 + MAX_HISTORY_MESSAGES) return;
  const head = messages[0];
  const tail = messages.slice(-MAX_HISTORY_MESSAGES);
  messages.length = 0;
  messages.push(head!, ...tail);
}

function toolCallId(call: ToolCall): string {
  return call.id ?? `call_${Date.now()}_${call.name}`;
}

async function dispatchTool(call: ToolCall): Promise<string> {
  const t = tools.find((x) => x.name === call.name);
  if (!t) {
    return JSON.stringify({ error: `未知工具: ${call.name}` });
  }
  try {
    const out = await t.invoke(call.args as never);
    return typeof out === "string" ? out : JSON.stringify(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ error: msg });
  }
}

function messageTextContent(msg: AIMessage | AIMessageChunk): string {
  const c = msg.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object" && "text" in block) {
        return String((block as { text?: string }).text ?? "");
      }
      return "";
    })
    .join("");
}

/**
 * 一轮助手回复：流式输出正文；若模型发起 tool_calls，执行后自动再请求，直到产出最终文本或达到轮次上限。
 */
async function runAssistantTurn(
  model: ReturnType<typeof createModel>,
  messages: BaseMessage[],
): Promise<void> {
  const bound = model.bindTools(tools, { parallel_tool_calls: false });
  let round = 0;

  while (round < MAX_TOOL_ROUNDS) {
    round += 1;
    let accumulated: AIMessageChunk | null = null;
    let wroteAssistantPrefix = false;

    const stream = await bound.stream(messages);
    for await (const chunk of stream) {
      accumulated = accumulated ? accumulated.concat(chunk) : chunk;
      const piece = chunk.content;
      if (typeof piece === "string" && piece.length > 0) {
        if (!wroteAssistantPrefix) {
          process.stdout.write("\n助手: ");
          wroteAssistantPrefix = true;
        }

        console.log(piece, '>>>piece')
        process.stdout.write(piece);
      }
    }

    if (!accumulated) {
      console.error("\n[错误] 模型流式响应为空");
      return;
    }

    const aiMsg = new AIMessage({
      content: accumulated.content,
      tool_calls: accumulated.tool_calls,
    });
    messages.push(aiMsg);

    const calls = aiMsg.tool_calls?.filter((c) => c.name) ?? [];
    if (calls.length === 0) {
      if (wroteAssistantPrefix) process.stdout.write("\n");
      else {
        const fallback = messageTextContent(aiMsg).trim();
        if (fallback) {
          process.stdout.write(`\n助手: ${fallback}\n`);
        } else {
          process.stdout.write("\n助手: （无文本输出；可换模型或检查网关是否支持流式 tool 调用）\n");
        }
      }
      return;
    }

    for (const call of calls) {
      console.error(`\n[tool] ${call.name} ${JSON.stringify(call.args)}`);
      const result = await dispatchTool(call);
      messages.push(
        new ToolMessage({
          content: result,
          tool_call_id: toolCallId(call),
          name: call.name,
        }),
      );
    }

    console.log(messages, '>>>messages')
  }

  console.error(`\n[错误] 工具轮次超过 ${MAX_TOOL_ROUNDS}，已停止。`);
}

async function main(): Promise<void> {
  const model = createModel();
  const messages: BaseMessage[] = [
    new SystemMessage(
      "你是简洁的技术助手。需要仓库信息时优先使用 github_repo_lookup，不要编造星标或描述。回答尽量简短。",
    ),
  ];

  const rl = readline.createInterface({ input, output });
  process.stdout.write(
    "阶段一 CLI：多轮对话 + GitHub 仓库查询工具。输入 /exit 退出。\n可试：langchain-ai/langchain 仓库有多少星？\n",
  );

  try {
    while (true) {
      const line = (await rl.question("\n你: ")).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;

      messages.push(new HumanMessage(line));
      trimHistory(messages);

      try {
        await runAssistantTurn(model, messages);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`\n[错误] ${msg}`);
        messages.pop();
      }
    }
  } finally {
    rl.close();
  }
}

void main();
