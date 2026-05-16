import {
  BaseChatModel,
  type BaseChatModelParams,
  type BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';

export type ScriptedResponse =
  | { type: 'text'; content: string }
  | {
      type: 'tool_call';
      toolName: string;
      args: Record<string, unknown>;
      toolCallId?: string;
    };

export class MockChatModel extends BaseChatModel {
  private cursor = 0;
  private boundTools: BindToolsInput[] = [];

  constructor(
    private readonly script: ScriptedResponse[],
    params?: BaseChatModelParams,
  ) {
    super(params ?? {});
  }

  _llmType(): string {
    return 'mock';
  }

  // Override the optional bindTools from BaseChatModel — returns `this` so
  // chained calls (e.g. model.bindTools([...]).invoke(...)) work in tests.
  override bindTools(tools: BindToolsInput[]): this {
    this.boundTools = tools;
    return this;
  }

  async _generate(
    _messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const step = this.script[this.cursor];
    if (!step) {
      throw new Error(`MockChatModel script exhausted at cursor ${this.cursor}`);
    }
    this.cursor += 1;

    if (step.type === 'text') {
      const msg = new AIMessage({ content: step.content });
      return { generations: [{ text: step.content, message: msg }] };
    }

    const callId = step.toolCallId ?? `call_${this.cursor}`;
    const msg = new AIMessage({
      content: '',
      tool_calls: [
        {
          name: step.toolName,
          args: step.args,
          id: callId,
          type: 'tool_call',
        },
      ],
    });
    return { generations: [{ text: '', message: msg }] };
  }
}
