import { ChildProcess, spawn } from "child_process";
import * as http from "http";
import * as path from "path";
import * as vscode from "vscode";
import { ApiClient } from "./apiClient";
import { ChatViewProvider } from "./chatViewProvider";

let voiceActorProcess: ChildProcess | null = null;

/**
 * Check if Voice Actor service is already running
 */
async function isVoiceServiceRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:11436/health", (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Start Voice Actor service automatically
 */
async function startVoiceActorService(
  outputChannel: vscode.OutputChannel
): Promise<void> {
  // Check if already running
  if (await isVoiceServiceRunning()) {
    outputChannel.appendLine("[Voice] Service already running on port 11436");
    return;
  }

  // Find the service directory
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return;

  // Try to find voice_actor service in workspace
  const possiblePaths = [
    path.join(workspaceFolders[0].uri.fsPath, "services", "voice_actor"),
    path.join(
      workspaceFolders[0].uri.fsPath,
      ".lumina",
      "services",
      "voice_actor"
    ),
    "c:\\Users\\mlesn\\Dropbox\\my_projects\\.lumina\\services\\voice_actor",
  ];

  let serviceDir: string | null = null;
  for (const p of possiblePaths) {
    try {
      const fs = require("fs");
      if (fs.existsSync(path.join(p, "voice_actor_service.py"))) {
        serviceDir = p;
        break;
      }
    } catch {}
  }

  if (!serviceDir) {
    outputChannel.appendLine("[Voice] Service directory not found");
    return;
  }

  outputChannel.appendLine(`[Voice] Starting service from ${serviceDir}`);

  try {
    // Start the service using Python directly (more reliable than PowerShell)
    const pythonScript = path.join(serviceDir, "voice_actor_service.py");

    voiceActorProcess = spawn("python", [pythonScript], {
      cwd: serviceDir,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });

    voiceActorProcess.unref();

    // Wait a moment and check if it started
    await new Promise((resolve) => setTimeout(resolve, 3000));

    if (await isVoiceServiceRunning()) {
      outputChannel.appendLine(
        "[Voice] Service started successfully on port 11436"
      );
      vscode.window.setStatusBarMessage("🔊 Voice Actor ready", 3000);
    } else {
      outputChannel.appendLine(
        "[Voice] Service may not have started - check manually"
      );
    }
  } catch (error: any) {
    outputChannel.appendLine(`[Voice] Failed to start: ${error.message}`);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("jarvis.chat");

  // Gateway URL (default: 11435) or direct Ollama (11434)
  const apiBaseUrl = config.get<string>(
    "apiBaseUrl",
    "http://localhost:11435/v1"
  );
  const model = config.get<string>("model", "ULTRON");
  const fallbackToOllama = config.get<boolean>("fallbackToOllama", true);
  const autoStartVoice = config.get<boolean>("autoStartVoiceService", true);

  const apiClient = new ApiClient(apiBaseUrl, model, fallbackToOllama);

  // Register the chat view provider for the sidebar
  const chatViewProvider = new ChatViewProvider(
    context.extensionUri,
    apiClient
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      chatViewProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Command to open/focus the chat
  const chatCommand = vscode.commands.registerCommand(
    "jarvis.chat.open",
    () => {
      vscode.commands.executeCommand("workbench.view.extension.lumina");
    }
  );

  // Command to select model
  const selectModelCommand = vscode.commands.registerCommand(
    "jarvis.chat.selectModel",
    async () => {
      const models = await apiClient.listModels();
      if (models.length === 0) {
        vscode.window.showWarningMessage(
          "No models available. Is Ollama running?"
        );
        return;
      }

      const selected = await vscode.window.showQuickPick(models, {
        placeHolder: "Select a model",
        title: "JARVIS - Select Model",
      });

      if (selected) {
        apiClient.setModel(selected);
        vscode.window.showInformationMessage(`Model set to: ${selected}`);
      }
    }
  );

  // Workflow trigger
  const workflowCommand = vscode.commands.registerCommand(
    "jarvis.workflow.trigger",
    async () => {
      const workflowId = await vscode.window.showInputBox({
        prompt: "Enter workflow ID to trigger",
        placeHolder: "workflow-id",
      });

      if (workflowId) {
        await apiClient.triggerWorkflow(workflowId);
        vscode.window.showInformationMessage(
          `Workflow ${workflowId} triggered`
        );
      }
    }
  );

  // Knowledge search
  const knowledgeCommand = vscode.commands.registerCommand(
    "jarvis.knowledge.search",
    async () => {
      const query = await vscode.window.showInputBox({
        prompt: "Search R5 Knowledge",
        placeHolder: "Enter search query",
      });

      if (query) {
        const results = await apiClient.searchKnowledge(query);
        vscode.window.showInformationMessage(`Found ${results.length} results`);
      }
    }
  );

  context.subscriptions.push(
    chatCommand,
    selectModelCommand,
    workflowCommand,
    knowledgeCommand
  );

  // Log startup info
  const outputChannel = vscode.window.createOutputChannel("JARVIS Chat");
  outputChannel.appendLine(`JARVIS Chat activated`);
  outputChannel.appendLine(`API: ${apiBaseUrl}`);
  outputChannel.appendLine(`Model: ${model}`);
  outputChannel.appendLine(`Fallback: ${fallbackToOllama}`);
  outputChannel.appendLine(`Auto-start Voice: ${autoStartVoice}`);

  // Auto-start Voice Actor service
  if (autoStartVoice) {
    startVoiceActorService(outputChannel);
  }
}

export function deactivate() {
  // Clean up voice actor process if we started it
  if (voiceActorProcess) {
    try {
      // Don't kill - let it keep running for other sessions
      voiceActorProcess = null;
    } catch {}
  }
}
