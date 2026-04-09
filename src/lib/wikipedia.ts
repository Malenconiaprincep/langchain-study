const UA = "langchain-new-study/1.0 (educational; contact: local)";

/** 使用 Wikipedia 公开 API，无需密钥；注意速率与使用条款 */
export async function wikipediaSearch(
  query: string,
  signal?: AbortSignal,
): Promise<{ title: string; snippet: string }[]> {
  const q = query.trim();
  if (!q) return [];
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", q);
  url.searchParams.set("srlimit", "5");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const res = await fetch(url, {
    signal,
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Wikipedia HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    query?: { search?: { title: string; snippet: string }[] };
  };
  const list = data.query?.search ?? [];
  return list.map((s) => ({
    title: s.title,
    snippet: stripHtml(s.snippet),
  }));
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
