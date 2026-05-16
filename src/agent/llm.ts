import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { env } from '../config/env';
import type { AgentConfig } from '../config/agent-config';

export function buildLlm(config: AgentConfig['provider']): BaseChatModel {
  if (config.name === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set, but agent.config.yaml selects anthropic.');
    }
    return new ChatAnthropic({
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.max_tokens,
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set, but agent.config.yaml selects openai.');
  }

  // The "openai" provider also covers any OpenAI-compatible endpoint (MiniMax,
  // Groq, DeepSeek, Together, etc.) — set OPENAI_BASE_URL in .env to switch.
  // GPT-5.x and most reasoning models reject the legacy `max_tokens` param and
  // require `max_completion_tokens`. @langchain/openai 0.3.17 only types
  // `maxTokens` (legacy), so we forward the new field via modelKwargs and
  // leave maxTokens unset.
  const baseURL = env.OPENAI_BASE_URL.length > 0 ? env.OPENAI_BASE_URL : undefined;
  return new ChatOpenAI({
    model: config.model,
    temperature: config.temperature,
    modelKwargs: { max_completion_tokens: config.max_tokens },
    ...(baseURL ? { configuration: { baseURL } } : {}),
  });
}
