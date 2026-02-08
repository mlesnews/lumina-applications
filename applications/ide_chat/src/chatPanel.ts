import * as vscode from 'vscode';
import { ApiClient } from './apiClient';

export class ChatPanel {
    public static currentPanel: ChatPanel | undefined;
    public static readonly viewType = 'jarvisChat';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _apiClient: ApiClient;
    private _disposables: vscode.Disposable[] = [];
    private _conversationMessages: { role: string; content: string }[] = [];
    private _conversation: { role: string; content: string }[] = [];

    public static createOrShow(extensionUri: vscode.Uri, apiClient: ApiClient) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (ChatPanel.currentPanel) {
            ChatPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ChatPanel.viewType,
            'Lumina JARVIS Chat',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        ChatPanel.currentPanel = new ChatPanel(panel, extensionUri, apiClient);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, apiClient: ApiClient) {
        this._panel = panel;
        this._apiClient = apiClient;

        this._panel.webview.html = this._getHtmlForWebview();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'sendMessage':
                        await this._handleSendMessage(message.text);
                        break;
                    case 'searchAgentHistory':
                        await this._handleSearchAgentHistory(message.keyword, message.limit, message.offset);
                        break;
                    case 'getAgentHistory':
                        await this._handleGetAgentHistory(message.historyId);
                        break;
                    case 'pinAgentHistory':
                        await this._handlePinAgentHistory(message.historyId);
                        break;
                    case 'unpinAgentHistory':
                        await this._handleUnpinAgentHistory(message.historyId);
                        break;
                    case 'getPinnedHistories':
                        await this._handleGetPinnedHistories();
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    private async _handleSendMessage(text: string) {
        const userMessage = text.trim();
        if (!userMessage) return;

        this._conversationMessages.push({ role: 'user', content: userMessage });
        this._panel.webview.postMessage({ command: 'chatMessage', role: 'user', content: userMessage });

        try {
            const reply = await this._apiClient.chatCompletions(this._conversationMessages);
            this._conversationMessages.push({ role: 'assistant', content: reply });
            this._panel.webview.postMessage({ command: 'chatMessage', role: 'assistant', content: reply });
        } catch (error: any) {
            const errMsg = error.message || 'JARVIS could not respond.';
            this._panel.webview.postMessage({ command: 'chatError', error: errMsg });
            this._conversationMessages.pop();
        }
    }

    private async _handleSearchAgentHistory(keyword: string, limit: number = 20, offset: number = 0) {
        try {
            const result = await this._apiClient.searchAgentHistory(keyword, limit, offset);
            this._panel.webview.postMessage({
                command: 'agentHistorySearchResult',
                data: result
            });
        } catch (error: any) {
            this._panel.webview.postMessage({
                command: 'agentHistorySearchError',
                error: error.message || 'Search failed'
            });
        }
    }

    private async _handleGetAgentHistory(historyId: string) {
        try {
            const history = await this._apiClient.getAgentHistory(historyId);
            this._panel.webview.postMessage({
                command: 'agentHistoryLoaded',
                data: history
            });
        } catch (error: any) {
            this._panel.webview.postMessage({
                command: 'agentHistoryLoadError',
                error: error.message || 'Failed to load agent history'
            });
        }
    }

    private async _handlePinAgentHistory(historyId: string) {
        try {
            const success = await this._apiClient.pinAgentHistory(historyId);
            this._panel.webview.postMessage({
                command: 'agentHistoryPinned',
                historyId: historyId,
                success: success
            });
            if (success) {
                vscode.window.showInformationMessage(`Agent history ${historyId} pinned`);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to pin agent history: ${error.message}`);
        }
    }

    private async _handleUnpinAgentHistory(historyId: string) {
        try {
            const success = await this._apiClient.unpinAgentHistory(historyId);
            this._panel.webview.postMessage({
                command: 'agentHistoryUnpinned',
                historyId: historyId,
                success: success
            });
            if (success) {
                vscode.window.showInformationMessage(`Agent history ${historyId} unpinned`);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to unpin agent history: ${error.message}`);
        }
    }

    private async _handleGetPinnedHistories() {
        try {
            const pinned = await this._apiClient.getPinnedAgentHistories();
            this._panel.webview.postMessage({
                command: 'pinnedHistoriesLoaded',
                data: pinned
            });
        } catch (error: any) {
            this._panel.webview.postMessage({
                command: 'pinnedHistoriesLoadError',
                error: error.message || 'Failed to load pinned histories'
            });
        }
    }

    private _getHtmlForWebview(): string {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lumina JARVIS Chat</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family);
            padding: 0;
            margin: 0;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        .jarvis-header {
            padding: 12px 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
        }
        .jarvis-header h1 {
            margin: 0;
            font-size: 1.1em;
            font-weight: 600;
        }
        .jarvis-header .subtitle {
            margin-top: 4px;
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
        }
        .chat-main {
            display: flex;
            flex-direction: column;
            height: calc(100vh - 120px);
        }
        #messages {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .message {
            max-width: 85%;
            padding: 10px 14px;
            border-radius: 8px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-word;
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
        .message .role-label {
            font-size: 0.75em;
            opacity: 0.8;
            margin-bottom: 4px;
        }
        .chat-input-row {
            display: flex;
            gap: 8px;
            padding: 12px;
            border-top: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
        }
        #message-input {
            flex: 1;
            padding: 10px 12px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 6px;
            font-family: inherit;
        }
        #send-button {
            padding: 10px 20px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
        }
        #send-button:hover { opacity: 0.9; }
        #send-button:disabled { opacity: 0.5; cursor: not-allowed; }
        .error-banner {
            padding: 10px 12px;
            background: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-errorForeground);
            border-radius: 6px;
            margin: 0 12px 12px;
        }
        .agent-history-section {
            margin-bottom: 20px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 10px;
        }
        .search-container {
            display: flex;
            gap: 10px;
            margin-bottom: 10px;
        }
        .search-input {
            flex: 1;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
        }
        .search-button {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        .search-button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .history-results {
            max-height: 300px;
            overflow-y: auto;
        }
        .history-item {
            padding: 8px;
            margin: 5px 0;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background: var(--vscode-editor-background);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .history-item.pinned {
            border-left: 3px solid var(--vscode-textLink-foreground);
        }
        .history-item-info {
            flex: 1;
            cursor: pointer;
        }
        .history-item-title {
            font-weight: bold;
            margin-bottom: 4px;
        }
        .history-item-meta {
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
        }
        .pin-button {
            padding: 4px 8px;
            background: transparent;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            cursor: pointer;
            color: var(--vscode-foreground);
        }
        .pin-button:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .pin-button.pinned {
            background: var(--vscode-textLink-foreground);
            color: white;
        }
        .pagination {
            display: flex;
            gap: 10px;
            margin-top: 10px;
            justify-content: center;
        }
        .pagination-button {
            padding: 6px 12px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        .pagination-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .error-message {
            color: var(--vscode-errorForeground);
            padding: 8px;
            background: var(--vscode-inputValidation-errorBackground);
            border-radius: 4px;
            margin: 10px 0;
        }
        .loading {
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="jarvis-header">
        <h1>Lumina JARVIS Chat</h1>
        <div class="subtitle">JARVIS Master Agent · CTO/Superagent · Local ULTRON</div>
    </div>
    <div class="chat-main">
        <div id="messages"></div>
        <div id="error-banner" class="error-banner" style="display: none;"></div>
        <div class="chat-input-row">
            <input type="text" id="message-input" placeholder="Type a message to JARVIS...">
            <button id="send-button">Send</button>
        </div>
    </div>
    <details class="agent-history-section" style="margin: 12px; padding: 10px; border: 1px solid var(--vscode-input-border); border-radius: 6px;">
        <summary style="cursor: pointer;">Agent History (optional)</summary>
        <div class="search-container" style="margin-top: 10px;">
            <input type="text" id="history-search-input" class="search-input" placeholder="Search agent history...">
            <button id="history-search-button" class="search-button">Search</button>
        </div>
        <div id="history-results" class="history-results"></div>
        <div id="history-pagination" class="pagination" style="display: none;">
            <button id="prev-page" class="pagination-button">Previous</button>
            <span id="page-info"></span>
            <button id="next-page" class="pagination-button">Next</button>
        </div>
    </details>
    <script>
        const vscode = acquireVsCodeApi();
        let currentSearchKeyword = '';
        let currentOffset = 0;
        let currentLimit = 20;
        let currentTotal = 0;

        // Search functionality
        document.getElementById('history-search-button').addEventListener('click', () => {
            const keyword = document.getElementById('history-search-input').value.trim();
            if (keyword) {
                currentSearchKeyword = keyword;
                currentOffset = 0;
                searchAgentHistory(keyword, currentLimit, 0);
            }
        });

        document.getElementById('history-search-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('history-search-button').click();
            }
        });

        // Pagination
        document.getElementById('prev-page').addEventListener('click', () => {
            if (currentOffset > 0) {
                currentOffset = Math.max(0, currentOffset - currentLimit);
                searchAgentHistory(currentSearchKeyword, currentLimit, currentOffset);
            }
        });

        document.getElementById('next-page').addEventListener('click', () => {
            if (currentOffset + currentLimit < currentTotal) {
                currentOffset += currentLimit;
                searchAgentHistory(currentSearchKeyword, currentLimit, currentOffset);
            }
        });

        function searchAgentHistory(keyword, limit, offset) {
            const resultsDiv = document.getElementById('history-results');
            resultsDiv.innerHTML = '<div class="loading">Searching...</div>';
            
            vscode.postMessage({
                command: 'searchAgentHistory',
                keyword: keyword,
                limit: limit,
                offset: offset
            });
        }

        function loadAgentHistory(historyId) {
            vscode.postMessage({
                command: 'getAgentHistory',
                historyId: historyId
            });
        }

        function pinAgentHistory(historyId) {
            vscode.postMessage({
                command: 'pinAgentHistory',
                historyId: historyId
            });
        }

        function unpinAgentHistory(historyId) {
            vscode.postMessage({
                command: 'unpinAgentHistory',
                historyId: historyId
            });
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'chatMessage':
                    appendMessage(message.role, message.content);
                    sendButton.disabled = false;
                    break;
                case 'chatError':
                    errorBanner.textContent = message.error;
                    errorBanner.style.display = 'block';
                    sendButton.disabled = false;
                    break;
                case 'agentHistorySearchResult':
                    displaySearchResults(message.data);
                    break;
                case 'agentHistorySearchError':
                    displayError(message.error);
                    break;
                case 'agentHistoryLoaded':
                    displayHistoryDetails(message.data);
                    break;
                case 'agentHistoryLoadError':
                    displayError(message.error);
                    break;
                case 'agentHistoryPinned':
                case 'agentHistoryUnpinned':
                    if (currentSearchKeyword) {
                        searchAgentHistory(currentSearchKeyword, currentLimit, currentOffset);
                    }
                    break;
            }
        });

        function displaySearchResults(data) {
            const resultsDiv = document.getElementById('history-results');
            const paginationDiv = document.getElementById('history-pagination');
            const pageInfo = document.getElementById('page-info');
            
            currentTotal = data.total;
            
            if (data.items.length === 0) {
                resultsDiv.innerHTML = '<div class="loading">No results found</div>';
                paginationDiv.style.display = 'none';
                return;
            }

            let html = '';
            data.items.forEach(item => {
                const pinnedClass = item.pinned ? 'pinned' : '';
                const pinButtonText = item.pinned ? 'Unpin' : 'Pin';
                const pinButtonClass = item.pinned ? 'pinned' : '';
                
                html += \`
                    <div class="history-item \${pinnedClass}">
                        <div class="history-item-info" onclick="loadAgentHistory('\${item.history_id}')">
                            <div class="history-item-title">\${item.agent_name || item.history_id}</div>
                            <div class="history-item-meta">
                                Status: \${item.status} | Type: \${item.agent_type} | Updated: \${new Date(item.updated_at).toLocaleString()}
                            </div>
                        </div>
                        <button class="pin-button \${pinButtonClass}" onclick="togglePin('\${item.history_id}', \${item.pinned})">
                            \${pinButtonText}
                        </button>
                    </div>
                \`;
            });
            
            resultsDiv.innerHTML = html;
            
            // Update pagination
            if (data.hasMore || currentOffset > 0) {
                paginationDiv.style.display = 'flex';
                const currentPage = Math.floor(currentOffset / currentLimit) + 1;
                const totalPages = Math.ceil(currentTotal / currentLimit);
                pageInfo.textContent = \`Page \${currentPage} of \${totalPages} (\${currentTotal} total)\`;
                
                document.getElementById('prev-page').disabled = currentOffset === 0;
                document.getElementById('next-page').disabled = !data.hasMore;
            } else {
                paginationDiv.style.display = 'none';
            }
        }

        function displayError(error) {
            const resultsDiv = document.getElementById('history-results');
            resultsDiv.innerHTML = \`<div class="error-message">Error: \${error}</div>\`;
        }

        function displayHistoryDetails(history) {
            // Could open a new panel or display in a modal
            vscode.postMessage({
                command: 'showHistoryDetails',
                history: history
            });
        }

        function togglePin(historyId, isPinned) {
            if (isPinned) {
                unpinAgentHistory(historyId);
            } else {
                pinAgentHistory(historyId);
            }
        }

        // Make functions available globally
        window.loadAgentHistory = loadAgentHistory;
        window.togglePin = togglePin;
    </script>
</body>
</html>`;
    }

    public dispose() {
        ChatPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
