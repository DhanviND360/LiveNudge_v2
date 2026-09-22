import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import {
  useAudioRecorder,
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorderState,
} from "expo-audio";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import Constants from "expo-constants";

// ─── Default Configuration ──────────────────────────────────────────────────
const DEFAULT_API_KEY = Constants.expoConfig?.extra?.sarvamApiKey || "";
const DEFAULT_STT_URL = "https://api.sarvam.ai/speech-to-text";
const DEFAULT_STT_MODEL = "saaras:v3";
const DEFAULT_CHAT_URL = "https://api.sarvam.ai/v1/chat/completions";
const DEFAULT_CHAT_MODEL = "sarvam-105b-conversations";

const ALLOWED_MODES = [
  "clarity",
  "empathy",
  "confidence",
  "listening",
  "tone",
  "concise_response",
];

const SYSTEM_PROMPT =
  "You are LiveNudge, an AI real-time communication coach.\n" +
  "Analyze the provided transcript of spoken audio and output ONLY a valid JSON object matching this exact schema:\n" +
  "{\n" +
  '  "nudge": "<concise actionable coaching nudge, 1-2 sentences>",\n' +
  '  "mode": "<strictly one of: clarity, empathy, confidence, listening, tone, concise_response>",\n' +
  '  "signals": ["<observable conversational signals from transcript, e.g. filler words, rushed pace, hedge words>"],\n' +
  '  "suggestedAction": "<concrete micro-action for immediate improvement>"\n' +
  "}\n" +
  "Strict constraints:\n" +
  "- Return ONLY the raw JSON object. Never return markdown code blocks, backticks, commentary, preamble, or explanations.\n" +
  "- Never include chain-of-thought, reasoning_content, or internal reasoning.\n" +
  "- Do not fabricate signals when the transcript does not support them; use an empty array [] if none are observed.\n" +
  "- If any field cannot be reliably produced, use an empty string \"\" or empty array [].\n" +
  "- 'mode' MUST be one of: clarity, empathy, confidence, listening, tone, concise_response.";

function extractJson(text) {
  if (!text || typeof text !== "string") return "";
  const trimmed = text.trim();
  const codeBlockMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1).trim();
  }
  return trimmed;
}

function validateLiveNudgeResult(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Model response is not a valid JSON object.");
  }

  // nudge: must be string
  if (typeof raw.nudge !== "string") {
    throw new Error("Missing or invalid 'nudge' field (expected string).");
  }

  // mode: must be one of allowed modes
  if (typeof raw.mode !== "string") {
    throw new Error("Missing or invalid 'mode' field (expected string).");
  }
  const normalizedMode = raw.mode.trim().toLowerCase();
  if (!ALLOWED_MODES.includes(normalizedMode)) {
    throw new Error(
      `Invalid 'mode': "${raw.mode}". Mode must be one of: ${ALLOWED_MODES.join(", ")}.`
    );
  }

  // signals: must be an array of strings
  if (!Array.isArray(raw.signals)) {
    throw new Error("Invalid 'signals' field (expected array).");
  }
  const validSignals = raw.signals
    .filter((s) => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim());

  // suggestedAction: must be string
  if (typeof raw.suggestedAction !== "string") {
    throw new Error("Missing or invalid 'suggestedAction' field (expected string).");
  }

  return {
    nudge: raw.nudge.trim(),
    mode: normalizedMode,
    signals: validSignals,
    suggestedAction: raw.suggestedAction.trim(),
  };
}

export default function App() {
  // ── Editable API Configuration State ───────────────────────────────────────
  const [apiKey, setApiKey] = useState(DEFAULT_API_KEY);
  const [sttUrl, setSttUrl] = useState(DEFAULT_STT_URL);
  const [sttModel, setSttModel] = useState(DEFAULT_STT_MODEL);
  const [chatUrl, setChatUrl] = useState(DEFAULT_CHAT_URL);
  const [chatModel, setChatModel] = useState(DEFAULT_CHAT_MODEL);
  const [showConfig, setShowConfig] = useState(false);

  // ── App Flow State ────────────────────────────────────────────────────────
  // phase: "idle" | "recording" | "transcribing" | "reasoning" | "done" | "error"
  const [phase, setPhase] = useState("idle");
  const [transcript, setTranscript] = useState("");
  const [coachingResult, setCoachingResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [permGranted, setPermGranted] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);

  // ── Expo Audio Recorder ───────────────────────────────────────────────────
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);

  // ── Request Recording Permissions on Mount ────────────────────────────────
  useEffect(() => {
    (async () => {
      console.log("🔒 [LiveNudge] Checking microphone permissions...");
      try {
        const perm = await AudioModule.requestRecordingPermissionsAsync();
        console.log("🔒 [LiveNudge] Microphone permission status:", perm.status);
        if (perm.granted) {
          setPermGranted(true);
        } else {
          setErrorMsg("Microphone permission denied. Please allow microphone access in settings.");
          setPhase("error");
        }

        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: true,
        });
      } catch (err) {
        console.error("❌ [LiveNudge] Error initializing audio permissions:", err);
      }
    })();
  }, []);

  // ── Recording Duration Timer ──────────────────────────────────────────────
  useEffect(() => {
    let timer = null;
    if (phase === "recording") {
      setRecordingDuration(0);
      timer = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timer) clearInterval(timer);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [phase]);

  // ── Reset ─────────────────────────────────────────────────────────────────
  function handleReset() {
    console.log("↺ [LiveNudge] Resetting session state.");
    setPhase("idle");
    setTranscript("");
    setCoachingResult(null);
    setErrorMsg("");
    setRecordingDuration(0);
  }

  // ── Record Start ──────────────────────────────────────────────────────────
  async function startRecording() {
    try {
      setErrorMsg("");
      if (!permGranted) {
        const perm = await AudioModule.requestRecordingPermissionsAsync();
        if (!perm.granted) {
          setErrorMsg("Microphone permission denied. Please allow microphone access in settings.");
          setPhase("error");
          return;
        }
        setPermGranted(true);
      }

      console.log("\n========================================================");
      console.log("🎙️ [LiveNudge] STARTING MICROPHONE RECORDING");
      console.log("========================================================");

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setPhase("recording");
    } catch (err) {
      console.error("❌ [LiveNudge] Failed to start recording:", err);
      setErrorMsg("Failed to start recording: " + (err.message || String(err)));
      setPhase("error");
    }
  }

  // ── Record Stop & Pipeline Trigger ────────────────────────────────────────
  async function stopRecording() {
    try {
      console.log("\n========================================================");
      console.log("⏹️ [LiveNudge] STOPPING RECORDING");
      console.log("========================================================");

      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      console.log("📁 [LiveNudge] Audio file URI:", uri);

      if (!uri) {
        throw new Error("No recorded audio file found at audioRecorder.uri");
      }

      // ── Verify Audio File (SDK 57 Compatible) ───────────────────────────
      let fileExists = true;
      let fileSize = null;

      try {
        const file = new File(uri);
        fileExists = file.exists;
        fileSize = file.size;
        console.log(
          `📊 [LiveNudge] Audio file verified via File API (exists: ${fileExists}, size: ${fileSize ?? "unknown"} bytes)`
        );
      } catch (_fileErr) {
        try {
          const info = await FileSystem.getInfoAsync(uri);
          fileExists = info.exists;
          fileSize = info.size;
          console.log(
            `📊 [LiveNudge] Audio file verified via legacy FileSystem (exists: ${fileExists}, size: ${fileSize ?? "unknown"} bytes)`
          );
        } catch (legacyErr) {
          console.warn("⚠️ [LiveNudge] Non-critical metadata query skipped, proceeding with URI:", legacyErr);
        }
      }

      if (!fileExists) {
        throw new Error("Audio file does not exist on device filesystem.");
      }

      // Proceed to STT and Chat pipeline
      await runPipeline(uri);
    } catch (err) {
      console.error("❌ [LiveNudge] Failed to stop recording:", err);
      setErrorMsg("Failed to stop recording: " + (err.message || String(err)));
      setPhase("error");
    }
  }

  // ── Execute STT and Chat Pipeline ─────────────────────────────────────────
  async function runPipeline(audioUri) {
    const key = apiKey.trim();
    if (!key) {
      const err = "Sarvam API Key is missing. Enter your key in .env or the Settings panel below.";
      console.error("❌ [LiveNudge] " + err);
      setErrorMsg(err);
      setPhase("error");
      return;
    }

    // ── STEP 1: Sarvam Speech-to-Text ───────────────────────────────────────
    setPhase("transcribing");
    let detectedTranscript = "";

    try {
      console.log("\n========================================================");
      console.log("🚀 [LiveNudge] CALLING SARVAM STT API");
      console.log("📍 STT Endpoint:", sttUrl.trim());
      console.log("⚙️ STT Model:", sttModel.trim());
      console.log("🔑 API Key Prefix:", key.substring(0, 8) + "...");
      console.log("📁 Uploading Audio URI:", audioUri);
      console.log("========================================================");

      // Determine MIME type based on file extension
      const uriParts = audioUri.split(".");
      const ext = uriParts[uriParts.length - 1]?.toLowerCase() || "m4a";
      const mimeMap = {
        m4a: "audio/mp4",
        mp4: "audio/mp4",
        wav: "audio/wav",
        mp3: "audio/mpeg",
        "3gp": "audio/3gpp",
        aac: "audio/aac",
        webm: "audio/webm",
        ogg: "audio/ogg",
      };
      const mimeType = mimeMap[ext] || "audio/mp4";
      console.log(`🎵 [LiveNudge] Audio format detected: .${ext} (${mimeType})`);

      // Use legacy FileSystem.uploadAsync for native multipart upload
      const uploadResult = await FileSystem.uploadAsync(sttUrl.trim(), audioUri, {
        httpMethod: "POST",
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: "file",
        mimeType: mimeType,
        parameters: {
          model: sttModel.trim(),
        },
        headers: {
          "api-subscription-key": key,
        },
      });

      console.log("\n========================================================");
      console.log("📥 [LiveNudge] SARVAM STT RESPONSE STATUS:", uploadResult.status);
      console.log("📦 [LiveNudge] RAW STT BODY:", uploadResult.body);
      console.log("========================================================");

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(
          `STT API returned HTTP ${uploadResult.status}: ${uploadResult.body}`
        );
      }

      const sttData = JSON.parse(uploadResult.body);
      detectedTranscript = sttData.transcript ? sttData.transcript.trim() : "";

      console.log("📝 [LiveNudge] PARSED TRANSCRIPT:", detectedTranscript);

      if (!detectedTranscript) {
        throw new Error("No speech detected in audio. Please speak clearly and try again.");
      }

      setTranscript(detectedTranscript);
    } catch (err) {
      console.error("❌ [LiveNudge] STT API Failure:", err);
      setErrorMsg("STT Error: " + (err.message || String(err)));
      setPhase("error");
      return;
    }

    // ── STEP 2: Sarvam Chat Completions Reasoning ───────────────────────────
    setPhase("reasoning");

    try {
      console.log("\n========================================================");
      console.log("🚀 [LiveNudge] CALLING SARVAM CHAT COMPLETIONS");
      console.log("📍 Chat Endpoint:", chatUrl.trim());
      console.log("🤖 Chat Model:", chatModel.trim());
      console.log("📝 Input Speech:", detectedTranscript);
      console.log("⚙️ Reasoning Effort: null (disabled for speed/latency)");
      console.log("========================================================");

      const requestBody = {
        model: chatModel.trim(),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: detectedTranscript },
        ],
        max_tokens: 350,
        temperature: 0.2,
        reasoning_effort: null,
      };

      console.log("💬 [LiveNudge] Outgoing Chat Payload:", JSON.stringify(requestBody, null, 2));

      const chatRes = await fetch(chatUrl.trim(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-subscription-key": key,
        },
        body: JSON.stringify(requestBody),
      });

      console.log("📥 [LiveNudge] SARVAM CHAT STATUS:", chatRes.status);
      const rawText = await chatRes.text();

      if (!chatRes.ok) {
        throw new Error(`Chat API returned HTTP ${chatRes.status}: ${rawText}`);
      }

      const chatJson = JSON.parse(rawText);

      // Never inspect, display, or store reasoning_content or hidden chain-of-thought
      const rawContent = chatJson.choices?.[0]?.message?.content?.trim() || "";

      console.log("📦 [LiveNudge] RAW MODEL CONTENT:", rawContent);

      if (!rawContent) {
        throw new Error("Empty content received from Sarvam chat completion.");
      }

      // Extract JSON substring (stripping any accidental code fences)
      let parsedObj;
      try {
        const jsonStr = extractJson(rawContent);
        parsedObj = JSON.parse(jsonStr);
      } catch (parseErr) {
        throw new Error(
          `Failed to parse model output as JSON: ${parseErr.message}. Output was: "${rawContent}"`
        );
      }

      // Strictly validate result against LiveNudge contract
      const validatedResult = validateLiveNudgeResult(parsedObj);

      console.log("\n========================================================");
      console.log("💡 [LiveNudge] VALIDATED COACHING CONTRACT RESULT:");
      console.log(JSON.stringify(validatedResult, null, 2));
      console.log("========================================================\n");

      setCoachingResult(validatedResult);
      setPhase("done");
    } catch (err) {
      console.error("❌ [LiveNudge] Chat API / Validation Failure:", err);
      setErrorMsg("Coaching Error: " + (err.message || String(err)));
      setCoachingResult(null);
      setPhase("error");
    }
  }

  // ── Helper Labels ─────────────────────────────────────────────────────────
  const statusBadge = {
    idle: { label: "Ready to Record", color: "#616161", bg: "#f5f5f5" },
    recording: {
      label: `Recording (${recordingDuration}s)… Tap End to analyze`,
      color: "#d32f2f",
      bg: "#ffebee",
    },
    transcribing: {
      label: "Step 1/2: Sarvam STT converting speech to text…",
      color: "#f57c00",
      bg: "#fff3e0",
    },
    reasoning: {
      label: "Step 2/2: Sarvam 105b generating coaching nudge…",
      color: "#1976d2",
      bg: "#e3f2fd",
    },
    done: { label: "Completed: Live coaching nudge ready", color: "#388e3c", bg: "#e8f5e9" },
    error: { label: "Error encountered", color: "#d32f2f", bg: "#ffebee" },
  }[phase];

  const isLoading = phase === "transcribing" || phase === "reasoning";

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── App Header ─────────────────────────────────────────────── */}
            <View style={styles.header}>
              <Text style={styles.appTitle}>LiveNudge</Text>
              <Text style={styles.appSubtitle}>Real-time AI Communication Coach</Text>
            </View>

            {/* ── Status Banner ──────────────────────────────────────────── */}
            <View style={[styles.statusBanner, { backgroundColor: statusBadge.bg }]}>
              <Text style={[styles.statusBannerText, { color: statusBadge.color }]}>
                {statusBadge.label}
              </Text>
            </View>

            {/* ── Settings Accordion / Separate Config Areas ─────────────── */}
            <View style={styles.configCard}>
              <TouchableOpacity
                style={styles.configHeader}
                onPress={() => setShowConfig(!showConfig)}
                activeOpacity={0.7}
              >
                <Text style={styles.configHeaderTitle}>
                  ⚙️ Sarvam API Configuration {showConfig ? "▲" : "▼"}
                </Text>
                <Text style={styles.configHeaderSubtitle}>
                  {showConfig ? "Hide URLs & Models" : "Edit STT / Chat URLs & Models"}
                </Text>
              </TouchableOpacity>

              {showConfig && (
                <View style={styles.configBody}>
                  {/* API Key Area */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Sarvam API Key (Subscription Key):</Text>
                    <TextInput
                      style={styles.textInput}
                      value={apiKey}
                      onChangeText={setApiKey}
                      placeholder="Enter Sarvam API Key"
                      placeholderTextColor="#999"
                      secureTextEntry={false}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <Text style={styles.inputHint}>
                      Loaded from .env by default. Editable here anytime.
                    </Text>
                  </View>

                  {/* STT URL Area */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>STT Endpoint URL:</Text>
                    <TextInput
                      style={styles.textInput}
                      value={sttUrl}
                      onChangeText={setSttUrl}
                      placeholder="https://api.sarvam.ai/speech-to-text"
                      placeholderTextColor="#999"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>

                  {/* STT Model Area */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>STT Model:</Text>
                    <TextInput
                      style={styles.textInput}
                      value={sttModel}
                      onChangeText={setSttModel}
                      placeholder="saaras:v3"
                      placeholderTextColor="#999"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>

                  {/* Chat URL Area */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Chat Completions URL:</Text>
                    <TextInput
                      style={styles.textInput}
                      value={chatUrl}
                      onChangeText={setChatUrl}
                      placeholder="https://api.sarvam.ai/v1/chat/completions"
                      placeholderTextColor="#999"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>

                  {/* Chat Model Area */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Chat Model:</Text>
                    <TextInput
                      style={styles.textInput}
                      value={chatModel}
                      onChangeText={setChatModel}
                      placeholder="sarvam-105b-conversations"
                      placeholderTextColor="#999"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                </View>
              )}
            </View>

            {/* ── Error Banner ───────────────────────────────────────────── */}
            {errorMsg !== "" && (
              <View style={styles.errorCard}>
                <Text style={styles.errorTitle}>⚠️ Issue Occurred</Text>
                <Text style={styles.errorBody}>{errorMsg}</Text>
              </View>
            )}

            {/* ── Loading Spinner ────────────────────────────────────────── */}
            {isLoading && (
              <View style={styles.loadingCard}>
                <ActivityIndicator size="large" color="#1976d2" />
                <Text style={styles.loadingText}>
                  {phase === "transcribing"
                    ? "Transcribing voice with Sarvam STT..."
                    : "Sarvam 105b reasoning & synthesizing nudge..."}
                </Text>
              </View>
            )}

            {/* ── Speech-to-Text Transcript Display Area ─────────────────── */}
            {transcript !== "" && (
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardSectionBadge}>SPEECH TRANSCRIPT</Text>
                  <Text style={styles.cardModelTag}>Model: {sttModel}</Text>
                </View>
                <Text style={styles.transcriptText}>{transcript}</Text>
              </View>
            )}

            {/* ── Chat Transcript & Coaching Nudge Display Area ──────────── */}
            {(transcript !== "" || coachingResult !== null) && (
              <View style={[styles.card, styles.chatCard]}>
                <View style={styles.cardHeaderRow}>
                  <Text style={[styles.cardSectionBadge, styles.chatBadge]}>
                    CHAT CONVERSATION LOG
                  </Text>
                  <Text style={styles.cardModelTag}>Model: {chatModel}</Text>
                </View>

                {/* User Prompt Message */}
                <View style={styles.chatBubbleUser}>
                  <Text style={styles.chatBubbleSender}>👤 Spoken Input (User):</Text>
                  <Text style={styles.chatBubbleText}>{transcript}</Text>
                </View>

                {/* Coach Response Message */}
                {coachingResult !== null ? (
                  <View style={styles.chatBubbleCoach}>
                    <View style={styles.coachHeaderRow}>
                      <Text style={styles.chatBubbleCoachSender}>💡 LiveNudge Coaching Result</Text>
                      <View style={styles.modeBadge}>
                        <Text style={styles.modeBadgeText}>
                          {coachingResult.mode.toUpperCase()}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.chatBubbleCoachText}>{coachingResult.nudge}</Text>

                    {coachingResult.suggestedAction !== "" && (
                      <View style={styles.actionBox}>
                        <Text style={styles.actionLabel}>🎯 Suggested Action:</Text>
                        <Text style={styles.actionText}>{coachingResult.suggestedAction}</Text>
                      </View>
                    )}

                    {coachingResult.signals && coachingResult.signals.length > 0 && (
                      <View style={styles.signalsContainer}>
                        <Text style={styles.signalsLabel}>🔍 Observable Signals:</Text>
                        <View style={styles.signalTagsRow}>
                          {coachingResult.signals.map((sig, idx) => (
                            <View key={idx} style={styles.signalTag}>
                              <Text style={styles.signalTagText}>{sig}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}
                  </View>
                ) : (
                  isLoading && (
                    <View style={styles.chatBubblePending}>
                      <Text style={styles.chatBubblePendingText}>
                        ⏳ Waiting for Sarvam 105b response...
                      </Text>
                    </View>
                  )
                )}
              </View>
            )}

            {/* ── Action Buttons ─────────────────────────────────────────── */}
            <View style={styles.actionContainer}>
              {phase === "idle" && (
                <TouchableOpacity
                  style={[styles.primaryButton, styles.recordButton]}
                  onPress={startRecording}
                  activeOpacity={0.8}
                >
                  <Text style={styles.primaryButtonText}>🎙️ Tap to Record</Text>
                </TouchableOpacity>
              )}

              {phase === "recording" && (
                <TouchableOpacity
                  style={[styles.primaryButton, styles.stopButton]}
                  onPress={stopRecording}
                  activeOpacity={0.8}
                >
                  <Text style={styles.primaryButtonText}>
                    ⏹️ Tap to End Recording ({recordingDuration}s)
                  </Text>
                </TouchableOpacity>
              )}

              {(phase === "done" || phase === "error") && (
                <TouchableOpacity
                  style={[styles.primaryButton, styles.resetButton]}
                  onPress={handleReset}
                  activeOpacity={0.8}
                >
                  <Text style={styles.primaryButtonText}>↺ Record Another Nudge</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f7f9fa",
  },
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },
  header: {
    alignItems: "center",
    marginBottom: 12,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 2,
  },
  statusBanner: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 14,
    alignItems: "center",
  },
  statusBannerText: {
    fontSize: 13,
    fontWeight: "600",
  },
  configCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginBottom: 14,
    overflow: "hidden",
  },
  configHeader: {
    padding: 12,
    backgroundColor: "#f9fafb",
  },
  configHeaderTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1f2937",
  },
  configHeaderSubtitle: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  configBody: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 4,
  },
  textInput: {
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: "#111827",
  },
  inputHint: {
    fontSize: 11,
    color: "#9ca3af",
    marginTop: 3,
  },
  errorCard: {
    backgroundColor: "#fef2f2",
    borderColor: "#f87171",
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
  },
  errorTitle: {
    color: "#991b1b",
    fontWeight: "700",
    fontSize: 14,
    marginBottom: 4,
  },
  errorBody: {
    color: "#b91c1c",
    fontSize: 13,
    lineHeight: 18,
  },
  loadingCard: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    padding: 20,
    alignItems: "center",
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  loadingText: {
    fontSize: 13,
    color: "#4b5563",
    marginTop: 10,
    fontWeight: "500",
    textAlign: "center",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  cardSectionBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: "#4b5563",
    letterSpacing: 0.5,
  },
  cardModelTag: {
    fontSize: 11,
    color: "#9ca3af",
    fontWeight: "500",
  },
  transcriptText: {
    fontSize: 15,
    color: "#1f2937",
    lineHeight: 22,
  },
  chatCard: {
    borderColor: "#bbf7d0",
    backgroundColor: "#fcfdfc",
  },
  chatBadge: {
    color: "#166534",
  },
  chatBubbleUser: {
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  chatBubbleSender: {
    fontSize: 11,
    fontWeight: "700",
    color: "#4b5563",
    marginBottom: 3,
  },
  chatBubbleText: {
    fontSize: 14,
    color: "#1f2937",
    lineHeight: 20,
  },
  chatBubbleCoach: {
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#a7f3d0",
    borderRadius: 8,
    padding: 12,
  },
  chatBubbleCoachSender: {
    fontSize: 12,
    fontWeight: "700",
    color: "#065f46",
    marginBottom: 4,
  },
  chatBubbleCoachText: {
    fontSize: 15,
    color: "#064e3b",
    lineHeight: 22,
    fontWeight: "500",
  },
  coachHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  modeBadge: {
    backgroundColor: "#d1fae5",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#6ee7b7",
  },
  modeBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#065f46",
    letterSpacing: 0.5,
  },
  actionBox: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#a7f3d0",
  },
  actionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#047857",
    marginBottom: 2,
  },
  actionText: {
    fontSize: 13,
    color: "#065f46",
    lineHeight: 18,
  },
  signalsContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#a7f3d0",
  },
  signalsLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#047857",
    marginBottom: 4,
  },
  signalTagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  signalTag: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#a7f3d0",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  signalTagText: {
    fontSize: 11,
    color: "#065f46",
  },
  chatBubblePending: {
    padding: 10,
    alignItems: "center",
  },
  chatBubblePendingText: {
    fontSize: 12,
    color: "#6b7280",
    fontStyle: "italic",
  },
  actionContainer: {
    marginTop: 10,
    alignItems: "center",
  },
  primaryButton: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  recordButton: {
    backgroundColor: "#111827",
  },
  stopButton: {
    backgroundColor: "#dc2626",
  },
  resetButton: {
    backgroundColor: "#2563eb",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
});
