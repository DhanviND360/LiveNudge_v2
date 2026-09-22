# LiveNudge

> **Communication coaching while you talk.**  
> An AI-powered mobile communication coach that listens to your conversations and delivers actionable real-time delivery nudges, deterministic scoring, and conversational relationship insights.

---

## 🚀 How It Works

LiveNudge operates on a verified, low-latency mobile pipeline:

```
[ Native Mic Capture ]
        │  (expo-audio produces .m4a in cache)
        ▼
[ Sarvam Speech-to-Text ]
        │  (POST /speech-to-text with saaras:v3)
        ▼
[ Sarvam Chat Reasoning ]
        │  (POST /v1/chat/completions with sarvam-105b-conversations)
        ▼
[ Structured Coaching Result ]
        │  (nudge, focus mode, observed signals, suggested micro-action)
        ▼
[ Deterministic Insights & Graph ]
        │  (reproducible score/100, factor deductions, relational entity graph)
        ▼
[ Local Session Persistence ]
           (saved securely to AsyncStorage)
```

---

## 📱 User Journey

1. **Home Screen**: Clean interface displaying LiveNudge coaching pillars and the primary **"Start Conversation"** action.
2. **Recording Screen**: High-quality microphone recording with live elapsed timer and intuitive **"End Conversation"** control.
3. **Processing Screen**: Real-time multi-stage progress tracking without fabricated metrics:
   - `Transcribing` (Sarvam STT)
   - `Analyzing conversation` (Sarvam 105B)
   - `Preparing your nudge`
4. **Result Screen**: Actionable feedback:
   - **Focus Mode**: Semantic badge (`clarity`, `confidence`, `empathy`, `concise_response`, etc.)
   - **Primary Nudge**: Clear, concise coaching takeaway.
   - **Suggested Action**: Immediate conversational adjustment.
   - **Observed Signals**: Observable signals (e.g. filler words, pace variance, hedge words).
   - **Spoken Transcript**: Expandable accordion with word count.
5. **Session Insights**:
   - **Concise Session Summary**: Duration, word count, focus mode, and qualitative takeaway.
   - **Deterministic Score**: Objective evaluation out of 100 derived strictly from observable signals and pace.
   - **Score Factors**: Transparent breakdown of deductions or neutral ratings.
   - **Conversation Graph**: Interactive view of conversational entities (nodes) and semantic links (relationships).
6. **Complete Screen**:
   - Compact session overview.
   - **"View Insights"** to review details.
   - **"Start New Conversation"** to reset cleanly for the next session.

---

## 🛠️ Tech Stack

- **Framework**: [Expo](https://expo.dev/) (SDK 57) / [React Native](https://reactnative.dev/) (0.86)
- **Audio Capture**: `expo-audio` (native recording in `.m4a`)
- **Speech-to-Text**: [Sarvam AI STT](https://api.sarvam.ai/speech-to-text) (`saaras:v3`)
- **Reasoning Model**: [Sarvam AI Chat](https://api.sarvam.ai/v1/chat/completions) (`sarvam-105b-conversations`, `reasoning_effort: null` for low latency)
- **State & Storage**: React Hooks & `@react-native-async-storage/async-storage`
- **File Management**: `expo-file-system/legacy` & Expo `File` API

---

## ⚡ Getting Started

### 1. Prerequisites
- Node.js (v18+)
- Mobile device with **Expo Go** installed ([Android](https://play.google.com/store/apps/details?id=host.exp.exponent) or [iOS](https://apps.apple.com/app/expo-go/id982107779))

### 2. Configure Environment
Create a `.env` file in the project root:
```env
SARVAM_API_KEY=your_sarvam_api_key_here
```

### 3. Start the Application
Run the Expo development server:
```bash
npx expo start
```

- **Same Wi-Fi**: Scan the QR code displayed in the terminal with the Expo Go app.
- **Different Network / Cellular**: Run with tunnel mode:
  ```bash
  npx expo start --tunnel
  ```

---

## 📁 Project Structure

```
├── App.js               # Main application component & screen flows
├── app.config.js        # Dynamic Expo configuration & environment injection
├── sessionStorage.js    # Local session storage operations (AsyncStorage)
├── sessionInsights.js   # Deterministic scoring algorithm & graph generation
├── .env                 # API keys & local environment configuration
└── package.json         # Dependencies & SDK 57 scripts
```

---

## 🔒 Privacy & Security

Audio and transcripts are processed securely during the active session. Only finalized coaching sessions and scores are stored locally on the device via encrypted AsyncStorage. API keys and model chain-of-thought are never logged or stored.
