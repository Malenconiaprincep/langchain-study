import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { retrieveContext } from "../capstone/corpus.js";

describe("retrieveContext", () => {
  it("关键词命中时优先返回相关片段", () => {
    const ctx = retrieveContext("LangGraph 和状态机有什么关系？", 2);
    assert.match(ctx, /LangGraph/i);
  });

  it("无命中时回退为全量拼接", () => {
    const ctx = retrieveContext("@@@###", 2);
    assert.match(ctx, /VPN/);
  });
});
