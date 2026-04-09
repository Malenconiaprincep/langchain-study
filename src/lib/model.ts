import { ChatOpenAI } from "@langchain/openai";

export function createModel(
  overrides?: Partial<ConstructorParameters<typeof ChatOpenAI>[0]>,
): ChatOpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 OPENAI_API_KEY，请复制 .env.example 为 .env 并填写");
  }
  const baseURL = process.env.OPENAI_BASE_URL?.replace(/\/$/, "");
  return new ChatOpenAI({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0.2,
    apiKey,
    timeout: Number(process.env.OPENAI_TIMEOUT_MS ?? "120000"),
    maxRetries: 1,
    configuration: baseURL ? { baseURL } : undefined,
    ...overrides,
  });
}
