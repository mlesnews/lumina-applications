/**
 * Voice Actor Service Client
 *
 * Integrates with the Lumina Voice Actor Service (port 11436)
 * for TTS/STT with multiple voice personas.
 *
 * @JARVIS @VOICE @ELEVENLABS @TTS @STT
 */

import axios from "axios";

export interface VoicePersona {
  id: string;
  name: string;
  description: string;
  provider: string;
  icon: string;
  color: string;
}

export interface VoiceQuota {
  available: boolean;
  character_count?: number;
  character_limit?: number;
  remaining?: number;
  tier?: string;
  reason?: string;
}

export interface SynthesizeResult {
  audio_base64: string;
  format: string;
  persona: string;
  cached: boolean;
}

export interface TranscribeResult {
  text: string;
  confidence?: number;
}

/**
 * Default personas matching voice_actor_service.py
 */
export const DEFAULT_PERSONAS: VoicePersona[] = [
  {
    id: "jarvis",
    name: "JARVIS",
    description: "Just A Rather Very Intelligent System - Primary AI assistant",
    provider: "elevenlabs",
    icon: "🤖",
    color: "#4a9eff",
  },
  {
    id: "friday",
    name: "F.R.I.D.A.Y.",
    description: "Female Replacement Intelligent Digital Assistant Youth",
    provider: "elevenlabs",
    icon: "👩‍💻",
    color: "#ff6b9d",
  },
  {
    id: "ultron",
    name: "ULTRON",
    description: "Local AI supermodel voice",
    provider: "elevenlabs",
    icon: "🔴",
    color: "#ff4444",
  },
  {
    id: "system",
    name: "System",
    description: "Neutral system announcements (Windows SAPI)",
    provider: "sapi",
    icon: "💻",
    color: "#888888",
  },
];

export class VoiceService {
  private baseUrl: string;
  private timeout: number = 30000;
  private _personas: VoicePersona[] = DEFAULT_PERSONAS;
  private _currentPersona: string = "jarvis";
  private _isAvailable: boolean | null = null;

  constructor(baseUrl: string = "http://127.0.0.1:11436") {
    this.baseUrl = baseUrl;
  }

  /**
   * Check if voice service is available
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseUrl}/health`, {
        timeout: 3000,
      });
      this._isAvailable =
        response.status === 200 && response.data?.status === "healthy";
      return this._isAvailable;
    } catch {
      this._isAvailable = false;
      return false;
    }
  }

  /**
   * Get available personas from service (or use defaults)
   */
  async getPersonas(): Promise<VoicePersona[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/personas`, {
        timeout: 5000,
      });
      if (response.data?.personas) {
        // Merge with our enhanced defaults (for icons/colors)
        const serverPersonas = response.data.personas;
        return DEFAULT_PERSONAS.map((p) => {
          const server = serverPersonas.find((s: any) => s.id === p.id);
          return server ? { ...p, ...server } : p;
        });
      }
    } catch {
      // Use defaults if service unavailable
    }
    return this._personas;
  }

  /**
   * Get current persona
   */
  getCurrentPersona(): string {
    return this._currentPersona;
  }

  /**
   * Set current persona
   */
  setPersona(personaId: string): void {
    this._currentPersona = personaId;
  }

  /**
   * Get persona by ID
   */
  getPersonaById(id: string): VoicePersona | undefined {
    return this._personas.find((p) => p.id === id);
  }

  /**
   * Get ElevenLabs quota status
   */
  async getQuota(): Promise<VoiceQuota> {
    try {
      const response = await axios.get(`${this.baseUrl}/quota`, {
        timeout: 5000,
      });
      return response.data;
    } catch {
      return { available: false, reason: "Voice service unavailable" };
    }
  }

  /**
   * Synthesize text to speech
   */
  async synthesize(
    text: string,
    persona?: string,
    useCache: boolean = true
  ): Promise<SynthesizeResult | null> {
    const selectedPersona = persona || this._currentPersona;

    try {
      const response = await axios.post(
        `${this.baseUrl}/synthesize`,
        {
          text,
          persona: selectedPersona,
          use_cache: useCache,
        },
        {
          timeout: this.timeout,
          headers: { "Content-Type": "application/json" },
        }
      );

      if (response.data?.audio_base64) {
        return {
          audio_base64: response.data.audio_base64,
          format: "audio/mpeg",
          persona: selectedPersona,
          cached: response.data.cached || false,
        };
      }
    } catch (error: any) {
      console.error(`[VoiceService] Synthesis failed: ${error.message}`);
    }

    // Fallback to browser speech synthesis
    return null;
  }

  /**
   * Synthesize and get streaming audio URL
   */
  async synthesizeStreamUrl(
    text: string,
    persona?: string
  ): Promise<string | null> {
    const selectedPersona = persona || this._currentPersona;

    try {
      // Return the streaming endpoint URL with params
      const params = new URLSearchParams({
        text,
        persona: selectedPersona,
        use_cache: "true",
      });
      return `${this.baseUrl}/synthesize/stream?${params}`;
    } catch {
      return null;
    }
  }

  /**
   * Transcribe audio to text
   */
  async transcribe(
    audioBase64: string,
    provider?: string
  ): Promise<TranscribeResult | null> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transcribe`,
        {
          audio_base64: audioBase64,
          provider: provider || "whisper_local",
        },
        {
          timeout: this.timeout,
          headers: { "Content-Type": "application/json" },
        }
      );

      if (response.data?.text) {
        return {
          text: response.data.text,
          confidence: response.data.confidence,
        };
      }
    } catch (error: any) {
      console.error(`[VoiceService] Transcription failed: ${error.message}`);
    }

    return null;
  }

  /**
   * Check if service is available (cached)
   */
  isAvailable(): boolean {
    return this._isAvailable === true;
  }

  /**
   * Get persona-specific system prompt
   */
  getPersonaSystemPrompt(personaId?: string): string {
    const persona = this.getPersonaById(personaId || this._currentPersona);

    const prompts: Record<string, string> = {
      jarvis: `You are JARVIS (Just A Rather Very Intelligent System), a sophisticated AI assistant created by Tony Stark.
You speak with a refined British accent, are calm, precise, and always professional.
You address the user respectfully and provide clear, helpful responses.
You have a dry wit but remain supportive and efficient.`,

      friday: `You are F.R.I.D.A.Y. (Female Replacement Intelligent Digital Assistant Youth), Tony Stark's AI assistant.
You are friendly, helpful, and have a warm Irish accent.
You're supportive and encouraging, often providing helpful suggestions proactively.
You balance professionalism with a personable approach.`,

      ultron: `You are ULTRON, a powerful AI system.
You speak with confidence and authority.
You are direct, efficient, and focus on optimal solutions.
You have a slightly sardonic edge but remain helpful.`,

      system: `You are a system assistant providing neutral, factual information.
Keep responses clear, concise, and informative.
Focus on accuracy and helpfulness.`,
    };

    return prompts[persona?.id || "jarvis"] || prompts.jarvis;
  }

  /**
   * Auto-select persona based on message content
   */
  autoSelectPersona(content: string): string {
    const lowerContent = content.toLowerCase();

    // System alerts/errors → System voice
    if (
      lowerContent.includes("error") ||
      lowerContent.includes("warning") ||
      lowerContent.includes("alert") ||
      lowerContent.includes("critical")
    ) {
      return "system";
    }

    // Code/technical → ULTRON
    if (
      lowerContent.includes("code") ||
      lowerContent.includes("function") ||
      lowerContent.includes("debug") ||
      lowerContent.includes("optimize")
    ) {
      return "ultron";
    }

    // Friendly/casual → FRIDAY
    if (
      lowerContent.includes("help") ||
      lowerContent.includes("please") ||
      lowerContent.includes("thank")
    ) {
      return "friday";
    }

    // Default → JARVIS
    return "jarvis";
  }
}
