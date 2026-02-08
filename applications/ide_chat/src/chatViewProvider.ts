import * as vscode from "vscode";
import { ApiClient } from "./apiClient";
import { DEFAULT_PERSONAS, VoiceService } from "./voiceService";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[]; // base64 encoded images
  persona?: string; // Voice persona for this message
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "lumina.jarvisChat";

  private _view?: vscode.WebviewView;
  private _conversationMessages: ChatMessage[] = [];
  private _apiClient: ApiClient;
  private _voiceService: VoiceService;
  private _currentModel: string;
  private _availableModels: string[] = [];
  private _currentPersona: string = "jarvis";
  private _autoPersona: boolean = false;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    apiClient: ApiClient
  ) {
    this._apiClient = apiClient;
    this._voiceService = new VoiceService();
    this._currentModel = apiClient.getModel();

    // Check voice service availability
    this._voiceService.checkHealth().then((available) => {
      console.log(
        `[JARVIS] Voice service: ${available ? "available" : "unavailable"}`
      );
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // Fetch models and render
    this._fetchModels().then(() => {
      if (this._view) {
        this._view.webview.html = this._getHtmlForWebview();
      }
    });

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case "sendMessage":
          await this._handleSendMessageStreaming(
            message.text,
            message.includeContext,
            message.images,
            message.fileContext
          );
          break;
        case "stopGeneration":
          this._apiClient.abortStream();
          this._postMessage({ command: "generationStopped" });
          break;
        case "clearChat":
          this._conversationMessages = [];
          this._postMessage({ command: "chatCleared" });
          break;
        case "changeModel":
          this._currentModel = message.model;
          this._apiClient.setModel(message.model);
          this._postMessage({ command: "modelChanged", model: message.model });
          break;
        case "refreshModels":
          await this._fetchModels();
          this._postMessage({
            command: "modelsLoaded",
            models: this._availableModels,
            current: this._currentModel,
          });
          break;
        case "getContext":
          const context = await this._getEditorContext();
          this._postMessage({ command: "contextLoaded", context });
          break;
        case "searchFiles":
          const files = await this._searchWorkspaceFiles(message.query);
          this._postMessage({ command: "filesFound", files });
          break;
        case "getFileContent":
          const content = await this._getFileContent(message.path);
          this._postMessage({ command: "fileContent", path: message.path, content });
          break;
        case "saveConversation":
          await this._saveConversationHistory();
          break;
        case "loadConversation":
          const history = await this._loadConversationHistory();
          this._postMessage({ command: "conversationLoaded", history });
          break;
        case "openSettings":
          vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "jarvis.chat"
          );
          break;
        case "insertCode":
          await this._insertCodeAtCursor(message.code);
          break;
        case "copyCode":
          await vscode.env.clipboard.writeText(message.code);
          vscode.window.showInformationMessage("Code copied to clipboard");
          break;
        case "speakText":
          await this._synthesizeAndPlay(
            message.text,
            message.persona || this._currentPersona
          );
          break;
        case "stopSpeaking":
          this._postMessage({ command: "speechStopped" });
          break;
        case "changePersona":
          this._currentPersona = message.persona;
          this._voiceService.setPersona(message.persona);
          this._postMessage({
            command: "personaChanged",
            persona: message.persona,
          });
          break;
        case "setAutoPersona":
          this._autoPersona = message.enabled;
          break;
        case "getVoiceStatus":
          const status = await this._getVoiceServiceStatus();
          this._postMessage({ command: "voiceStatus", ...status });
          break;
        case "previewPersona":
          await this._previewPersonaVoice(message.persona);
          break;
      }
    });
  }

  private async _getVoiceServiceStatus() {
    const available = await this._voiceService.checkHealth();
    const quota = await this._voiceService.getQuota();
    const personas = await this._voiceService.getPersonas();
    return {
      available,
      quota,
      personas,
      currentPersona: this._currentPersona,
      autoPersona: this._autoPersona,
    };
  }

  private async _previewPersonaVoice(personaId: string) {
    const persona = DEFAULT_PERSONAS.find((p) => p.id === personaId);
    const previewText = persona
      ? `Hello, I am ${persona.name}. ${persona.description}.`
      : "Hello, this is a voice preview.";
    await this._synthesizeAndPlay(previewText, personaId);
  }

  private async _synthesizeAndPlay(text: string, persona?: string) {
    // Auto-select persona if enabled
    const selectedPersona = this._autoPersona
      ? this._voiceService.autoSelectPersona(text)
      : persona || this._currentPersona;

    // Notify UI of speaking persona
    this._postMessage({
      command: "speakingStart",
      persona: selectedPersona,
      text: text.substring(0, 50) + (text.length > 50 ? "..." : ""),
    });

    try {
      // Try Voice Actor service first
      const result = await this._voiceService.synthesize(text, selectedPersona);

      if (result) {
        this._postMessage({
          command: "playAudio",
          audio_base64: result.audio_base64,
          format: result.format,
          persona: selectedPersona,
        });
        return;
      }
    } catch {
      // Voice service not available, fallback to Web Speech
    }

    // Fallback: use browser TTS
    this._postMessage({ command: "speakWithBrowser", text });
  }

  private _postMessage(message: any) {
    this._view?.webview.postMessage(message);
  }

  private async _fetchModels(): Promise<void> {
    try {
      // Check connection and fetch models via ApiClient
      const connectionStatus = await this._apiClient.checkConnection();
      this._postMessage({
        command: "connectionStatus",
        status: connectionStatus,
      });

      const models = await this._apiClient.listModels();
      if (models.length > 0) {
        this._availableModels = models;
        if (!this._availableModels.includes(this._currentModel)) {
          this._currentModel = this._availableModels[0];
          this._apiClient.setModel(this._currentModel);
        }
      }
    } catch {
      this._availableModels = [this._currentModel];
      this._postMessage({ command: "connectionStatus", status: "offline" });
    }
  }

  private async _getEditorContext(): Promise<{
    fileName: string;
    selection: string;
    language: string;
  } | null> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const document = editor.document;
    const selection = editor.selection;
    const selectedText = document.getText(selection);

    return {
      fileName: document.fileName.split(/[/\\]/).pop() || document.fileName,
      selection: selectedText || "",
      language: document.languageId,
    };
  }

  /**
   * Search for files in the workspace
   */
  private async _searchWorkspaceFiles(query: string): Promise<Array<{name: string, path: string, icon: string}>> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || !query) return [];

    try {
      // Use VS Code's findFiles API
      const pattern = `**/*${query}*`;
      const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 20);
      
      return files.map((uri) => {
        const name = uri.path.split('/').pop() || uri.path;
        const ext = name.split('.').pop()?.toLowerCase() || '';
        const icon = this._getFileIcon(ext);
        return {
          name,
          path: vscode.workspace.asRelativePath(uri),
          icon,
        };
      });
    } catch {
      return [];
    }
  }

  private _getFileIcon(ext: string): string {
    const icons: Record<string, string> = {
      ts: '📘', tsx: '⚛️', js: '📙', jsx: '⚛️',
      py: '🐍', json: '📋', md: '📝', html: '🌐',
      css: '🎨', scss: '🎨', sql: '🗃️', yaml: '⚙️',
      yml: '⚙️', sh: '🐚', ps1: '💠', txt: '📄',
    };
    return icons[ext] || '📄';
  }

  /**
   * Get content of a file
   */
  private async _getFileContent(filePath: string): Promise<string | null> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) return null;

      const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
      const document = await vscode.workspace.openTextDocument(uri);
      
      // Limit content size
      const content = document.getText();
      const maxLength = 10000;
      if (content.length > maxLength) {
        return content.substring(0, maxLength) + '\n... (truncated)';
      }
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Save conversation history to workspace storage
   */
  private async _saveConversationHistory(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    try {
      const historyPath = vscode.Uri.joinPath(
        workspaceFolders[0].uri,
        '.lumina',
        'data',
        'jarvis_chat_history.json'
      );

      const history = {
        version: 1,
        timestamp: new Date().toISOString(),
        messages: this._conversationMessages,
        model: this._currentModel,
        persona: this._currentPersona,
      };

      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(historyPath, encoder.encode(JSON.stringify(history, null, 2)));
    } catch (error) {
      console.error('[JARVIS] Failed to save conversation:', error);
    }
  }

  /**
   * Load conversation history from workspace storage
   */
  private async _loadConversationHistory(): Promise<ChatMessage[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return [];

    try {
      const historyPath = vscode.Uri.joinPath(
        workspaceFolders[0].uri,
        '.lumina',
        'data',
        'jarvis_chat_history.json'
      );

      const data = await vscode.workspace.fs.readFile(historyPath);
      const decoder = new TextDecoder();
      const history = JSON.parse(decoder.decode(data));
      
      if (history.messages && Array.isArray(history.messages)) {
        this._conversationMessages = history.messages;
        return history.messages;
      }
    } catch {
      // No history file or error reading
    }
    return [];
  }

  private async _handleSendMessage(
    text: string,
    includeContext: boolean,
    images?: string[]
  ) {
    const userMessage = text.trim();
    if (!userMessage || !this._view) return;

    let contextPrefix = "";
    if (includeContext) {
      const ctx = await this._getEditorContext();
      if (ctx && ctx.selection) {
        contextPrefix = `[Context: ${ctx.fileName} (${ctx.language})]\n\`\`\`${ctx.language}\n${ctx.selection}\n\`\`\`\n\n`;
      } else if (ctx) {
        contextPrefix = `[Context: ${ctx.fileName} (${ctx.language})]\n\n`;
      }
    }

    const fullMessage = contextPrefix + userMessage;
    const msg: ChatMessage = { role: "user", content: fullMessage };
    if (images && images.length > 0) {
      msg.images = images;
    }

    this._conversationMessages.push(msg);
    this._postMessage({
      command: "chatMessage",
      role: "user",
      content: userMessage,
      hasContext: !!contextPrefix,
    });

    // Show typing indicator
    this._postMessage({ command: "typing", show: true });

    try {
      const reply = await this._apiClient.chatCompletionsWithImages(
        this._conversationMessages,
        images
      );
      this._conversationMessages.push({ role: "assistant", content: reply });
      this._postMessage({
        command: "chatMessage",
        role: "assistant",
        content: reply,
      });
    } catch (error: any) {
      const errMsg = error.message || "JARVIS could not respond.";
      this._postMessage({ command: "chatError", error: errMsg });
      this._conversationMessages.pop();
    } finally {
      this._postMessage({ command: "typing", show: false });
    }
  }

  /**
   * Handle message with streaming response (Kilo Code style)
   */
  private async _handleSendMessageStreaming(
    text: string,
    includeContext: boolean,
    images?: string[],
    fileContext?: string
  ) {
    const userMessage = text.trim();
    if (!userMessage || !this._view) return;

    let contextPrefix = "";
    
    // Add @ mentioned file context
    if (fileContext) {
      contextPrefix += `[Referenced Files]\n${fileContext}\n\n`;
    }
    
    // Add editor context if enabled
    if (includeContext) {
      const ctx = await this._getEditorContext();
      if (ctx && ctx.selection) {
        contextPrefix += `[Current Editor: ${ctx.fileName} (${ctx.language})]\n\`\`\`${ctx.language}\n${ctx.selection}\n\`\`\`\n\n`;
      } else if (ctx) {
        contextPrefix += `[Current Editor: ${ctx.fileName} (${ctx.language})]\n\n`;
      }
    }

    const fullMessage = contextPrefix + userMessage;
    const msg: ChatMessage = { role: "user", content: fullMessage };
    if (images && images.length > 0) {
      msg.images = images;
    }

    this._conversationMessages.push(msg);
    this._postMessage({
      command: "chatMessage",
      role: "user",
      content: userMessage,
      hasContext: !!contextPrefix,
    });

    // Start streaming response
    this._postMessage({ command: "streamStart" });

    let fullResponse = "";

    try {
      await this._apiClient.chatCompletionsStream(this._conversationMessages, {
        onToken: (token) => {
          fullResponse += token;
          this._postMessage({ command: "streamToken", token });
        },
        onComplete: (response) => {
          this._conversationMessages.push({
            role: "assistant",
            content: response,
          });
          this._postMessage({ command: "streamEnd", content: response });
        },
        onError: (error) => {
          this._postMessage({ command: "chatError", error: error.message });
          this._conversationMessages.pop();
        },
      });
    } catch (error: any) {
      const errMsg = error.message || "JARVIS could not respond.";
      this._postMessage({ command: "chatError", error: errMsg });
      this._conversationMessages.pop();
    }
  }

  private async _insertCodeAtCursor(code: string) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      await editor.edit((editBuilder) => {
        editBuilder.insert(editor.selection.active, code);
      });
    }
  }

  private _getHtmlForWebview(): string {
    const modelsJson = JSON.stringify(this._availableModels);
    const currentModel = this._currentModel;

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body {
            height: 100%;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            background: var(--vscode-sideBar-background);
            color: var(--vscode-foreground);
        }
        .chat-container {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        /* Header with model selector */
        .chat-header {
            padding: 8px 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
        }
        .header-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
        }
        .header-row h1 {
            font-size: 13px;
            font-weight: 600;
            flex: 1;
        }
        .icon-btn {
            background: transparent;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 14px;
        }
        .icon-btn:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .model-row {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .model-select {
            flex: 1;
            padding: 4px 6px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 11px;
        }
        .refresh-btn {
            padding: 4px 6px;
            font-size: 11px;
        }

        /* Messages area */
        #messages {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .message {
            max-width: 95%;
            padding: 8px 12px;
            border-radius: 8px;
            line-height: 1.4;
            font-size: 13px;
        }
        .message.user {
            align-self: flex-end;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .message.assistant {
            align-self: flex-start;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
        }
        .message.error {
            align-self: center;
            background: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-errorForeground);
            font-size: 12px;
        }
        .message.assistant {
            position: relative;
        }
        .speak-btn {
            position: absolute;
            top: 4px;
            right: 4px;
            background: transparent;
            border: none;
            cursor: pointer;
            font-size: 12px;
            opacity: 0.5;
            padding: 2px 4px;
            border-radius: 3px;
        }
        .speak-btn:hover {
            opacity: 1;
            background: var(--vscode-list-hoverBackground);
        }
        .message.highlighted {
            outline: 2px solid var(--vscode-focusBorder);
            outline-offset: 2px;
        }
        .context-badge {
            font-size: 10px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 6px;
            border-radius: 10px;
            margin-bottom: 4px;
            display: inline-block;
        }

        /* Code blocks */
        .code-block {
            position: relative;
            margin: 8px 0;
        }
        .code-block pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
        }
        .code-actions {
            position: absolute;
            top: 4px;
            right: 4px;
            display: flex;
            gap: 4px;
        }
        .code-actions button {
            padding: 2px 6px;
            font-size: 10px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
        }
        .code-actions button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        /* Typing indicator */
        .typing-indicator {
            display: none;
            align-self: flex-start;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .typing-indicator.show { display: block; }
        .typing-indicator span {
            animation: blink 1.4s infinite;
        }
        .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
        .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes blink {
            0%, 60%, 100% { opacity: 0; }
            30% { opacity: 1; }
        }

        /* Welcome */
        .welcome {
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }
        .welcome h2 { font-size: 14px; margin-bottom: 8px; }
        .welcome p { font-size: 12px; margin-bottom: 4px; }

        /* VCR Controls */
        .vcr-controls {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            padding: 6px 8px;
            border-top: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
        }
        .vcr-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 4px;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 14px;
            min-width: 32px;
        }
        .vcr-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .vcr-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        .vcr-btn.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .vcr-btn.recording {
            background: #e53935;
            color: white;
            animation: pulse 1s infinite;
        }
        .vcr-position {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            min-width: 30px;
            text-align: center;
        }
        .alert-bar {
            display: flex;
            align-items: center;
            padding: 6px 10px;
            background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
            border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
            font-size: 12px;
            color: var(--vscode-errorForeground, #f48771);
            gap: 8px;
        }
        .alert-bar.warning {
            background: var(--vscode-inputValidation-warningBackground, #352a05);
            border-color: var(--vscode-inputValidation-warningBorder, #9d8500);
            color: var(--vscode-editorWarning-foreground, #cca700);
        }
        .alert-icon { font-size: 14px; }
        .alert-message { flex: 1; }
        .alert-dismiss {
            background: transparent;
            border: none;
            color: inherit;
            cursor: pointer;
            padding: 2px 6px;
            opacity: 0.7;
        }
        .alert-dismiss:hover { opacity: 1; }
        .vcr-divider {
            width: 1px;
            height: 20px;
            background: var(--vscode-panel-border);
            margin: 0 4px;
        }
        .auto-toggle {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
        }
        .auto-toggle input {
            margin: 0;
        }
        .persona-select {
            font-size: 11px;
            padding: 3px 6px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            min-width: 90px;
        }
        .persona-preview-btn {
            padding: 2px 6px;
            font-size: 10px;
            background: transparent;
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-foreground);
            border-radius: 3px;
            cursor: pointer;
            opacity: 0.7;
        }
        .persona-preview-btn:hover {
            opacity: 1;
            background: var(--vscode-list-hoverBackground);
        }
        .persona-indicator {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 500;
        }
        .persona-indicator.jarvis { background: rgba(74, 158, 255, 0.2); color: #4a9eff; }
        .persona-indicator.friday { background: rgba(255, 107, 157, 0.2); color: #ff6b9d; }
        .persona-indicator.ultron { background: rgba(255, 68, 68, 0.2); color: #ff4444; }
        .persona-indicator.system { background: rgba(136, 136, 136, 0.2); color: #888888; }
        .speaking-indicator {
            position: fixed;
            bottom: 60px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 20px;
            font-size: 11px;
            z-index: 100;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        .speaking-indicator .wave {
            display: flex;
            gap: 2px;
        }
        .speaking-indicator .wave span {
            width: 3px;
            height: 12px;
            background: var(--vscode-button-background);
            animation: wave 0.8s ease-in-out infinite;
        }
        .speaking-indicator .wave span:nth-child(2) { animation-delay: 0.1s; }
        .speaking-indicator .wave span:nth-child(3) { animation-delay: 0.2s; }
        .speaking-indicator .wave span:nth-child(4) { animation-delay: 0.3s; }
        @keyframes wave {
            0%, 100% { height: 4px; }
            50% { height: 12px; }
        }
        .voice-status {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 9px;
            color: var(--vscode-descriptionForeground);
            padding: 2px 0;
        }
        .voice-status.online { color: #4caf50; }
        .voice-status.offline { color: #f44336; }

        /* Input area */
        .chat-input-area {
            padding: 8px;
            border-top: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
        }
        .input-options {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
            flex-wrap: wrap;
        }
        .option-btn {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 4px 8px;
            font-size: 11px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        .option-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .option-btn.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .option-btn input[type="checkbox"] {
            margin: 0;
        }
        .image-preview {
            display: flex;
            gap: 4px;
            flex-wrap: wrap;
        }
        .image-preview img {
            max-width: 60px;
            max-height: 60px;
            border-radius: 4px;
            border: 1px solid var(--vscode-input-border);
        }
        .image-preview .remove-img {
            position: relative;
        }
        .image-preview .remove-img::after {
            content: '×';
            position: absolute;
            top: -4px;
            right: -4px;
            background: var(--vscode-errorForeground);
            color: white;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            font-size: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
        }
        .input-row {
            display: flex;
            gap: 6px;
        }
        #message-input {
            flex: 1;
            padding: 8px 10px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: inherit;
            font-size: 13px;
            resize: none;
            min-height: 36px;
            max-height: 120px;
        }
        #message-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .send-btn {
            padding: 8px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        }
        .send-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .stop-btn {
            padding: 8px 10px;
            background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
            color: var(--vscode-errorForeground, #f48771);
            border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .stop-btn:hover {
            background: var(--vscode-inputValidation-errorBorder, #be1100);
        }
        .message.streaming .message-content::after {
            content: '▊';
            animation: blink 1s infinite;
        }
        @keyframes blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
        }
        .code-actions {
            position: absolute;
            top: 4px;
            right: 4px;
            display: flex;
            gap: 4px;
            opacity: 0;
            transition: opacity 0.2s;
        }
        pre:hover .code-actions {
            opacity: 1;
        }
        .code-action-btn {
            padding: 2px 6px;
            font-size: 11px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
        }
        .code-action-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .speak-btn {
            position: absolute;
            bottom: 4px;
            right: 4px;
            padding: 2px 6px;
            font-size: 12px;
            background: transparent;
            border: none;
            cursor: pointer;
            opacity: 0.5;
        }
        .speak-btn:hover {
            opacity: 1;
        }
        .message {
            position: relative;
        }
        pre {
            position: relative;
            margin: 8px 0;
            padding: 10px;
            background: var(--vscode-textCodeBlock-background);
            border-radius: 4px;
            overflow-x: auto;
        }
        pre code {
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
        }
        .voice-btn {
            padding: 8px 10px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .voice-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .voice-btn.recording {
            background: #e53935;
            color: white;
            animation: pulse 1s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }

        /* Hidden file input */
        #image-input { display: none; }

        /* @ Mentions */
        .input-wrapper {
            position: relative;
            flex: 1;
        }
        .input-wrapper textarea {
            width: 100%;
        }
        .mentions-dropdown {
            position: absolute;
            bottom: 100%;
            left: 0;
            right: 0;
            max-height: 200px;
            overflow-y: auto;
            background: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 6px;
            box-shadow: 0 -4px 12px rgba(0,0,0,0.3);
            z-index: 1000;
            margin-bottom: 4px;
        }
        .mentions-header {
            padding: 6px 10px;
            font-size: 10px;
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
        }
        .mentions-list {
            max-height: 160px;
            overflow-y: auto;
        }
        .mention-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            cursor: pointer;
            font-size: 12px;
        }
        .mention-item:hover, .mention-item.selected {
            background: var(--vscode-list-hoverBackground);
        }
        .mention-item .icon {
            font-size: 14px;
        }
        .mention-item .name {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .mention-item .path {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            max-width: 150px;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .mentioned-files {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            padding: 0 10px;
            margin-bottom: 4px;
        }
        .mentioned-file {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 10px;
            font-size: 11px;
        }
        .mentioned-file .remove {
            cursor: pointer;
            opacity: 0.7;
        }
        .mentioned-file .remove:hover {
            opacity: 1;
        }

        /* Settings Panel */
        .settings-panel {
            position: absolute;
            top: 50px;
            right: 10px;
            width: 280px;
            background: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            z-index: 1000;
            padding: 12px;
        }
        .settings-panel h3 {
            margin: 0 0 12px 0;
            font-size: 13px;
            font-weight: 600;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .settings-panel .close-btn {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 16px;
        }
        .settings-group {
            margin-bottom: 12px;
        }
        .settings-group label {
            display: block;
            font-size: 11px;
            margin-bottom: 4px;
            color: var(--vscode-descriptionForeground);
        }
        .settings-group select, .settings-group input[type="text"] {
            width: 100%;
            padding: 6px 8px;
            font-size: 12px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
        }
        .settings-group .toggle-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .settings-group .toggle-row span {
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <div class="header-row">
                <h1>✨ JARVIS Chat</h1>
                <button class="icon-btn" id="settings-btn" title="Settings">⚙️</button>
                <button class="icon-btn" id="clear-btn" title="Clear Chat">🗑️</button>
            </div>
            <div class="model-row">
                <select class="model-select" id="model-select">
                    ${this._availableModels
                      .map(
                        (m) =>
                          `<option value="${m}" ${
                            m === currentModel ? "selected" : ""
                          }>${m}</option>`
                      )
                      .join("")}
                </select>
                <button class="icon-btn refresh-btn" id="refresh-models" title="Refresh Models">🔄</button>
            </div>
        </div>

        <div id="messages">
            <div class="welcome">
                <h2>Welcome to JARVIS</h2>
                <p>Select a model above and start chatting.</p>
                <p>Use 📎 to include file context, 🖼️ for images.</p>
            </div>
        </div>

        <div class="typing-indicator" id="typing">
            <span>●</span><span>●</span><span>●</span> Thinking...
        </div>

        <div class="alert-bar" id="alert-bar" style="display:none">
            <span class="alert-icon">⚠️</span>
            <span class="alert-message" id="alert-message"></span>
            <button class="alert-dismiss" id="alert-dismiss">✕</button>
        </div>

        <div class="vcr-controls">
            <button class="vcr-btn" id="vcr-prev" title="Previous message">⏮️</button>
            <button class="vcr-btn" id="vcr-play" title="Play/Read conversation">▶️</button>
            <button class="vcr-btn" id="vcr-pause" title="Pause" style="display:none">⏸️</button>
            <button class="vcr-btn" id="vcr-stop" title="Stop">⏹️</button>
            <button class="vcr-btn" id="vcr-next" title="Next message">⏭️</button>
            <span class="vcr-position" id="vcr-position"></span>
            <div class="vcr-divider"></div>
            <button class="vcr-btn" id="vcr-record" title="Record/Edit">⏺️</button>
            <div class="vcr-divider"></div>
            <label class="auto-toggle" title="Auto-select persona based on content">
                <input type="checkbox" id="auto-mode"> Auto
            </label>
            <select class="persona-select" id="persona-select" title="Voice Persona">
                <option value="jarvis">🤖 JARVIS</option>
                <option value="friday">👩‍💻 FRIDAY</option>
                <option value="ultron">🔴 ULTRON</option>
                <option value="system">💻 System</option>
            </select>
            <button class="persona-preview-btn" id="persona-preview" title="Preview voice">🔊</button>
        </div>

        <div class="speaking-indicator" id="speaking-indicator" style="display:none">
            <div class="wave">
                <span></span><span></span><span></span><span></span>
            </div>
            <span class="persona-indicator jarvis" id="speaking-persona">🤖 JARVIS</span>
            <span id="speaking-text">Speaking...</span>
        </div>

        <div class="chat-input-area">
            <div class="input-options">
                <label class="option-btn" id="context-toggle">
                    <input type="checkbox" id="include-context"> 📎 Context
                </label>
                <button class="option-btn" id="image-btn">🖼️ Image</button>
                <div class="image-preview" id="image-preview"></div>
            </div>
            <div class="input-row">
                <div class="input-wrapper">
                    <textarea id="message-input" placeholder="Ask JARVIS... (Type @ to mention files)" rows="1"></textarea>
                    <div class="mentions-dropdown" id="mentions-dropdown" style="display:none">
                        <div class="mentions-header">📁 Files</div>
                        <div class="mentions-list" id="mentions-list"></div>
                    </div>
                </div>
                <button class="voice-btn" id="voice-btn" title="Voice Input">🎤</button>
                <button class="send-btn" id="send-btn">Send</button>
                <button class="stop-btn" id="stop-btn" style="display:none" title="Stop generation">⏹️</button>
            </div>
            <div class="mentioned-files" id="mentioned-files"></div>
        </div>
    </div>

    <input type="file" id="image-input" accept="image/*" multiple>

    <script>
        const vscode = acquireVsCodeApi();
        const messagesDiv = document.getElementById('messages');
        const messageInput = document.getElementById('message-input');
        const sendButton = document.getElementById('send-btn');
        const stopButton = document.getElementById('stop-btn');
        const voiceButton = document.getElementById('voice-btn');
        const clearButton = document.getElementById('clear-btn');
        const settingsButton = document.getElementById('settings-btn');
        const modelSelect = document.getElementById('model-select');
        const refreshModels = document.getElementById('refresh-models');
        const typingIndicator = document.getElementById('typing');
        const includeContextCheckbox = document.getElementById('include-context');
        const imageButton = document.getElementById('image-btn');
        const imageInput = document.getElementById('image-input');
        const imagePreview = document.getElementById('image-preview');

        let hasMessages = false;
        let pendingImages = [];
        let isRecording = false;
        let recognition = null;

        // Alert Bar (for critical alerts only)
        const alertBar = document.getElementById('alert-bar');
        const alertMessage = document.getElementById('alert-message');
        const alertDismiss = document.getElementById('alert-dismiss');
        let messageCount = 0;

        function showAlert(message, type = 'error') {
            alertMessage.textContent = message;
            alertBar.className = 'alert-bar' + (type === 'warning' ? ' warning' : '');
            alertBar.querySelector('.alert-icon').textContent = type === 'warning' ? '⚠️' : '🔴';
            alertBar.style.display = 'flex';
        }

        function hideAlert() {
            alertBar.style.display = 'none';
        }

        alertDismiss.addEventListener('click', hideAlert);

        // VCR Controls
        const vcrPrev = document.getElementById('vcr-prev');
        const vcrPlay = document.getElementById('vcr-play');
        const vcrPause = document.getElementById('vcr-pause');
        const vcrStop = document.getElementById('vcr-stop');
        const vcrNext = document.getElementById('vcr-next');
        const vcrRecord = document.getElementById('vcr-record');
        const vcrPosition = document.getElementById('vcr-position');
        const autoModeCheckbox = document.getElementById('auto-mode');
        const personaSelect = document.getElementById('persona-select');
        const personaPreview = document.getElementById('persona-preview');
        const speakingIndicator = document.getElementById('speaking-indicator');
        const speakingPersona = document.getElementById('speaking-persona');
        const speakingText = document.getElementById('speaking-text');
        const mentionsDropdown = document.getElementById('mentions-dropdown');
        const mentionsList = document.getElementById('mentions-list');
        const mentionedFilesContainer = document.getElementById('mentioned-files');

        let conversationHistory = [];
        let currentPlaybackIndex = -1;
        let isPlaying = false;
        let playbackTimer = null;
        let currentPersona = 'jarvis';
        let autoMode = false;
        let voiceServiceOnline = false;
        let mentionedFiles = [];
        let mentionSearchTimeout = null;
        let selectedMentionIndex = 0;
        let searchResults = [];

        // @ Mentions functionality
        messageInput.addEventListener('input', (e) => {
            const value = e.target.value;
            const cursorPos = e.target.selectionStart;
            
            // Find @ symbol before cursor
            const textBeforeCursor = value.substring(0, cursorPos);
            const atIndex = textBeforeCursor.lastIndexOf('@');
            
            if (atIndex >= 0) {
                const query = textBeforeCursor.substring(atIndex + 1);
                if (query.length > 0 && !query.includes(' ')) {
                    // Search for files
                    clearTimeout(mentionSearchTimeout);
                    mentionSearchTimeout = setTimeout(() => {
                        vscode.postMessage({ command: 'searchFiles', query });
                    }, 200);
                    return;
                }
            }
            
            hideMentionsDropdown();
        });

        messageInput.addEventListener('keydown', (e) => {
            if (mentionsDropdown.style.display !== 'none') {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    selectedMentionIndex = Math.min(selectedMentionIndex + 1, searchResults.length - 1);
                    updateMentionSelection();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    selectedMentionIndex = Math.max(selectedMentionIndex - 1, 0);
                    updateMentionSelection();
                } else if (e.key === 'Enter' && searchResults.length > 0) {
                    e.preventDefault();
                    selectMention(searchResults[selectedMentionIndex]);
                } else if (e.key === 'Escape') {
                    hideMentionsDropdown();
                }
            }
        });

        function showMentionsDropdown(files) {
            searchResults = files;
            selectedMentionIndex = 0;
            
            if (files.length === 0) {
                hideMentionsDropdown();
                return;
            }
            
            mentionsList.innerHTML = files.map((f, i) => 
                '<div class="mention-item' + (i === 0 ? ' selected' : '') + '" data-index="' + i + '">' +
                '<span class="icon">' + f.icon + '</span>' +
                '<span class="name">' + f.name + '</span>' +
                '<span class="path">' + f.path + '</span>' +
                '</div>'
            ).join('');
            
            // Add click handlers
            mentionsList.querySelectorAll('.mention-item').forEach((item, i) => {
                item.addEventListener('click', () => selectMention(files[i]));
            });
            
            mentionsDropdown.style.display = 'block';
        }

        function hideMentionsDropdown() {
            mentionsDropdown.style.display = 'none';
            searchResults = [];
        }

        function updateMentionSelection() {
            mentionsList.querySelectorAll('.mention-item').forEach((item, i) => {
                item.classList.toggle('selected', i === selectedMentionIndex);
            });
        }

        function selectMention(file) {
            // Replace @query with the file reference
            const value = messageInput.value;
            const cursorPos = messageInput.selectionStart;
            const textBeforeCursor = value.substring(0, cursorPos);
            const atIndex = textBeforeCursor.lastIndexOf('@');
            
            if (atIndex >= 0) {
                messageInput.value = value.substring(0, atIndex) + '@' + file.name + ' ' + value.substring(cursorPos);
                messageInput.selectionStart = messageInput.selectionEnd = atIndex + file.name.length + 2;
            }
            
            // Add to mentioned files if not already
            if (!mentionedFiles.find(f => f.path === file.path)) {
                mentionedFiles.push(file);
                renderMentionedFiles();
                // Load file content
                vscode.postMessage({ command: 'getFileContent', path: file.path });
            }
            
            hideMentionsDropdown();
            messageInput.focus();
        }

        function renderMentionedFiles() {
            mentionedFilesContainer.innerHTML = mentionedFiles.map((f, i) =>
                '<span class="mentioned-file">' +
                f.icon + ' ' + f.name +
                '<span class="remove" data-index="' + i + '">✕</span>' +
                '</span>'
            ).join('');
            
            // Add remove handlers
            mentionedFilesContainer.querySelectorAll('.remove').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(e.target.dataset.index);
                    mentionedFiles.splice(idx, 1);
                    renderMentionedFiles();
                });
            });
        }

        // Load conversation history on startup
        vscode.postMessage({ command: 'loadConversation' });

        // Persona configuration
        const personas = {
            jarvis: { name: 'JARVIS', icon: '🤖', color: '#4a9eff' },
            friday: { name: 'FRIDAY', icon: '👩‍💻', color: '#ff6b9d' },
            ultron: { name: 'ULTRON', icon: '🔴', color: '#ff4444' },
            system: { name: 'System', icon: '💻', color: '#888888' }
        };

        // Check voice service status on load
        vscode.postMessage({ command: 'getVoiceStatus' });

        // VCR Event Listeners
        vcrPrev.addEventListener('click', () => {
            if (currentPlaybackIndex > 0) {
                currentPlaybackIndex--;
                highlightMessage(currentPlaybackIndex);
            }
        });

        vcrNext.addEventListener('click', () => {
            if (currentPlaybackIndex < conversationHistory.length - 1) {
                currentPlaybackIndex++;
                highlightMessage(currentPlaybackIndex);
            }
        });

        vcrPlay.addEventListener('click', () => {
            if (!isPlaying && conversationHistory.length > 0) {
                isPlaying = true;
                vcrPlay.style.display = 'none';
                vcrPause.style.display = 'inline-block';
                playConversation();
            }
        });

        vcrPause.addEventListener('click', () => {
            isPlaying = false;
            vcrPlay.style.display = 'inline-block';
            vcrPause.style.display = 'none';
            if (playbackTimer) clearTimeout(playbackTimer);
            stopSpeaking();
        });

        vcrStop.addEventListener('click', () => {
            isPlaying = false;
            currentPlaybackIndex = -1;
            vcrPlay.style.display = 'inline-block';
            vcrPause.style.display = 'none';
            if (playbackTimer) clearTimeout(playbackTimer);
            stopSpeaking();
            updateVcrPosition();
            clearHighlights();
        });

        vcrRecord.addEventListener('click', () => {
            // Toggle edit mode - focus input for new message
            messageInput.focus();
            vcrRecord.classList.toggle('active');
        });

        autoModeCheckbox.addEventListener('change', () => {
            autoMode = autoModeCheckbox.checked;
        });

        personaSelect.addEventListener('change', () => {
            currentPersona = personaSelect.value;
            vscode.postMessage({ command: 'changePersona', persona: currentPersona });
            updatePersonaIndicator();
        });

        personaPreview.addEventListener('click', () => {
            vscode.postMessage({ command: 'previewPersona', persona: currentPersona });
        });

        function updatePersonaIndicator() {
            const p = personas[currentPersona];
            if (p) {
                speakingPersona.textContent = p.icon + ' ' + p.name;
                speakingPersona.className = 'persona-indicator ' + currentPersona;
            }
        }

        function showSpeakingIndicator(persona, text) {
            const p = personas[persona] || personas.jarvis;
            speakingPersona.textContent = p.icon + ' ' + p.name;
            speakingPersona.className = 'persona-indicator ' + persona;
            speakingText.textContent = text || 'Speaking...';
            speakingIndicator.style.display = 'flex';
        }

        function hideSpeakingIndicator() {
            speakingIndicator.style.display = 'none';
        }

        function updateVcrPosition() {
            const current = currentPlaybackIndex >= 0 ? currentPlaybackIndex + 1 : 0;
            vcrPosition.textContent = current + '/' + conversationHistory.length;
        }

        function highlightMessage(index) {
            clearHighlights();
            const messages = messagesDiv.querySelectorAll('.message');
            if (messages[index]) {
                messages[index].classList.add('highlighted');
                messages[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            updateVcrPosition();
        }

        function clearHighlights() {
            messagesDiv.querySelectorAll('.message.highlighted').forEach(el => {
                el.classList.remove('highlighted');
            });
        }

        function playConversation() {
            if (!isPlaying) return;

            currentPlaybackIndex++;
            if (currentPlaybackIndex >= conversationHistory.length) {
                // End of conversation
                isPlaying = false;
                vcrPlay.style.display = 'inline-block';
                vcrPause.style.display = 'none';
                currentPlaybackIndex = conversationHistory.length - 1;
                updateVcrPosition();
                return;
            }

            highlightMessage(currentPlaybackIndex);
            const msg = conversationHistory[currentPlaybackIndex];

            if (msg.role === 'assistant') {
                // Auto-select persona based on content/context if auto mode
                if (autoMode) {
                    selectPersonaForMessage(msg.content);
                }
                // Speak the message
                speakMessage(msg.content);
                // Wait for speech to finish then continue (estimate based on text length)
                const duration = Math.max(2000, msg.content.length * 50);
                playbackTimer = setTimeout(() => playConversation(), duration);
            } else {
                // User message - shorter delay
                playbackTimer = setTimeout(() => playConversation(), 1000);
            }
        }

        function selectPersonaForMessage(content) {
            // Auto-select persona based on message content
            const lowerContent = content.toLowerCase();

            if (lowerContent.includes('error') || lowerContent.includes('warning') || lowerContent.includes('system')) {
                personaSelect.value = 'system';
                currentPersona = 'system';
            } else if (lowerContent.includes('code') || lowerContent.includes('function') || lowerContent.includes('class')) {
                personaSelect.value = 'ultron';
                currentPersona = 'ultron';
            } else {
                personaSelect.value = 'jarvis';
                currentPersona = 'jarvis';
            }
        }

        // Initialize speech recognition if available
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            recognition = new SpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onresult = (event) => {
                let transcript = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    transcript += event.results[i][0].transcript;
                }
                messageInput.value = transcript;
                autoResize();
            };

            recognition.onend = () => {
                isRecording = false;
                voiceButton.classList.remove('recording');
                voiceButton.textContent = '🎤';
            };

            recognition.onerror = (event) => {
                console.error('Speech recognition error:', event.error);
                isRecording = false;
                voiceButton.classList.remove('recording');
                voiceButton.textContent = '🎤';
            };
        }

        // Streaming state
        let currentStreamDiv = null;
        let currentStreamContent = '';
        let isStreaming = false;

        function startStreaming() {
            if (!hasMessages) {
                messagesDiv.innerHTML = '';
                hasMessages = true;
            }

            isStreaming = true;
            currentStreamContent = '';
            sendButton.disabled = true;
            stopButton.style.display = 'inline-flex';

            // Create streaming message container
            currentStreamDiv = document.createElement('div');
            currentStreamDiv.className = 'message assistant streaming';

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            currentStreamDiv.appendChild(contentDiv);

            messagesDiv.appendChild(currentStreamDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function appendStreamToken(token) {
            if (!currentStreamDiv) return;
            currentStreamContent += token;
            const contentDiv = currentStreamDiv.querySelector('.message-content');
            if (contentDiv) {
                contentDiv.innerHTML = parseMarkdown(currentStreamContent);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }
        }

        function endStreaming(finalContent) {
            isStreaming = false;
            sendButton.disabled = false;
            stopButton.style.display = 'none';

            if (currentStreamDiv) {
                currentStreamDiv.classList.remove('streaming');
                const contentDiv = currentStreamDiv.querySelector('.message-content');
                if (contentDiv && finalContent) {
                    contentDiv.innerHTML = parseMarkdown(finalContent);
                    addCodeBlockButtons(currentStreamDiv);
                    addSpeakButton(currentStreamDiv, finalContent);
                }

                // Track in conversation history
                conversationHistory.push({ role: 'assistant', content: finalContent || currentStreamContent });
                messageCount = conversationHistory.length;
                currentStreamDiv.dataset.index = messageCount - 1;
                updateVcrPosition();

                // Auto-speak if enabled
                if (autoMode && finalContent) {
                    speakMessage(finalContent);
                }
            }

            currentStreamDiv = null;
            currentStreamContent = '';
        }

        function addCodeBlockButtons(messageDiv) {
            const codeBlocks = messageDiv.querySelectorAll('pre');
            codeBlocks.forEach((pre, index) => {
                if (pre.querySelector('.code-actions')) return;

                const actions = document.createElement('div');
                actions.className = 'code-actions';

                const copyBtn = document.createElement('button');
                copyBtn.className = 'code-action-btn';
                copyBtn.innerHTML = '📋 Copy';
                copyBtn.onclick = () => {
                    const code = pre.querySelector('code')?.textContent || pre.textContent;
                    vscode.postMessage({ command: 'copyCode', code });
                    copyBtn.innerHTML = '✓ Copied';
                    setTimeout(() => copyBtn.innerHTML = '📋 Copy', 2000);
                };

                const insertBtn = document.createElement('button');
                insertBtn.className = 'code-action-btn';
                insertBtn.innerHTML = '⬇️ Insert';
                insertBtn.onclick = () => {
                    const code = pre.querySelector('code')?.textContent || pre.textContent;
                    vscode.postMessage({ command: 'insertCode', code });
                    insertBtn.innerHTML = '✓ Inserted';
                    setTimeout(() => insertBtn.innerHTML = '⬇️ Insert', 2000);
                };

                actions.appendChild(copyBtn);
                actions.appendChild(insertBtn);
                pre.style.position = 'relative';
                pre.insertBefore(actions, pre.firstChild);
            });
        }

        function addSpeakButton(messageDiv, content) {
            const existingSpeakBtn = messageDiv.querySelector('.speak-btn');
            if (existingSpeakBtn) return;

            const speakBtn = document.createElement('button');
            speakBtn.className = 'speak-btn';
            speakBtn.textContent = '🔊';
            speakBtn.title = 'Read aloud';
            speakBtn.onclick = () => speakMessage(content);
            messageDiv.appendChild(speakBtn);
        }

        function appendMessage(role, content, hasContext = false) {
            if (!hasMessages) {
                messagesDiv.innerHTML = '';
                hasMessages = true;
            }

            // Track in conversation history
            conversationHistory.push({ role, content, hasContext });
            messageCount = conversationHistory.length;
            updateVcrPosition();

            const div = document.createElement('div');
            div.className = 'message ' + role;
            div.dataset.index = conversationHistory.length - 1;

            if (hasContext && role === 'user') {
                const badge = document.createElement('div');
                badge.className = 'context-badge';
                badge.textContent = '📎 With context';
                div.appendChild(badge);
            }

            // Parse code blocks for assistant messages
            if (role === 'assistant') {
                const contentDiv = document.createElement('div');
                contentDiv.innerHTML = parseMarkdown(content);
                div.appendChild(contentDiv);

                // Add speaker button for TTS
                const speakBtn = document.createElement('button');
                speakBtn.className = 'speak-btn';
                speakBtn.innerHTML = '🔊';
                speakBtn.title = 'Speak this message';
                speakBtn.onclick = () => speakMessage(content);
                div.appendChild(speakBtn);

                // Auto-speak if auto mode is on
                if (autoMode) {
                    selectPersonaForMessage(content);
                    speakMessage(content);
                }
            } else {
                const textNode = document.createElement('div');
                textNode.textContent = content;
                div.appendChild(textNode);
            }

            messagesDiv.appendChild(div);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        // Voice output
        let currentAudio = null;

        function speakMessage(text) {
            // Strip markdown/code blocks for speech
            const cleanText = text
                .replace(/\`\`\`[\\s\\S]*?\`\`\`/g, 'code block omitted')
                .replace(/\`[^\`]+\`/g, '')
                .replace(/\\[([^\\]]+)\\]\\([^)]+\\)/g, '$1');

            vscode.postMessage({ command: 'speakText', text: cleanText, persona: currentPersona });
        }

        function stopSpeaking() {
            if (currentAudio) {
                currentAudio.pause();
                currentAudio = null;
            }
            if (window.speechSynthesis) {
                window.speechSynthesis.cancel();
            }
            hideSpeakingIndicator();
            vscode.postMessage({ command: 'stopSpeaking' });
        }

        function parseMarkdown(text) {
            // Simple markdown parser for code blocks
            const codeBlockRegex = /\`\`\`(\\w*)?\\n([\\s\\S]*?)\`\`\`/g;
            let result = text;
            let match;

            while ((match = codeBlockRegex.exec(text)) !== null) {
                const lang = match[1] || '';
                const code = match[2];
                const escapedCode = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const codeHtml = \`<div class="code-block">
                    <div class="code-actions">
                        <button onclick="copyCode(this)">Copy</button>
                        <button onclick="insertCode(this)">Insert</button>
                    </div>
                    <pre data-code="\${btoa(code)}"><code>\${escapedCode}</code></pre>
                </div>\`;
                result = result.replace(match[0], codeHtml);
            }

            // Handle inline code
            result = result.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

            // Handle newlines
            result = result.replace(/\\n/g, '<br>');

            return result;
        }

        function showError(error) {
            const div = document.createElement('div');
            div.className = 'message error';
            div.textContent = '⚠️ ' + error;
            messagesDiv.appendChild(div);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function sendMessage() {
            const text = messageInput.value.trim();
            if (!text && pendingImages.length === 0) return;

            // Build file context from mentioned files
            let fileContext = '';
            if (mentionedFiles.length > 0) {
                fileContext = mentionedFiles
                    .filter(f => f.content)
                    .map(f => '[File: ' + f.path + ']\\n\`\`\`\\n' + f.content + '\\n\`\`\`')
                    .join('\\n\\n');
            }

            messageInput.value = '';
            autoResize();
            sendButton.disabled = true;

            vscode.postMessage({
                command: 'sendMessage',
                text: text,
                includeContext: includeContextCheckbox.checked,
                images: pendingImages,
                fileContext: fileContext,
                mentionedFiles: mentionedFiles.map(f => ({ name: f.name, path: f.path }))
            });

            // Clear pending images and mentions
            pendingImages = [];
            imagePreview.innerHTML = '';
            mentionedFiles = [];
            renderMentionedFiles();

            // Save conversation periodically
            setTimeout(() => {
                vscode.postMessage({ command: 'saveConversation' });
            }, 1000);
        }

        // Event listeners
        sendButton.addEventListener('click', sendMessage);

        stopButton.addEventListener('click', () => {
            vscode.postMessage({ command: 'stopGeneration' });
        });

        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        function autoResize() {
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
        }
        messageInput.addEventListener('input', autoResize);

        clearButton.addEventListener('click', () => {
            vscode.postMessage({ command: 'clearChat' });
            messagesDiv.innerHTML = '<div class="welcome"><h2>Welcome to JARVIS</h2><p>Select a model above and start chatting.</p><p>Use 📎 to include file context, 🖼️ for images.</p></div>';
            hasMessages = false;
            // Reset VCR state
            conversationHistory = [];
            currentPlaybackIndex = -1;
            isPlaying = false;
            if (playbackTimer) clearTimeout(playbackTimer);
            updateVcrPosition();
            stopSpeaking();
        });

        settingsButton.addEventListener('click', () => {
            vscode.postMessage({ command: 'openSettings' });
        });

        modelSelect.addEventListener('change', () => {
            vscode.postMessage({ command: 'changeModel', model: modelSelect.value });
        });

        refreshModels.addEventListener('click', () => {
            vscode.postMessage({ command: 'refreshModels' });
        });

        voiceButton.addEventListener('click', () => {
            if (!recognition) {
                showError('Speech recognition not available in this browser');
                return;
            }

            if (isRecording) {
                recognition.stop();
            } else {
                isRecording = true;
                voiceButton.classList.add('recording');
                voiceButton.textContent = '⏹️';
                recognition.start();
            }
        });

        imageButton.addEventListener('click', () => {
            imageInput.click();
        });

        imageInput.addEventListener('change', (e) => {
            const files = e.target.files;
            for (const file of files) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const base64 = event.target.result.split(',')[1];
                    pendingImages.push(base64);

                    const imgContainer = document.createElement('div');
                    imgContainer.className = 'remove-img';
                    const img = document.createElement('img');
                    img.src = event.target.result;
                    imgContainer.appendChild(img);
                    imgContainer.onclick = () => {
                        const idx = pendingImages.indexOf(base64);
                        if (idx > -1) pendingImages.splice(idx, 1);
                        imgContainer.remove();
                    };
                    imagePreview.appendChild(imgContainer);
                };
                reader.readAsDataURL(file);
            }
            imageInput.value = '';
        });

        // Code block actions (global functions for onclick)
        window.copyCode = function(btn) {
            const pre = btn.closest('.code-block').querySelector('pre');
            const code = atob(pre.dataset.code);
            vscode.postMessage({ command: 'copyCode', code: code });
        };

        window.insertCode = function(btn) {
            const pre = btn.closest('.code-block').querySelector('pre');
            const code = atob(pre.dataset.code);
            vscode.postMessage({ command: 'insertCode', code: code });
        };

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.command) {
                case 'chatMessage':
                    appendMessage(message.role, message.content, message.hasContext);
                    sendButton.disabled = false;
                    stopButton.style.display = 'none';
                    break;
                case 'streamStart':
                    startStreaming();
                    break;
                case 'streamToken':
                    appendStreamToken(message.token);
                    break;
                case 'streamEnd':
                    endStreaming(message.content);
                    break;
                case 'generationStopped':
                    endStreaming(currentStreamContent);
                    break;
                case 'chatError':
                    showError(message.error);
                    sendButton.disabled = false;
                    stopButton.style.display = 'none';
                    break;
                case 'chatCleared':
                    break;
                case 'typing':
                    typingIndicator.classList.toggle('show', message.show);
                    break;
                case 'modelsLoaded':
                    modelSelect.innerHTML = message.models.map(m =>
                        \`<option value="\${m}" \${m === message.current ? 'selected' : ''}>\${m}</option>\`
                    ).join('');
                    hideAlert(); // Models loaded = connection OK
                    break;
                case 'modelChanged':
                    // Silent update
                    break;
                case 'connectionStatus':
                    if (message.status === 'offline') {
                        showAlert('Cannot connect to AI. Is Ollama running?', 'error');
                    } else {
                        hideAlert();
                    }
                    break;
                case 'speakingStart':
                    showSpeakingIndicator(message.persona, message.text);
                    break;
                case 'playAudio':
                    // Play audio from Voice Actor service
                    stopSpeaking();
                    const audioData = atob(message.audio_base64);
                    const audioArray = new Uint8Array(audioData.length);
                    for (let i = 0; i < audioData.length; i++) {
                        audioArray[i] = audioData.charCodeAt(i);
                    }
                    const audioBlob = new Blob([audioArray], { type: message.format || 'audio/mpeg' });
                    const audioUrl = URL.createObjectURL(audioBlob);
                    currentAudio = new Audio(audioUrl);
                    currentAudio.play();
                    currentAudio.onended = () => {
                        URL.revokeObjectURL(audioUrl);
                        currentAudio = null;
                        hideSpeakingIndicator();
                    };
                    break;
                case 'voiceStatus':
                    voiceServiceOnline = message.available;
                    if (message.currentPersona) {
                        currentPersona = message.currentPersona;
                        personaSelect.value = currentPersona;
                    }
                    if (message.autoPersona !== undefined) {
                        autoMode = message.autoPersona;
                        autoModeCheckbox.checked = autoMode;
                    }
                    updatePersonaIndicator();
                    break;
                case 'personaChanged':
                    currentPersona = message.persona;
                    personaSelect.value = currentPersona;
                    updatePersonaIndicator();
                    break;
                case 'filesFound':
                    showMentionsDropdown(message.files || []);
                    break;
                case 'fileContent':
                    // Store file content for context
                    const file = mentionedFiles.find(f => f.path === message.path);
                    if (file) {
                        file.content = message.content;
                    }
                    break;
                case 'conversationLoaded':
                    if (message.history && message.history.length > 0) {
                        // Restore conversation
                        conversationHistory = [];
                        hasMessages = false;
                        messagesDiv.innerHTML = '';
                        message.history.forEach(msg => {
                            appendMessage(msg.role, msg.content, false);
                        });
                    }
                    break;
                case 'speakWithBrowser':
                    // Fallback: use browser speech synthesis
                    if (window.speechSynthesis) {
                        stopSpeaking();
                        const utterance = new SpeechSynthesisUtterance(message.text);
                        utterance.rate = 1.0;
                        utterance.pitch = 1.0;
                        window.speechSynthesis.speak(utterance);
                    }
                    break;
                case 'speechStopped':
                    stopSpeaking();
                    break;
            }
        });
    </script>
</body>
</html>`;
  }
}
