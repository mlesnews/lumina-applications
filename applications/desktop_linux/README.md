# JARVIS Master Agent - Linux Desktop Application

Linux desktop application for JARVIS Master Agent.

## Features

- **Dashboard** - System overview, metrics, status
- **Chat Interface** - Direct chat with JARVIS
- **Workflow Management** - Create, manage, execute workflows
- **Knowledge Management** - R5 knowledge search and access
- **Helpdesk Interface** - Ticket management and tracking
- **Settings** - Configuration and preferences

## Architecture

- **Framework**: GTK4 / Qt6 / Electron
- **API Integration**: JARVIS Master Agent API (REST + WebSocket)
- **Authentication**: JWT tokens with refresh
- **Real-time Updates**: WebSocket connection
- **Linux Compatibility**: Supports Ubuntu, Fedora, Debian, Arch

## Development Setup

```bash
# Install dependencies
sudo apt-get install libgtk-4-dev  # Ubuntu/Debian
# or
sudo dnf install gtk4-devel  # Fedora

# Build
meson setup build
meson compile -C build

# Run
./build/jarvis-desktop
```

## Configuration

Edit `config.json`:
```json
{
  "api_base_url": "https://api.jarvis.example.com",
  "websocket_url": "wss://api.jarvis.example.com/ws",
  "auto_refresh": true,
  "refresh_interval": 30
}
```

## Build and Deploy

1. Build Release configuration
2. Package as .deb (Debian/Ubuntu), .rpm (Fedora), or AppImage
3. Distribute via package repositories or direct download
