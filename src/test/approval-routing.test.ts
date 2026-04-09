import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { END } from "@langchain/langgraph";

import { routeAfterCheck } from "../lib/approval-routing.js";

describe("routeAfterCheck", () => {
  it("通过质检时结束", () => {
    assert.equal(
      routeAfterCheck({
        check_passed: true,
        refineCount: 0,
        maxRefinements: 3,
      }),
      END,
    );
  });

  it("未通过且未达上限时进入改写", () => {
    assert.equal(
      routeAfterCheck({
        check_passed: false,
        refineCount: 0,
        maxRefinements: 3,
      }),
      "refine",
    );
  });

  it("未通过但已达改写次数上限时结束", () => {
    assert.equal(
      routeAfterCheck({
        check_passed: false,
        refineCount: 3,
        maxRefinements: 3,
      }),
      END,
    );
  });
});
