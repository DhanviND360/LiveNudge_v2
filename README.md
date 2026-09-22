# LiveNudge (v2)

A real-time AI communication coach built with **Expo (SDK 57)** and **Sarvam AI**.

## Current Development Progress

- **Microphone Recording**: Native audio recording using `expo-audio` (`useAudioRecorder`, `AudioModule`). Tested and working in Expo Go on Android.
- **Audio Capture**: Successfully captures and stores `.m4a` audio files in cache (`Audio/recording-*.m4a`).
- **Sarvam STT Integration**: Configured to upload native audio files directly to `https://api.sarvam.ai/speech-to-text` (`saaras:v3`).
- **Sarvam Chat Reasoning**: Connects to `https://api.sarvam.ai/v1/chat/completions` using `sarvam-105b-conversations` with `reasoning_effort: null` for low latency.
- **UI & Controls**:
  - Live recording state with timer and status badges.
  - Interactive **Sarvam API Configuration** panel (editable STT/Chat URLs, models, and API key).
  - Dedicated **Speech Transcript** card.
  - Dedicated **Chat Conversation Log** (user prompt + coach nudge).
- **Terminal Observability**: Real-time console logging for every stage (mic, STT, Chat completions, errors).

---

## Known Errors & Warnings Encountered

During testing on Expo Go (Android), the following runtime logs and errors were recorded:

```text
WARN  SafeAreaView has been deprecated and will be removed in a future release. Please use 'react-native-safe-area-context' instead. See https://github.com/AppAndFlow/react-native-safe-area-context
LOG  🔒 [LiveNudge] Checking microphone permissions...
LOG  🔒 [LiveNudge] Microphone permission status: granted
LOG  
========================================================
LOG  🎙️ [LiveNudge] STARTING MICROPHONE RECORDING
LOG  ========================================================
LOG  
========================================================
LOG  ⏹️ [LiveNudge] STOPPING RECORDING
LOG  ========================================================
LOG  📁 [LiveNudge] Audio file URI: file:///data/user/0/host.exp.exponent/cache/ExperienceData/%2540anonymous%252FLivenudge_v2-310acf8f-0fde-47a0-832b-df25298c0e69/Audio/recording-b214fcbd-910f-431b-a611-5d8e0c311872.m4a
WARN  Method getInfoAsync imported from "expo-file-system" is deprecated.
You can migrate to the new filesystem API using "File" and "Directory" classes or import the legacy API from "expo-file-system/legacy".
API reference and examples are available in the filesystem docs: https://docs.expo.dev/versions/v54.0.0/sdk/filesystem/
ERROR  ❌ [LiveNudge] Failed to stop recording: [Error: Method getInfoAsync imported from "expo-file-system" is deprecated.
You can migrate to the new filesystem API using "File" and "Directory" classes or import the legacy API from "expo-file-system/legacy".
API reference and examples are available in the filesystem docs: https://docs.expo.dev/versions/v54.0.0/sdk/filesystem/]
```

### Status: Resolved
1. Replaced deprecated `getInfoAsync` with modern `File` API + `expo-file-system/legacy` fallback; file validation is non-blocking and verified `.m4a` URIs stream reliably into Sarvam STT.
2. Replaced deprecated `SafeAreaView` with `react-native-safe-area-context` (`SafeAreaProvider` & `SafeAreaView`).
