import axios, { AxiosRequestConfig } from "axios";
import * as vscode from "vscode";

export interface StreamCallback {
  onToken: (token: string) => void;
  onComplete: (fullResponse: string) => void;
  onError: (error: Error) => void;
}

export class ApiClient {
  private baseUrl: string;
  private fallbackUrl: string = "http://localhost:11434";
  private clusterUrl: string = "http://localhost:8080/v1";
  private model: string;
  private useFallback: boolean;
  private accessToken: string | null = null;
  private defaultTimeout: number = 30000;
  private searchTimeout: number = 60000;
  private historyTimeout: number = 45000;
  private chatTimeout: number = 300000; // 5 minutes for slow models
  private isClusterAvailable: boolean | null = null;
  private abortController: AbortController | null = null;

  constructor(
    baseUrl: string,
    model: string = "llama3.2:3b",
    fallbackToOllama: boolean = true
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.useFallback = fallbackToOllama;
  }

  /**
   * Abort any ongoing streaming request
   */
  abortStream(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  getModel(): string {
    return this.model;
  }

  setModel(model: string): void {
    this.model = model;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Get connection status: 'connected' (cluster), 'direct' (ollama), 'offline'
   */
  getConnectionStatus(): "connected" | "direct" | "offline" | "checking" {
    if (this.isClusterAvailable === true) return "connected";
    if (this.isClusterAvailable === false) return "direct";
    return "checking";
  }

  /**
   * Check connection and return status
   */
  async checkConnection(): Promise<"connected" | "direct" | "offline"> {
    // Check cluster first
    try {
      const response = await axios.get(
        `${this.clusterUrl.replace("/v1", "")}/health`,
        { timeout: 3000 }
      );
      if (response.status === 200) {
        this.isClusterAvailable = true;
        return "connected";
      }
    } catch {
      this.isClusterAvailable = false;
    }

    // Check direct Ollama
    try {
      const response = await axios.get("http://localhost:11434/api/tags", {
        timeout: 3000,
      });
      if (response.status === 200) {
        return "direct";
      }
    } catch {
      // Both unavailable
    }

    return "offline";
  }

  /**
   * List available models from cluster or Ollama.
   */
  async listModels(): Promise<string[]> {
    try {
      // Try cluster first
      const response = await axios.get(`${this.clusterUrl}/models`, {
        timeout: 5000,
        validateStatus: () => true,
      });

      if (response.status === 200 && response.data) {
        this.isClusterAvailable = true;
        // Cluster/gateway returns structured data
        if (response.data.aliases) {
          const aliases = Object.keys(response.data.aliases);
          const models = (response.data.models || []).map((m: any) => m.id);
          return [...aliases, ...models];
        }
        // OpenAI/Ollama format
        if (response.data.data) {
          return response.data.data.map((m: any) => m.id || m.name);
        }
        if (response.data.models) {
          return response.data.models.map((m: any) => m.name || m.id);
        }
      }
    } catch {
      this.isClusterAvailable = false;
    }

    // Fallback to direct Ollama
    if (this.useFallback) {
      try {
        const response = await axios.get("http://localhost:11434/api/tags", {
          timeout: 5000,
        });
        if (response.data?.models) {
          return response.data.models.map((m: any) => m.name);
        }
      } catch {
        // Ollama not available either
      }
    }

    return [];
  }

  /**
   * Get the effective API URL.
   * Priority: Direct Ollama (most reliable) when cluster has issues
   */
  private async getEffectiveUrl(): Promise<string> {
    if (this.isClusterAvailable === null) {
      // Check if ULTRON Cluster Router has active nodes
      try {
        const response = await axios.get(
          `${this.clusterUrl.replace("/v1", "")}/health`,
          {
            timeout: 3000,
          }
        );
        // Only use cluster if it has active nodes (ultron_health > 0 OR iron_legion_health > 0)
        const ultronHealth = response.data?.ultron_health || 0;
        const ironHealth = response.data?.iron_legion_health || 0;
        if (ultronHealth > 50 || ironHealth > 50) {
          this.isClusterAvailable = true;
          console.log(
            `[JARVIS] Cluster active (ULTRON: ${ultronHealth}%, Iron Legion: ${ironHealth}%)`
          );
        } else {
          this.isClusterAvailable = false;
          console.log(
            `[JARVIS] Cluster degraded (${ultronHealth}%/${ironHealth}%), using direct Ollama`
          );
        }
      } catch {
        this.isClusterAvailable = false;
        console.log("[JARVIS] Cluster unavailable, using direct Ollama");
      }
    }

    if (this.isClusterAvailable) {
      return this.clusterUrl;
    }

    if (this.useFallback) {
      return this.fallbackUrl;
    }

    return this.baseUrl;
  }

  /**
   * Send chat message with optional images.
   * Tries cluster first, falls back to direct Ollama.
   */
  async chatCompletionsWithImages(
    messages: { role: string; content: string; images?: string[] }[],
    images?: string[]
  ): Promise<string> {
    try {
      const ollamaMessages = messages.map((m, idx) => {
        const msg: any = { role: m.role, content: m.content };
        if (
          idx === messages.length - 1 &&
          m.role === "user" &&
          images &&
          images.length > 0
        ) {
          msg.images = images;
        }
        return msg;
      });

      const effectiveUrl = await this.getEffectiveUrl();
      let response = await axios.post(
        `${effectiveUrl}/chat/completions`,
        {
          model: this.model,
          messages: ollamaMessages,
          stream: false,
        },
        {
          timeout: this.chatTimeout,
          headers: { "Content-Type": "application/json" },
          validateStatus: () => true,
        }
      );

      // Fallback to direct Ollama if cluster returns 502/503
      if (
        (response.status === 502 || response.status === 503) &&
        this.useFallback &&
        effectiveUrl !== this.fallbackUrl
      ) {
        console.log(
          "[JARVIS] Cluster unavailable (503), falling back to direct Ollama"
        );
        this.isClusterAvailable = false;
        response = await axios.post(
          `${this.fallbackUrl}/chat/completions`,
          { model: this.model, messages: ollamaMessages, stream: false },
          {
            timeout: this.chatTimeout,
            headers: { "Content-Type": "application/json" },
            validateStatus: () => true,
          }
        );
      }

      if (response.status !== 200) {
        const err =
          response.data?.error?.message ||
          response.data?.error ||
          response.statusText ||
          "Chat request failed";
        throw new Error(typeof err === "string" ? err : JSON.stringify(err));
      }
      const content = response.data?.choices?.[0]?.message?.content;
      return typeof content === "string" ? content : "";
    } catch (error: any) {
      if (error.code === "ECONNREFUSED") {
        throw new Error(
          "Cannot reach Ollama. Is it running? Start with: ollama serve"
        );
      }
      if (error.code === "ECONNABORTED") {
        throw new Error(
          "Request timed out. Try a shorter message or check Ollama."
        );
      }
      throw error;
    }
  }

  /**
   * Send chat message to ULTRON Cluster or fallback to direct Ollama.
   * Uses OpenAI-compatible /v1/chat/completions endpoint.
   */
  async chatCompletions(
    messages: { role: string; content: string }[]
  ): Promise<string> {
    try {
      const effectiveUrl = await this.getEffectiveUrl();
      let response = await axios.post(
        `${effectiveUrl}/chat/completions`,
        {
          model: this.model,
          messages,
          stream: false,
        },
        {
          timeout: this.chatTimeout,
          headers: { "Content-Type": "application/json" },
          validateStatus: () => true,
        }
      );

      // Fallback to direct Ollama if cluster returns 502/503
      if (
        (response.status === 502 || response.status === 503) &&
        this.useFallback &&
        effectiveUrl !== this.fallbackUrl
      ) {
        console.log(
          "[JARVIS] Cluster unavailable (503), falling back to direct Ollama"
        );
        this.isClusterAvailable = false;
        response = await axios.post(
          `${this.fallbackUrl}/chat/completions`,
          {
            model: this.model,
            messages,
            stream: false,
          },
          {
            timeout: this.chatTimeout,
            headers: { "Content-Type": "application/json" },
            validateStatus: () => true,
          }
        );
      }

      if (response.status !== 200) {
        const err =
          response.data?.error?.message ||
          response.statusText ||
          "Chat request failed";
        throw new Error(err);
      }
      const content = response.data?.choices?.[0]?.message?.content;
      return typeof content === "string" ? content : "";
    } catch (error: any) {
      // Connection refused - try direct Ollama fallback
      if (error.code === "ECONNREFUSED" && this.useFallback) {
        try {
          console.log("[JARVIS] Connection refused, trying direct Ollama");
          const response = await axios.post(
            `${this.fallbackUrl}/chat/completions`,
            { model: this.model, messages, stream: false },
            {
              timeout: this.chatTimeout,
              headers: { "Content-Type": "application/json" },
              validateStatus: () => true,
            }
          );
          if (response.status === 200) {
            const content = response.data?.choices?.[0]?.message?.content;
            return typeof content === "string" ? content : "";
          }
        } catch {
          // Fallback also failed
        }
        throw new Error(
          "Cannot reach Ollama. Is it running? Start with: ollama serve"
        );
      }
      if (error.code === "ECONNABORTED") {
        throw new Error(
          "Chat request timed out. Try a shorter message or check Ollama."
        );
      }
      throw error;
    }
  }

  /**
   * Stream chat completions with real-time token callbacks.
   * Uses Ollama's native streaming API for best performance.
   */
  async chatCompletionsStream(
    messages: { role: string; content: string }[],
    callback: StreamCallback
  ): Promise<void> {
    this.abortController = new AbortController();
    let fullResponse = "";

    try {
      // Always use direct Ollama for streaming (more reliable)
      const response = await fetch(`${this.fallbackUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\\n").filter((line) => line.trim());

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.message?.content) {
              const token = json.message.content;
              fullResponse += token;
              callback.onToken(token);
            }
            if (json.done) {
              callback.onComplete(fullResponse);
              return;
            }
          } catch {
            // Skip non-JSON lines
          }
        }
      }

      callback.onComplete(fullResponse);
    } catch (error: any) {
      if (error.name === "AbortError") {
        callback.onComplete(fullResponse);
        return;
      }
      callback.onError(error);
    } finally {
      this.abortController = null;
    }
  }

  private getRequestConfig(timeout?: number): AxiosRequestConfig {
    return {
      timeout: timeout || this.defaultTimeout,
      headers: {
        Authorization: this.accessToken
          ? `Bearer ${this.accessToken}`
          : undefined,
      },
    };
  }

  async login(username: string, password: string): Promise<boolean> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/v1/auth/login`,
        { username, password },
        this.getRequestConfig(this.defaultTimeout)
      );

      this.accessToken = response.data.access_token;
      return true;
    } catch (error: any) {
      if (error.code === "ECONNABORTED") {
        vscode.window.showErrorMessage("Login request timed out");
      } else {
        vscode.window.showErrorMessage("Login failed");
      }
      return false;
    }
  }

  async sendChatMessage(conversationId: string, message: string): Promise<any> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/v1/chat/conversations/${conversationId}/messages`,
        { content: message },
        this.getRequestConfig(this.defaultTimeout)
      );
      return response.data;
    } catch (error: any) {
      if (error.code === "ECONNABORTED") {
        throw new Error("Request timed out while sending message");
      }
      throw error;
    }
  }

  async triggerWorkflow(workflowId: string): Promise<any> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/v1/workflows/${workflowId}/execute`,
        {},
        this.getRequestConfig(this.defaultTimeout)
      );
      return response.data;
    } catch (error: any) {
      if (error.code === "ECONNABORTED") {
        throw new Error("Workflow trigger timed out");
      }
      throw error;
    }
  }

  async searchKnowledge(query: string, limit: number = 50): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v1/r5/knowledge/search`,
        {
          params: { q: query, limit },
          ...this.getRequestConfig(this.searchTimeout),
        }
      );
      return response.data.items || [];
    } catch (error: any) {
      if (error.code === "ECONNABORTED") {
        vscode.window.showErrorMessage(
          "Search request timed out. Try a more specific query."
        );
        return [];
      }
      throw error;
    }
  }

  /**
   * Search agent history with keyword filtering
   * @param keyword - Search keyword
   * @param limit - Maximum number of results (default: 20)
   * @param offset - Pagination offset (default: 0)
   */
  async searchAgentHistory(
    keyword: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<{
    items: any[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v1/agent/history/search`,
        {
          params: {
            keyword,
            limit,
            offset,
          },
          ...this.getRequestConfig(this.searchTimeout),
        }
      );
      return {
        items: response.data.items || [],
        total: response.data.total || 0,
        hasMore: response.data.hasMore || false,
      };
    } catch (error: any) {
      if (error.code === "ECONNABORTED") {
        vscode.window.showErrorMessage(
          "Agent history search timed out. Try a more specific keyword or reduce the search scope."
        );
        return { items: [], total: 0, hasMore: false };
      }
      throw error;
    }
  }

  /**
   * Get agent history item by ID with timeout protection
   * @param historyId - Agent history ID
   */
  async getAgentHistory(historyId: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v1/agent/history/${historyId}`,
        this.getRequestConfig(this.historyTimeout)
      );
      return response.data;
    } catch (error: any) {
      if (error.code === "ECONNABORTED") {
        vscode.window.showErrorMessage(
          `Loading agent history timed out. The history item may be too large.`
        );
        throw new Error("History retrieval timed out");
      }
      throw error;
    }
  }

  /**
   * Pin an agent history item
   * @param historyId - Agent history ID to pin
   */
  async pinAgentHistory(historyId: string): Promise<boolean> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/v1/agent/history/${historyId}/pin`,
        {},
        this.getRequestConfig(this.defaultTimeout)
      );
      return response.data.success || false;
    } catch (error: any) {
      if (error.code === "ECONNABORTED") {
        vscode.window.showErrorMessage("Pin operation timed out");
        return false;
      }
      vscode.window.showErrorMessage(
        `Failed to pin agent history: ${error.message}`
      );
      return false;
    }
  }

  /**
   * Unpin an agent history item
   * @param historyId - Agent history ID to unpin
   */
  async unpinAgentHistory(historyId: string): Promise<boolean> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/v1/agent/history/${historyId}/unpin`,
        {},
        this.getRequestConfig(this.defaultTimeout)
      );
      return response.data.success || false;
    } catch (error: any) {
      if (error.code === "ECONNABORTED") {
        vscode.window.showErrorMessage("Unpin operation timed out");
        return false;
      }
      vscode.window.showErrorMessage(
        `Failed to unpin agent history: ${error.message}`
      );
      return false;
    }
  }

  /**
   * Get pinned agent histories
   */
  async getPinnedAgentHistories(): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v1/agent/history/pinned`,
        this.getRequestConfig(this.defaultTimeout)
      );
      return response.data.items || [];
    } catch (error: any) {
      if (error.code === "ECONNABORTED") {
        vscode.window.showErrorMessage("Loading pinned histories timed out");
        return [];
      }
      throw error;
    }
  }
}
