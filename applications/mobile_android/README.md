# JARVIS Master Agent - Android Mobile Application

Android mobile application for JARVIS Master Agent.

## Features

- **Dashboard** - System overview, metrics, status
- **Chat Interface** - Direct chat with JARVIS
- **Workflow Management** - Create, manage, execute workflows
- **Knowledge Access** - R5 knowledge search
- **Helpdesk Mobile** - Ticket management on the go
- **Push Notifications** - Real-time alerts and updates

## Architecture

- **Framework**: Jetpack Compose
- **Minimum Android**: API 26 (Android 8.0)
- **Target Android**: API 34 (Android 14)
- **API Integration**: JARVIS Master Agent API (REST + WebSocket)
- **Authentication**: JWT tokens with Secure Storage
- **Real-time Updates**: WebSocket connection
- **Push Notifications**: Firebase Cloud Messaging (FCM)
- **Material Design**: Follows Material Design 3 guidelines

## Development Setup

```bash
# Install Android Studio
# Install Android SDK (API 26+)

# Build
./gradlew build

# Run
./gradlew installDebug
```

## Configuration

Edit `app/src/main/res/values/config.xml`:
```xml
<string name="api_base_url">https://api.jarvis.example.com</string>
<string name="websocket_url">wss://api.jarvis.example.com/ws</string>
<bool name="push_notification_enabled">true</bool>
```

## Build and Deploy

1. Configure signing in `app/build.gradle`
2. Build Release APK/AAB
3. Sign with release keystore
4. Upload to Google Play Console
5. Submit for Play Store review

## Play Store Requirements

- Privacy policy URL
- App description and screenshots
- Content rating
- Play Store guidelines compliance
