import { END } from "@langchain/langgraph";

/** 纯函数：便于单测，与阶段二条件边逻辑一致 */
export function routeAfterCheck(state: {
  check_passed: boolean;
  refineCount: number;
  maxRefinements: number;
}): typeof END | "refine" {
  if (state.check_passed) return END;
  if (state.refineCount < state.maxRefinements) return "refine";
  return END;
}
