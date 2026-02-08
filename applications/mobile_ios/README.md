# JARVIS Master Agent - iOS Mobile Application

iOS mobile application for JARVIS Master Agent.

## Features

- **Dashboard** - System overview, metrics, status
- **Chat Interface** - Direct chat with JARVIS
- **Workflow Management** - Create, manage, execute workflows
- **Knowledge Access** - R5 knowledge search
- **Helpdesk Mobile** - Ticket management on the go
- **Push Notifications** - Real-time alerts and updates

## Architecture

- **Framework**: SwiftUI
- **Minimum iOS**: iOS 16.0+
- **API Integration**: JARVIS Master Agent API (REST + WebSocket)
- **Authentication**: JWT tokens with Keychain storage
- **Real-time Updates**: WebSocket connection
- **Push Notifications**: Apple Push Notification Service (APNS)

## Development Setup

```bash
# Install Xcode 15+
# Install CocoaPods (if using)

# Install dependencies
pod install

# Open workspace
open JarvisMobile.xcworkspace
```

## Configuration

Edit `Config.plist`:
```xml
<key>ApiBaseUrl</key>
<string>https://api.jarvis.example.com</string>
<key>WebSocketUrl</key>
<string>wss://api.jarvis.example.com/ws</string>
<key>PushNotificationEnabled</key>
<true/>
```

## Build and Deploy

1. Configure App ID and certificates in Xcode
2. Build for Release
3. Archive the app
4. Upload to App Store Connect
5. Submit for App Store review

## App Store Requirements

- Privacy policy URL
- App description and screenshots
- Age rating
- App Store guidelines compliance
