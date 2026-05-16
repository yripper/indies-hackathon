import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AgentConfig } from '../config/agent-config';

export function buildLlm(config: AgentConfig['provider']): BaseChatModel {
  console.log('[src/agent/llm.ts] buildLlm', {
    provider: config.name,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.max_tokens,
    anthropicKeySet: Boolean(process.env.ANTHROPIC_API_KEY),
    openaiKeySet: Boolean(process.env.OPENAI_API_KEY),
  });
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
  // GPT-5.x / o1 models reject the legacy `max_tokens` param and require
  // `max_completion_tokens` instead. @langchain/openai 0.3.17 only types
  // `maxTokens` (which maps to max_tokens), so we forward the new field via
  // modelKwargs and leave maxTokens unset.
  return new ChatOpenAI({
    model: config.model,
    temperature: config.temperature,
    modelKwargs: { max_completion_tokens: config.max_tokens },
  });
}
