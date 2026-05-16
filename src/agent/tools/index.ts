import type { StructuredToolInterface } from '@langchain/core/tools';
import { echoTool } from './echo';
import { getCurrentTimeTool } from './get-current-time';
import { calculatorTool } from './calculator';

// A tool factory takes an optional per-tool config slice (from
// `tools.config.<tool_name>` in agent.config.yaml) and returns a ready-to-use
// LangChain tool. Tools that don't need config ignore the argument.
type ToolFactory = (config?: unknown) => StructuredToolInterface;

const REGISTRY: Record<string, ToolFactory> = {
  echo: () => echoTool,
  get_current_time: () => getCurrentTimeTool,
  calculator: () => calculatorTool,
};

export function resolveTools(
  enabled: string[],
  toolsConfig: Record<string, unknown> = {},
): StructuredToolInterface[] {
  return enabled.map((name) => {
    const factory = REGISTRY[name];
    if (!factory) {
      throw new Error(
        `Unknown tool in agent.config.yaml: ${name}. Available: ${Object.keys(REGISTRY).join(', ')}`,
      );
    }
    return factory(toolsConfig[name]);
  });
}

export function listAvailableTools(): string[] {
  return Object.keys(REGISTRY);
}
