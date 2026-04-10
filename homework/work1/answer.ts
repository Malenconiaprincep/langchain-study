import "dotenv/config";

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createModel } from "../../src/lib/model.js";

/** 设计说明：先 bindTools 循环拉取 Open-Meteo 事实，再单独用 withStructuredOutput 生成 BriefSchema，避免同一轮里「业务 tool」与「结构化输出」争用模型 function 能力。 */

const MAX_HISTORY_MESSAGES = 24;
const MAX_TOOL_ROUNDS = 10;
const HTTP_TIMEOUT_MS = Number(process.env.TOOL_HTTP_TIMEOUT_MS ?? "8000");

const BriefSchema = z.object({
  city: z.string().describe("城市名称"),
  latitude: z.number().describe("纬度"),
  longitude: z.number().describe("经度"),
  summary: z.string().describe("天气要点摘要"),
  recommendation: z.enum(["适合", "不太适合", "不确定"]).describe("天气推荐"),
});

type WeatherBrief = z.infer<typeof BriefSchema>;

function weatherCodeSummary(code: number): string {
  if (code === 0) return "晴朗";
  if (code <= 3) return "多云为主";
  if (code <= 48) return "有雾或霾";
  if (code <= 57) return "小降水";
  if (code <= 67) return "降雨";
  if (code <= 77) return "降雪";
  if (code <= 82) return "阵雨";
  if (code <= 86) return "阵雪";
  if (code <= 99) return "雷暴或强对流";
  return `天气代码 ${code}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal });
    const text = await res.text();
    if (!res.ok) {
      return { error: `HTTP ${res.status}`, body: text.slice(0, 500) };
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { error: "invalid_json", body: text.slice(0, 300) };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg };
  } finally {
    clearTimeout(timer);
  }
}

const lookupCityWeatherTool = tool(
  async ({ city }: { city: string }) => {
    const q = city.trim();
    if (!q) {
      return JSON.stringify({ error: "城市名为空" });
    }
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=zh`;
    const geo = (await fetchJson(geoUrl)) as Record<string, unknown>;
    if ("error" in geo) {
      return JSON.stringify(geo);
    }
    const results = geo.results as
      | Array<{ name: string; latitude: number; longitude: number; country?: string }>
      | undefined;
    if (!results?.length) {
      return JSON.stringify({ error: `未找到城市：${q}` });
    }
    const top = results[0]!;
    const lat = top.latitude;
    const lon = top.longitude;
    const fcUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`;
    const fc = (await fetchJson(fcUrl)) as Record<string, unknown>;
    if ("error" in fc) {
      return JSON.stringify({ ...fc, city: top.name, latitude: lat, longitude: lon });
    }
    const cw = fc.current_weather as
      | { temperature?: number; weathercode?: number; windspeed?: number }
      | undefined;
    const temp = cw?.temperature;
    const code = cw?.weathercode;
    const wind = cw?.windspeed;
    const condition =
      typeof code === "number" ? weatherCodeSummary(code) : "未知";
    return JSON.stringify({
      city: top.name,
      country: top.country,
      latitude: lat,
      longitude: lon,
      current_temperature_c: temp,
      weather_summary: condition,
      windspeed_kmh: wind,
      raw_weathercode: code,
    });
  },
  {
    name: "lookup_city_weather",
    description:
      "根据城市名查询当前天气（Open-Meteo：先地理编码再预报）。用户提到城市、出门、天气时使用；不要编造气温。",
    schema: z.object({
      city: z.string().describe("用户关心的城市名，如 上海、北京"),
    }),
  },
);

const tools = [lookupCityWeatherTool];

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

/**
 * Tool 阶段：模型可多次调用 lookup_city_weather，直到不再发起 tool_calls。
 */
async function runToolPhase(
  model: ReturnType<typeof createModel>,
  messages: BaseMessage[],
): Promise<void> {
  const bound = model.bindTools(tools, { parallel_tool_calls: false });
  let round = 0;
  while (round < MAX_TOOL_ROUNDS) {
    round += 1;
    const ai = (await bound.invoke(messages)) as AIMessage;
    messages.push(ai);
    const calls = ai.tool_calls?.filter((c) => c.name) ?? [];
    if (calls.length === 0) break;
    for (const call of calls) {
      const result = await dispatchTool(call);
      messages.push(
        new ToolMessage({
          content: result,
          tool_call_id: toolCallId(call),
          name: call.name!,
        }),
      );
    }
  }
}

async function runStructuredBrief(
  model: ReturnType<typeof createModel>,
  messages: BaseMessage[],
): Promise<WeatherBrief> {
  const structured = model.withStructuredOutput(BriefSchema);
  return structured.invoke([
    ...messages,
    new HumanMessage(
      "请仅根据对话中 lookup_city_weather 返回的 JSON 事实生成最终天气简报；若工具返回 error 或未调用工具，summary 用中文说明原因，latitude/longitude 可填 0，recommendation 用「不确定」，禁止编造 tool 中未出现的温度或天气。",
    ),
  ]) as Promise<WeatherBrief>;
}

async function runAssistantTurn(
  model: ReturnType<typeof createModel>,
  messages: BaseMessage[],
): Promise<WeatherBrief> {
  trimHistory(messages);
  await runToolPhase(model, messages);
  return runStructuredBrief(model, messages);
}

async function main(): Promise<void> {
  const model = createModel();
  const messages: BaseMessage[] = [
    new SystemMessage(
      "你是天气简报助手。用户会用自然语言问某城市天气或是否适合出门。必须先使用 lookup_city_weather 获取公开接口事实，不要编造气温、天气代码。若地名无效，根据工具错误用中文说明。",
    ),
  ];

  const rl = readline.createInterface({ input, output });
  process.stdout.write(
    "城市天气简报：输入城市或自然语言问题；输入 quit / exit 退出。\n",
  );

  try {
    while (true) {
      const line = (await rl.question("\n你: ")).trim();
      if (line === "quit" || line === "exit") break;
      if (!line) continue;

      messages.push(new HumanMessage(line));
      trimHistory(messages);

      try {
        const brief = await runAssistantTurn(model, messages);
        console.log(`\n简报:\n${JSON.stringify(brief, null, 2)}`);
        messages.push(
          new AIMessage(
            `已向用户输出简报：${brief.city}，${brief.summary}；建议：${brief.recommendation}。`,
          ),
        );
        trimHistory(messages);
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
