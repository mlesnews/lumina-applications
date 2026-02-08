# JARVIS Master Agent - Windows Desktop Application

Windows desktop application for JARVIS Master Agent.

## Features

- **Dashboard** - System overview, metrics, status
- **Chat Interface** - Direct chat with JARVIS
- **Workflow Management** - Create, manage, execute workflows
- **Knowledge Management** - R5 knowledge search and access
- **Helpdesk Interface** - Ticket management and tracking
- **Settings** - Configuration and preferences

## Architecture

- **Framework**: WPF (.NET 8) or WinUI 3
- **API Integration**: JARVIS Master Agent API (REST + WebSocket)
- **Authentication**: JWT tokens with refresh
- **Real-time Updates**: WebSocket connection

## Development Setup

```bash
# Install .NET 8 SDK
# Install Visual Studio 2022

# Build
dotnet build

# Run
dotnet run
```

## Configuration

Edit `appsettings.json`:
```json
{
  "ApiBaseUrl": "https://api.jarvis.example.com",
  "WebSocketUrl": "wss://api.jarvis.example.com/ws",
  "AutoRefresh": true,
  "RefreshInterval": 30
}
```

## Build and Deploy

1. Build Release configuration
2. Package as MSIX or installer
3. Sign with certificate
4. Distribute via Microsoft Store or direct download
