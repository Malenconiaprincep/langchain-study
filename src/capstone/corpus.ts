/** 结业项目：内存「知识库」片段（演示 RAG 流程，非生产向量库） */
export const CORPUS_CHUNKS: { id: string; text: string }[] = [
  {
    id: "vpn",
    text: "新员工入职首日需完成：申请 VPN、配置企业邮箱、在内部门户激活账号。IT 工单分类选「账号与访问」。",
  },
  {
    id: "langgraph",
    text: "LangGraph 适合需要状态、检查点与人机协同的 LLM 流程；与纯线性 Chain 相比，分支与重试更可观测。",
  },
  {
    id: "release",
    text: "生产发布需经过：灰度、回滚预案、值班负责人确认。若涉及模型提示词变更，需额外走安全评审工单。",
  },
];

export function retrieveContext(question: string, topK = 2): string {
  const q = question.toLowerCase();
  const tokens = q.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1);
  const scored = CORPUS_CHUNKS.map((c) => {
    const text = c.text.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (text.includes(t)) score += 1;
    }
    return { id: c.id, text: c.text, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const pick = scored.slice(0, topK).filter((s) => s.score > 0);
  if (pick.length === 0) {
    return CORPUS_CHUNKS.map((c) => `[${c.id}] ${c.text}`).join("\n\n");
  }
  return pick.map((p) => `[${p.id}] ${p.text}`).join("\n\n");
}
