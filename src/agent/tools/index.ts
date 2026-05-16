import type { StructuredToolInterface } from '@langchain/core/tools';
import { echoTool } from './echo';
import { getCurrentTimeTool } from './get-current-time';
import { calculatorTool } from './calculator';
import { detectDeepfakeVideoTool } from './detect-deepfake-video';

const REGISTRY: Record<string, StructuredToolInterface> = {
  echo: echoTool,
  get_current_time: getCurrentTimeTool,
  calculator: calculatorTool,
  detect_deepfake_video: detectDeepfakeVideoTool,
};

export function resolveTools(enabled: string[]): StructuredToolInterface[] {
  return enabled.map((name) => {
    const t = REGISTRY[name];
    if (!t) {
      throw new Error(
        `Unknown tool in agent.config.yaml: ${name}. Available: ${Object.keys(REGISTRY).join(', ')}`,
      );
    }
    return t;
  });
}

export function listAvailableTools(): string[] {
  return Object.keys(REGISTRY);
}
