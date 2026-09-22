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
3. Installed missing peer dependency `expo-asset` required by `expo-audio` (`21/21 expo-doctor` checks pass).

---

## How to Run on Mobile Device

### Prerequisites
1. Install **Expo Go** from Google Play Store (Android) or App Store (iOS).
2. Connect your phone and PC to the same Wi-Fi network (or use Tunnel mode `--tunnel`).
3. Ensure `.env` contains your valid `SARVAM_API_KEY`:
   ```env
   SARVAM_API_KEY=your_key_here
   ```

### Start Development Server
```bash
npx expo start
```
- For LAN connection: Scan the displayed QR code with the Expo Go app.
- For Tunnel connection (if on different Wi-Fi or cellular):
  ```bash
  npx expo start --tunnel
  ```

---

## Verified End-to-End Flow
1. **Home Screen**: Tap **"Start Conversation"**.
2. **Recording Screen**: Speak naturally for 5–20 seconds into the microphone. Timer tracks elapsed seconds.
3. **End Conversation**: Tap **"End Conversation"**.
4. **Processing Screen**: Real-time visual progress through:
   - `Transcribing` (Sarvam STT `saaras:v3`)
   - `Analyzing conversation` (Sarvam 105B reasoning)
   - `Preparing your nudge`
5. **Result Screen**: Displays:
   - Communication Mode badge (e.g. `CLARITY`, `CONFIDENCE`, `EMPATHY`, `CONCISE_RESPONSE`)
   - Primary actionable Nudge
   - Suggested Action micro-step
   - Observable Conversational Signals (or clean delivery notice)
   - Collapsible Spoken Transcript accordion
6. **Session Insights**:
   - Concise Session Summary (duration, words spoken, focus mode, key takeaway)
   - Deterministic Communication Score (e.g. `73/100 (Effective)`)
   - Score Factor breakdown with specific point adjustments
   - Relational Conversation Graph (Entities & Semantic Relationships)
7. **Complete Screen**:
   - Summary checkmark & compact score
   - "View Insights" button
   - "Start New Conversation" button (resets state cleanly for next run)
