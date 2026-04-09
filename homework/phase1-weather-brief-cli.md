# Phase 1 assignment: City weather brief CLI

> Personal practice for learning LangChain.js. You can mention it briefly on your resume when done.

## Goal

Without step-by-step instructions in this file, read the [LangChain docs](https://docs.langchain.com/) (**JavaScript / TypeScript**) and build a small runnable program that covers: **multi-turn chat, a real HTTP tool, structured output, and basic errors + timeouts**.

## Specification

### Functional requirements

1. **Multi-turn dialogue**  
   Use `readline` (or equivalent) in a loop; user types `quit` or `exit` to stop.

2. **At least one real HTTP tool**  
   Call a **public weather-related API that needs no API key**. Suggested pair:  
   - [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) (city name → lat/lon)  
   - [Open-Meteo Forecast API](https://open-meteo.com/en/docs) (lat/lon → forecast)  

   The user may ask in natural language (e.g. “Is tomorrow a good day to go out in Shanghai?”). The model decides when to call the tool; the tool performs the HTTP request and returns text or a JSON string the model can use.

3. **Structured output (required)**  
   On the path to the final user-facing answer, you must produce a **schema-constrained structured object**, for example:

   | Field | Description |
   |--------|-------------|
   | `city` | Resolved city name (or display label) |
   | `latitude` | Latitude |
   | `longitude` | Longitude |
   | `summary` | Short weather summary (grounded in tool results—do not invent facts) |
   | `recommendation` | Enum: `good` \| `not_great` \| `uncertain` (or Chinese equivalents if you prefer, but keep the enum fixed in code/schema) |

   Implementation is up to you: `withStructuredOutput`, official structured-output patterns, etc. (align with `structured-output.ts` in this repo).  
   **Note:** For non-OpenAI model IDs (e.g. SiliconFlow), pass `{ method: "functionCalling" }` to `withStructuredOutput` so the stack does not default to `jsonSchema` and then try to parse Markdown as JSON.

4. **Error handling**  
   - Time out HTTP requests (about **8s** with `AbortController` is reasonable).  
   - If the city cannot be resolved, the API returns 4xx/5xx, or the network fails: **do not crash the process**; the assistant should explain in natural language.

### Technical requirements

- Use this repo’s **`createModel`** (`src/lib/model.ts`) or an equivalent wrapper; configure `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, etc. via `.env` (same idea as `chat-tool-cli`).
- Add a `package.json` script, e.g. `phase1:weather`, for one-command runs.

### Self-test checklist (before you consider it done)

- [ ] A query like “Beijing” or “Shanghai” yields a brief that includes the structured fields.  
- [ ] A clearly fake place name gives a friendly error and no crash.  
- [ ] Two turns with different cities still behave sensibly (you may trim history by message count, similar to `trimHistory` in `chat-tool-cli`).

### Acceptance criteria

- [ ] Multi-turn CLI + exit command  
- [ ] Real HTTP tool (Open-Meteo or equivalent) + timeout  
- [ ] At least one **schema-constrained** structured output (TypeScript types or Zod, etc.)  
- [ ] Failure paths do not crash the process  

## Suggested order of work (adjust as you like)

1. Get `fetch` to Open-Meteo working (standalone function or tool) with no key.  
2. Wire `ChatOpenAI` + `bindTools` so tool calls fire.  
3. Add structured output (pick a clear order vs. tools; add a one-line comment in code explaining why).  
4. Finish multi-turn history + trimming and user-facing error messages.

## If you push to GitHub

- Do **not** commit `.env`; keep variable descriptions in `.env.example`.  
- In the root README, briefly document install, env vars, and `npm run phase1:weather` (you can link to this file).

## References

- [LangChain OSS docs](https://docs.langchain.com/) (JS/TS)  
- [Open-Meteo docs](https://open-meteo.com/en/docs)  

---

If you get stuck on an API or design tradeoff, note the error and the data flow, then re-read the docs or ask—usually faster than guessing.
