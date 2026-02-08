# Windows 11 Widgets - JARVIS Master Agent

Windows 11 widgets for JARVIS Master Agent integration.

## Widgets

1. **Status Widget** - System status, health checks, uptime
2. **Workflow Widget** - Active workflows, workflow management
3. **Helpdesk Widget** - Ticket status, new tickets, ticket management
4. **R5 Knowledge Widget** - Knowledge search, recent patterns
5. **Notification Widget** - Real-time notifications, alerts

## Architecture

- **Framework**: WinUI 3 / Windows App SDK
- **API Integration**: JARVIS Master Agent API (REST + WebSocket)
- **Authentication**: JWT tokens with refresh
- **Real-time Updates**: WebSocket connection for live data

## Development Setup

```bash
# Install Windows App SDK
# Install Visual Studio 2022 with Windows App SDK workload

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
  "RefreshInterval": 30
}
```

## Widget Implementation

Each widget is a separate WinUI 3 widget component that:
- Connects to JARVIS Master Agent API
- Displays real-time data
- Supports user interactions
- Updates via WebSocket

## Deployment

1. Build the application
2. Package as MSIX
3. Sign with certificate
4. Deploy via Microsoft Store or sideload
