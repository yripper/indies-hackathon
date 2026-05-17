import type { StructuredToolInterface } from '@langchain/core/tools';
import { echoTool } from './echo';
import { getCurrentTimeTool } from './get-current-time';
import { calculatorTool } from './calculator';
import {
  createDetectDeepfakeVideoTool,
  detectDeepfakeVideoTool,
} from './detect-deepfake-video';
import {
  createAnalyzeAudioDeepfakeTool,
  analyzeAudioDeepfakeTool,
} from './analyze-audio-deepfake';
import {
  createAnalyzeImageDeepfakeTool,
  analyzeImageDeepfakeTool,
} from './analyze-image-deepfake';
import {
  createScanUrlDeepfakeTool,
  scanUrlDeepfakeTool,
} from './scan-url-deepfake';
import { verificarNoticiaTool } from './fact-check-claim';

export type SendImageFn = (imageBuffer: Buffer, caption?: string) => Promise<void>;

export type ResolveToolsOptions = {
  /** When provided, deepfake tools will send authenticity certificates via this function. */
  sendImage?: SendImageFn;
};

function buildRegistry(
  options: ResolveToolsOptions = {},
): Record<string, StructuredToolInterface> {
  const { sendImage } = options;
  return {
    echo: echoTool,
    get_current_time: getCurrentTimeTool,
    calculator: calculatorTool,
    detect_deepfake_video: sendImage
      ? createDetectDeepfakeVideoTool(sendImage)
      : detectDeepfakeVideoTool,
    analyze_audio_deepfake: sendImage
      ? createAnalyzeAudioDeepfakeTool(sendImage)
      : analyzeAudioDeepfakeTool,
    analyze_image_deepfake: sendImage
      ? createAnalyzeImageDeepfakeTool(sendImage)
      : analyzeImageDeepfakeTool,
    scan_url_deepfake: sendImage
      ? createScanUrlDeepfakeTool(sendImage)
      : scanUrlDeepfakeTool,
    verificar_noticia: verificarNoticiaTool,
  };
}

export function resolveTools(
  enabled: string[],
  options: ResolveToolsOptions = {},
): StructuredToolInterface[] {
  const registry = buildRegistry(options);
  return enabled.map((name) => {
    const t = registry[name];
    if (!t) {
      throw new Error(
        `Unknown tool in agent.config.yaml: ${name}. Available: ${Object.keys(registry).join(', ')}`,
      );
    }
    return t;
  });
}

export function listAvailableTools(): string[] {
  return Object.keys(buildRegistry());
}
