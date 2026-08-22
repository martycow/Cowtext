// `ProviderIconId` → glyph (WO15 Block 3a). The id comes from
// `models.json`'s `icon` key, so adding a provider there is a compile error
// here until its glyph exists — which is the point: a chip with no icon is a
// chip that looks broken.

import type { ComponentType } from "react";
import type { ProviderIconId } from "../../resources";
import { AnthropicIcon } from "./Anthropic";
import { OpenAIIcon } from "./OpenAI";
import { GeminiIcon } from "./Gemini";
import { CursorIcon } from "./Cursor";
import { CopilotIcon } from "./Copilot";

export interface ProviderIconProps {
  /** Square, in px. 16 is the chip size; 13 reads better inline. */
  size?: number;
  className?: string;
}

export const PROVIDER_ICONS: Record<ProviderIconId, ComponentType<ProviderIconProps>> = {
  anthropic: AnthropicIcon,
  openai: OpenAIIcon,
  gemini: GeminiIcon,
  cursor: CursorIcon,
  copilot: CopilotIcon,
};

export { AnthropicIcon, OpenAIIcon, GeminiIcon, CursorIcon, CopilotIcon };
