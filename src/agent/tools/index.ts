import type { StructuredToolInterface } from '@langchain/core/tools';
import { echoTool } from './echo';
import { getCurrentTimeTool } from './get-current-time';
import { calculatorTool } from './calculator';
import { analyzeAudioDeepfakeTool } from './analyze-audio-deepfake';
import { analyzeImageDeepfakeTool } from './analyze-image-deepfake';

const REGISTRY: Record<string, StructuredToolInterface> = {
  echo: echoTool,
  get_current_time: getCurrentTimeTool,
  calculator: calculatorTool,
  analyze_audio_deepfake: analyzeAudioDeepfakeTool,
  analyze_image_deepfake: analyzeImageDeepfakeTool,
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
