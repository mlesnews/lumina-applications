# JARVIS Master Agent - macOS Desktop Application

macOS desktop application for JARVIS Master Agent.

## Features

- **Dashboard** - System overview, metrics, status
- **Chat Interface** - Direct chat with JARVIS
- **Workflow Management** - Create, manage, execute workflows
- **Knowledge Management** - R5 knowledge search and access
- **Helpdesk Interface** - Ticket management and tracking
- **Settings** - Configuration and preferences

## Architecture

- **Framework**: SwiftUI / AppKit
- **API Integration**: JARVIS Master Agent API (REST + WebSocket)
- **Authentication**: JWT tokens with refresh
- **Real-time Updates**: WebSocket connection
- **macOS Design Guidelines**: Follows Apple Human Interface Guidelines

## Development Setup

```bash
# Install Xcode 15+
# Install Swift 5.9+

# Build
swift build

# Run
swift run
```

## Configuration

Edit `Config.plist`:
```xml
<key>ApiBaseUrl</key>
<string>https://api.jarvis.example.com</string>
<key>WebSocketUrl</key>
<string>wss://api.jarvis.example.com/ws</string>
```

## Build and Deploy

1. Build Release configuration
2. Code sign with Apple Developer certificate
3. Notarize with Apple
4. Package as .app bundle or .dmg
5. Distribute via Mac App Store or direct download
