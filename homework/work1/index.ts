import 'dotenv/config'

// 多伦对话
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { SystemMessage, HumanMessage, ToolMessage, AIMessage, BaseMessage } from '@langchain/core/messages'
import { z } from 'zod'
import { createModel } from '../../src/lib/model.js'
import { tool } from 'langchain'

console.log(process.env)

// 定义输出结构
const BriefSchema = z.object({
  city: z.string().describe('城市名称'),
  latitude: z.number().describe('纬度'),
  longitude: z.number().describe('经度'),
  summary: z.string().describe('天气要点摘要'),
  recommendation: z.enum(['适合', '不太适合', '不确定']).describe('天气推荐'),
})

// 定义工具
const getWeatherTool = tool(
  async ({ latitude, longitude }: { latitude: number, longitude: number }) => {
    return await getWeatherByLatitudeAndLongitude(latitude, longitude)
  },
  {
    name: 'lookup_city_weather',
    description: '获取城市天气信息',
    schema: z.object({
      city: z.string().describe("用户关心的城市名，如 上海、北京"),
    }),
  }
)

const getWeatherByLatitudeAndLongitude = async (latitude: number, longitude: number) => {
  // return await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`)

  console.log(`获取城市天气信息: ${latitude}, ${longitude}`)

  return {
    city: '北京',
    latitude: 39.9087,
    longitude: 116.3975,
    summary: '晴天',
    recommendation: '适合',
  }
}

async function main() {
  const rl = readline.createInterface({ input, output })

  try {
    while (true) {
      const answer = await rl.question('请输入你要查询的城市: ')
      if (answer.trim() === 'quit' || answer.trim() === 'exit') {
        break
      }

      const weather = await runAssistantTurn(answer)
      console.log(`天气信息: ${JSON.stringify(weather, null, 2)}`)
    }
  } finally {
    rl.close()
  }


}

// 一轮助手回复：流式输出正文；若模型发起 tool_calls，执行后自动再请求，直到产出最终文本或达到轮次上限。
async function runAssistantTurn(city: string) {
  const model = createModel()
  const messages: BaseMessage[] = [
    new SystemMessage('你是天气简报助手。用户会用自然语言问某城市天气或是否适合出门。必须先使用 lookup_city_weather 获取公开接口事实，不要编造气温、天气代码。若地名无效，根据工具错误用中文说明。'),

  ]

  // 绑定 tools
  const modelWithTools = model.bindTools([getWeatherTool])


  const out = await modelWithTools.invoke([
    new SystemMessage('你是天气简报助手。用户会用自然语言问某城市天气或是否适合出门。必须先使用 lookup_city_weather 获取公开接口事实，不要编造气温、天气代码。若地名无效，根据工具错误用中文说明。'),
    new HumanMessage(`请根据城市名称获取天气信息: ${city}`),
    new AIMessage('我需要获取城市天气信息，请使用工具获取'),
    new ToolMessage({
      content: '{"latitude": 39.9087, "longitude": 116.3975}',
      tool_call_id: 'getWeather',
      name: 'getWeather',
    })
  ])
  return out
}


main()
