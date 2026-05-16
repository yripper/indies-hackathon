import type { StructuredToolInterface } from '@langchain/core/tools';
import { echoTool } from './echo';
import { getCurrentTimeTool } from './get-current-time';
import { calculatorTool } from './calculator';
import { extractImageExifTool } from './extract-image-exif';
import { createVerifyC2paTool } from './verify-c2pa-credentials';
import { createComputePerceptualHashTool } from './compute-perceptual-hash';
import { detectDiffusionGenerationTool } from './detect-diffusion-generation';
import { detectFaceManipulationTool } from './detect-face-manipulation';

// A tool factory takes an optional per-tool config slice (from
// `tools.config.<tool_name>` in agent.config.yaml) and returns a ready-to-use
// LangChain tool. Tools that don't need config ignore the argument.
type ToolFactory = (config?: unknown) => StructuredToolInterface;

const REGISTRY: Record<string, ToolFactory> = {
  echo: () => echoTool,
  get_current_time: () => getCurrentTimeTool,
  calculator: () => calculatorTool,
  extract_image_exif: () => extractImageExifTool,
  verify_c2pa_credentials: (cfg) => createVerifyC2paTool(cfg),
  compute_perceptual_hash: (cfg) => createComputePerceptualHashTool(cfg),
  detect_diffusion_generation: () => detectDiffusionGenerationTool,
  detect_face_manipulation: () => detectFaceManipulationTool,
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
