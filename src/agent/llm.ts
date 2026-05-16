import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
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
  return new ChatOpenAI({
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.max_tokens,
  });
}
