import "dotenv/config";

const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(
  /\/$/,
  "",
);
const apiKey = process.env.OPENAI_API_KEY;

/** 部分网关（如 sub2api）非流式返回结构不完整，默认走 SSE 流式。设为 false 使用一次性 JSON。 */
const useStream = (process.env.OPENAI_STREAM ?? "true").toLowerCase() !== "false";

type StreamChunk = {
  choices?: Array<{
    delta?: { content?: string | null; reasoning_content?: string | null };
  }>;
};

function extractDeltaText(chunk: StreamChunk): string {
  const delta = chunk.choices?.[0]?.delta;
  if (!delta) return "";
  const parts = [delta.content, delta.reasoning_content].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  return parts.join("");
}

/** 解析 OpenAI 兼容的 chat completions SSE：每行 `data: {...}` 或 `data: [DONE]` */
async function readChatCompletionStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.replace(/^data:\s*/, "");
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as StreamChunk;
        full += extractDeltaText(json);
      } catch {
        // 忽略非 JSON 行（如心跳）
      }
    }
  }

  if (buffer.trim()) {
    const trimmed = buffer.trim();
    if (trimmed.startsWith("data:")) {
      const payload = trimmed.replace(/^data:\s*/, "");
      if (payload !== "[DONE]") {
        try {
          full += extractDeltaText(JSON.parse(payload) as StreamChunk);
        } catch {
          /* ignore */
        }
      }
    }
  }

  return full;
}

async function main(): Promise<void> {
  if (!apiKey) {
    console.error(
      "缺少 OPENAI_API_KEY。请复制 .env.example 为 .env 并填入密钥后重试。",
    );
    process.exitCode = 1;
    return;
  }

  const body = {
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0.2,
    stream: useStream,
    messages: [
      {
        role: "system",
        content: "You reply in one short sentence.",
      },
      {
        role: "user",
        content: "Say hello and mention you are ready for LangChain study.",
      },
    ],
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`HTTP ${res.status}: ${text}`);
    process.exitCode = 1;
    return;
  }

  let content: string;

  if (useStream) {
    if (!res.body) {
      console.error("流式响应缺少 body");
      process.exitCode = 1;
      return;
    }
    content = await readChatCompletionStream(res.body);
  } else {
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    content = data.choices?.[0]?.message?.content ?? "";
  }

  if (!content.trim()) {
    console.error(
      "未解析到模型正文。若网关仅支持流式，请保持 OPENAI_STREAM=true（默认）；否则检查网关返回的 SSE 字段是否与 OpenAI delta.content 一致。",
    );
    process.exitCode = 1;
    return;
  }

  console.log("模型回复：\n", content.trim());
}

void main();
