import React, { useState, useEffect, useRef } from "react";
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
import { Ionicons, Feather } from "@expo/vector-icons";
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
import { saveSession, getRecentSessions } from "./sessionStorage";
import { generateSessionInsights } from "./sessionInsights";

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
  // activeStep for completed session navigation: "result" | "insights" | "complete"
  const [activeStep, setActiveStep] = useState("result");

  const [transcript, setTranscript] = useState("");
  const [coachingResult, setCoachingResult] = useState(null);
  const [sessionInsights, setSessionInsights] = useState(null);
  const [recentSessions, setRecentSessions] = useState([]);
  const [showTranscript, setShowTranscript] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [permGranted, setPermGranted] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);

  // ── Session Metadata Tracking ─────────────────────────────────────────────
  const sessionStartedAtRef = useRef(null);
  const sessionEndedAtRef = useRef(null);
  const sessionDurationRef = useRef(0);

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

  // ── Load Recent Sessions for Home Screen ──────────────────────────────────
  useEffect(() => {
    getRecentSessions(3)
      .then((sessions) => {
        if (Array.isArray(sessions)) {
          setRecentSessions(sessions);
        }
      })
      .catch(() => {});
  }, [phase]);

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

  // ── Reset to Home ─────────────────────────────────────────────────────────
  function handleReset() {
    console.log("↺ [LiveNudge] Resetting session state to Home.");
    setPhase("idle");
    setActiveStep("result");
    setTranscript("");
    setCoachingResult(null);
    setSessionInsights(null);
    setShowTranscript(false);
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
      sessionStartedAtRef.current = new Date().toISOString();
      sessionEndedAtRef.current = null;
      sessionDurationRef.current = 0;
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
      sessionEndedAtRef.current = new Date().toISOString();
      sessionDurationRef.current = recordingDuration;
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
      const err = "Sarvam API Key is missing. Enter your key in .env or the API Configuration panel.";
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
        throw new Error(`STT API returned HTTP ${uploadResult.status}: ${uploadResult.body}`);
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

      let parsedObj;
      try {
        const jsonStr = extractJson(rawContent);
        parsedObj = JSON.parse(jsonStr);
      } catch (parseErr) {
        throw new Error(
          `Failed to parse model output as JSON: ${parseErr.message}. Output was: "${rawContent}"`
        );
      }

      const validatedResult = validateLiveNudgeResult(parsedObj);

      console.log("\n========================================================");
      console.log("💡 [LiveNudge] VALIDATED COACHING CONTRACT RESULT:");
      console.log(JSON.stringify(validatedResult, null, 2));
      console.log("========================================================\n");

      setCoachingResult(validatedResult);

      const completedSessionData = {
        startedAt: sessionStartedAtRef.current || new Date().toISOString(),
        endedAt: sessionEndedAtRef.current || new Date().toISOString(),
        duration: sessionDurationRef.current || recordingDuration || 0,
        transcript: detectedTranscript,
        nudge: validatedResult.nudge,
        mode: validatedResult.mode,
        signals: validatedResult.signals,
        suggestedAction: validatedResult.suggestedAction,
      };

      // ── Generate Deterministic Session Insights (Score & Graph) ───────────
      let insightsData = null;
      try {
        insightsData = generateSessionInsights(completedSessionData);
        setSessionInsights(insightsData);

        console.log("\n========================================================");
        console.log(
          `📈 [LiveNudge] DETERMINISTIC SESSION SCORE: ${insightsData.score}/100 (${insightsData.scoreLabel})`
        );
        console.log("📊 Score Factors:", JSON.stringify(insightsData.scoreFactors, null, 2));
        console.log(
          `🕸️ [LiveNudge] GRAPH DATA: ${insightsData.graph.nodes.length} nodes, ${insightsData.graph.relationships.length} relationships`
        );
        console.log("========================================================\n");
      } catch (insightErr) {
        console.error("❌ [LiveNudge] Session insights computation failed:", insightErr);
      }

      // ── Persist Completed Session Locally ──────────────────────────────────
      saveSession(completedSessionData).catch((storageErr) => {
        console.error("❌ [LiveNudge] Session persistence failed (in-memory flow preserved):", storageErr);
      });

      // Transition to Result Screen
      setActiveStep("result");
      setPhase("done");
    } catch (err) {
      console.error("❌ [LiveNudge] Chat API / Validation Failure:", err);
      setErrorMsg("Coaching Error: " + (err.message || String(err)));
      setCoachingResult(null);
      setPhase("error");
    }
  }

  // ── Helper: Format MM:SS ──────────────────────────────────────────────────
  function formatSeconds(secs) {
    const s = typeof secs === "number" && secs >= 0 ? secs : 0;
    const mins = Math.floor(s / 60);
    const remainder = s % 60;
    return `${String(mins).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  // ── Helper: Mode Color ────────────────────────────────────────────────────
  function getModeColor(modeName) {
    const key = (modeName || "").toLowerCase();
    const colors = {
      clarity: "#38bdf8",
      confidence: "#a855f7",
      empathy: "#ec4899",
      listening: "#3b82f6",
      tone: "#f59e0b",
      concise_response: "#10b981",
    };
    return colors[key] || "#38bdf8";
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER SECTIONS
  // ──────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
        <StatusBar style="light" />
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* ── TOP NAV BAR ───────────────────────────────────────────────── */}
          <View style={styles.topNav}>
            <View>
              <Text style={styles.brandTitle}>
                <Text style={styles.brandTitleWhite}>Live </Text>
                <Text style={styles.brandTitleBlue}>Nudge</Text>
              </Text>
              <Text style={styles.brandSubtitleTracked}>
                BETTER CONVERSATIONS{"\n"}A BRIGHTER YOU
              </Text>
            </View>

            {/* Settings Gear Toggle */}
            <TouchableOpacity
              style={styles.settingsIconBtn}
              onPress={() => setShowConfig(!showConfig)}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="settings-outline" size={24} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          {/* ── ERROR STATE (Anti-Happy Path) ────────────────────────────── */}
          {errorMsg !== "" && (
            <View style={styles.errorBanner}>
              <View style={styles.errorContent}>
                <Text style={styles.errorTitle}>Action Needed</Text>
                <Text style={styles.errorBody}>{errorMsg}</Text>
              </View>
              <TouchableOpacity
                style={styles.errorDismissBtn}
                onPress={handleReset}
                activeOpacity={0.7}
              >
                <Text style={styles.errorDismissText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── CONFIGURATION MODAL / PANEL ───────────────────────────────── */}
          {showConfig && (
            <View style={styles.configModalOverlay}>
              <View style={styles.configModalCard}>
                <View style={styles.configModalHeader}>
                  <Text style={styles.configModalTitle}>API Configuration</Text>
                  <TouchableOpacity onPress={() => setShowConfig(false)}>
                    <Text style={styles.configModalClose}>✕</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.configModalScroll}>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Sarvam API Key:</Text>
                    <TextInput
                      style={styles.textInput}
                      value={apiKey}
                      onChangeText={setApiKey}
                      placeholder="Enter API Key"
                      placeholderTextColor="#64748b"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>STT Endpoint:</Text>
                    <TextInput
                      style={styles.textInput}
                      value={sttUrl}
                      onChangeText={setSttUrl}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>STT Model:</Text>
                    <TextInput
                      style={styles.textInput}
                      value={sttModel}
                      onChangeText={setSttModel}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Chat Completions Endpoint:</Text>
                    <TextInput
                      style={styles.textInput}
                      value={chatUrl}
                      onChangeText={setChatUrl}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Chat Model:</Text>
                    <TextInput
                      style={styles.textInput}
                      value={chatModel}
                      onChangeText={setChatModel}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                </ScrollView>
              </View>
            </View>
          )}

          {/* ──────────────────────────────────────────────────────────────────
              VIEW 1: HOME SCREEN (Idle Phase)
             ────────────────────────────────────────────────────────────────── */}
          {phase === "idle" && (
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.homeContainer}
              showsVerticalScrollIndicator={false}
            >
              {/* Hero Headline */}
              <View style={styles.homeHeroSection}>
                <Text style={styles.heroMainTitle}>
                  <Text style={styles.heroWhiteText}>Have better{"\n"}</Text>
                  <Text style={styles.heroBlueText}>conversations</Text>
                </Text>
                <Text style={styles.heroDescription}>
                  LiveNudge listens to your conversation and gives real-time nudges to help you communicate better.
                </Text>
              </View>

              {/* Three Value Pillars */}
              <View style={styles.pillarsRow}>
                <View style={styles.pillarItem}>
                  <Ionicons name="chatbubble-ellipses-outline" size={26} color="#9CA3AF" />
                  <Text style={styles.pillarLabel}>Be more{"\n"}confident</Text>
                </View>
                <View style={styles.pillarItem}>
                  <Ionicons name="person-circle-outline" size={28} color="#9CA3AF" />
                  <Text style={styles.pillarLabel}>Speak{"\n"}more clearly</Text>
                </View>
                <View style={styles.pillarItem}>
                  <Feather name="bar-chart-2" size={26} color="#9CA3AF" />
                  <Text style={styles.pillarLabel}>Build stronger{"\n"}connections</Text>
                </View>
              </View>

              {/* Primary CTA Button */}
              <View style={styles.ctaWrapper}>
                <TouchableOpacity
                  style={styles.startConversationBtn}
                  onPress={startRecording}
                  activeOpacity={0.85}
                >
                  <Feather name="mic" size={22} color="#FFFFFF" style={styles.btnMicIcon} />
                  <Text style={styles.startConversationBtnText}>Start Conversation</Text>
                  <Feather name="chevron-right" size={22} color="#FFFFFF" style={styles.btnChevronIcon} />
                </TouchableOpacity>

                {/* Privacy / Security Notice */}
                <View style={styles.securityRow}>
                  <Feather name="lock" size={16} color="#8F97A4" style={styles.lockIcon} />
                  <Text style={styles.securityText}>
                    Your conversation is processed securely{"\n"}for this session only. Nothing is stored.
                  </Text>
                </View>
              </View>

              {/* Bottom Quote */}
              <View style={styles.bottomQuoteContainer}>
                <Text style={styles.bottomQuoteText}>
                  “Better conversations{"\n"}create a brighter you.”
                </Text>
              </View>
            </ScrollView>
          )}

          {/* ──────────────────────────────────────────────────────────────────
              VIEW 2: RECORDING SCREEN
             ────────────────────────────────────────────────────────────────── */}
          {phase === "recording" && (
            <View style={styles.recordingContainer}>
              <View style={styles.recordingHeader}>
                <View style={styles.recordingPill}>
                  <View style={styles.recordingPillDot} />
                  <Text style={styles.recordingPillText}>RECORDING ACTIVE</Text>
                </View>
              </View>

              {/* Large Timer Display */}
              <View style={styles.timerBlock}>
                <Text style={styles.timerText}>{formatSeconds(recordingDuration)}</Text>
                <Text style={styles.timerSubtext}>Microphone listening</Text>
              </View>

              {/* Conversation Area */}
              <View style={styles.listeningCard}>
                <Text style={styles.listeningCardTitle}>CONVERSATION IN PROGRESS</Text>
                <Text style={styles.listeningCardBody}>
                  Speak naturally. LiveNudge is capturing your delivery to evaluate clarity, pace,
                  and conversational structure.
                </Text>
                <View style={styles.audioActiveRow}>
                  <View style={styles.pulseBar} />
                  <View style={[styles.pulseBar, { height: 20 }]} />
                  <View style={[styles.pulseBar, { height: 14 }]} />
                  <View style={[styles.pulseBar, { height: 26 }]} />
                  <View style={[styles.pulseBar, { height: 16 }]} />
                  <Text style={styles.audioActiveText}>Audio stream buffering...</Text>
                </View>
              </View>

              {/* Bottom End Action */}
              <View style={styles.bottomActionArea}>
                <TouchableOpacity
                  style={[styles.primaryActionBtn, styles.endRecordingBtn]}
                  onPress={stopRecording}
                  activeOpacity={0.8}
                >
                  <Text style={styles.primaryActionBtnText}>End Conversation</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ──────────────────────────────────────────────────────────────────
              VIEW 3: PROCESSING SCREEN
             ────────────────────────────────────────────────────────────────── */}
          {(phase === "transcribing" || phase === "reasoning") && (
            <View style={styles.processingContainer}>
              <View style={styles.processingCard}>
                <ActivityIndicator size="large" color="#38bdf8" style={styles.processingSpinner} />

                <Text style={styles.processingTitle}>
                  {phase === "transcribing"
                    ? "Transcribing"
                    : "Analyzing conversation"}
                </Text>

                <Text style={styles.processingSubhead}>
                  {phase === "transcribing"
                    ? "Converting audio into accurate text via Sarvam STT..."
                    : "Synthesizing real-time coaching feedback via Sarvam 105B..."}
                </Text>

                {/* Pipeline Step Tracker (Real data, no fake percentages) */}
                <View style={styles.pipelineSteps}>
                  <View style={styles.stepItem}>
                    <View
                      style={[
                        styles.stepBullet,
                        phase === "transcribing"
                          ? styles.stepBulletActive
                          : styles.stepBulletDone,
                      ]}
                    />
                    <Text
                      style={[
                        styles.stepLabel,
                        phase === "transcribing" && styles.stepLabelActive,
                      ]}
                    >
                      Transcribing
                    </Text>
                  </View>

                  <View style={styles.stepItem}>
                    <View
                      style={[
                        styles.stepBullet,
                        phase === "reasoning"
                          ? styles.stepBulletActive
                          : styles.stepBulletPending,
                      ]}
                    />
                    <Text
                      style={[
                        styles.stepLabel,
                        phase === "reasoning" && styles.stepLabelActive,
                      ]}
                    >
                      Analyzing conversation
                    </Text>
                  </View>

                  <View style={styles.stepItem}>
                    <View style={[styles.stepBullet, styles.stepBulletPending]} />
                    <Text style={styles.stepLabel}>Preparing your nudge</Text>
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* ──────────────────────────────────────────────────────────────────
              VIEW 4, 5, 6: COMPLETED PHASES (RESULT, INSIGHTS, COMPLETE)
             ────────────────────────────────────────────────────────────────── */}
          {phase === "done" && coachingResult && (
            <View style={styles.completedFlowWrapper}>
              {/* Step Navigation Tabs */}
              <View style={styles.flowTabsRow}>
                <TouchableOpacity
                  style={[
                    styles.flowTabItem,
                    activeStep === "result" && styles.flowTabItemActive,
                  ]}
                  onPress={() => setActiveStep("result")}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.flowTabText,
                      activeStep === "result" && styles.flowTabTextActive,
                    ]}
                  >
                    1. Nudge
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.flowTabItem,
                    activeStep === "insights" && styles.flowTabItemActive,
                  ]}
                  onPress={() => setActiveStep("insights")}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.flowTabText,
                      activeStep === "insights" && styles.flowTabTextActive,
                    ]}
                  >
                    2. Insights & Graph
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.flowTabItem,
                    activeStep === "complete" && styles.flowTabItemActive,
                  ]}
                  onPress={() => setActiveStep("complete")}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.flowTabText,
                      activeStep === "complete" && styles.flowTabTextActive,
                    ]}
                  >
                    3. Finish
                  </Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.scrollArea} contentContainerStyle={styles.flowContentContainer}>
                {/* ── STEP 1: RESULT SCREEN ──────────────────────────────── */}
                {activeStep === "result" && (
                  <View style={styles.stepContainer}>
                    {/* Header with Mode */}
                    <View style={styles.resultHeaderRow}>
                      <Text style={styles.sectionHeaderTitle}>Coaching Result</Text>
                      <View
                        style={[
                          styles.modeTagPill,
                          { borderColor: getModeColor(coachingResult.mode) },
                        ]}
                      >
                        <Text
                          style={[
                            styles.modeTagPillText,
                            { color: getModeColor(coachingResult.mode) },
                          ]}
                        >
                          {coachingResult.mode.toUpperCase()}
                        </Text>
                      </View>
                    </View>

                    {/* Primary Hero Nudge Card */}
                    <View style={styles.nudgeHeroCard}>
                      <Text style={styles.nudgeCardLabel}>PRIMARY NUDGE</Text>
                      <Text style={styles.nudgeHeroText}>{coachingResult.nudge}</Text>
                    </View>

                    {/* Suggested Action Card */}
                    {coachingResult.suggestedAction !== "" && (
                      <View style={styles.actionCard}>
                        <Text style={styles.actionCardLabel}>SUGGESTED ACTION</Text>
                        <Text style={styles.actionCardBody}>{coachingResult.suggestedAction}</Text>
                      </View>
                    )}

                    {/* Observable Signals Card */}
                    <View style={styles.signalsCard}>
                      <Text style={styles.signalsCardLabel}>OBSERVED CONVERSATIONAL SIGNALS</Text>
                      {coachingResult.signals && coachingResult.signals.length > 0 ? (
                        <View style={styles.signalsListRow}>
                          {coachingResult.signals.map((sig, idx) => (
                            <View key={idx} style={styles.signalBadge}>
                              <Text style={styles.signalBadgeText}>{sig}</Text>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.emptySignalsText}>
                          Clean delivery. No conversational friction signals observed.
                        </Text>
                      )}
                    </View>

                    {/* Spoken Transcript Accordion */}
                    <View style={styles.transcriptCard}>
                      <TouchableOpacity
                        style={styles.transcriptToggleRow}
                        onPress={() => setShowTranscript(!showTranscript)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.transcriptToggleLabel}>
                          {showTranscript ? "Hide Spoken Transcript ▲" : "View Spoken Transcript ▼"}
                        </Text>
                        <Text style={styles.transcriptMetaText}>
                          {transcript.split(/\s+/).filter(Boolean).length} words
                        </Text>
                      </TouchableOpacity>

                      {showTranscript && (
                        <ScrollView style={styles.transcriptScroll} nestedScrollEnabled={true}>
                          <Text style={styles.transcriptBodyText}>{transcript}</Text>
                        </ScrollView>
                      )}
                    </View>

                    {/* Navigation Buttons */}
                    <View style={styles.bottomActionArea}>
                      <TouchableOpacity
                        style={[styles.primaryActionBtn, styles.nextBtn]}
                        onPress={() => setActiveStep("insights")}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.primaryActionBtnText}>View Session Insights →</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* ── STEP 2: INSIGHTS SCREEN (Score + Graph + Summary) ─────────── */}
                {activeStep === "insights" && sessionInsights && (
                  <View style={styles.stepContainer}>
                    <View style={styles.insightsHeader}>
                      <Text style={styles.sectionHeaderTitle}>Session Insights</Text>
                      <Text style={styles.sectionHeaderSub}>
                        Deterministic evaluation derived from real conversation data
                      </Text>
                    </View>

                    {/* Concise Session Summary Card */}
                    <View style={styles.sessionSummaryCard}>
                      <Text style={styles.sessionSummaryHeader}>CONCISE SESSION SUMMARY</Text>
                      <View style={styles.summaryStatsRow}>
                        <View style={styles.summaryStatBox}>
                          <Text style={styles.summaryStatLabel}>DURATION</Text>
                          <Text style={styles.summaryStatVal}>
                            {sessionDurationRef.current || recordingDuration}s
                          </Text>
                        </View>
                        <View style={styles.summaryStatBox}>
                          <Text style={styles.summaryStatLabel}>WORDS SPOKEN</Text>
                          <Text style={styles.summaryStatVal}>
                            {transcript.split(/\s+/).filter(Boolean).length}
                          </Text>
                        </View>
                        <View style={styles.summaryStatBox}>
                          <Text style={styles.summaryStatLabel}>COACHING MODE</Text>
                          <Text
                            style={[
                              styles.summaryStatVal,
                              { color: getModeColor(coachingResult.mode) },
                            ]}
                          >
                            {coachingResult.mode.toUpperCase()}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.sessionSummaryNote}>
                        {coachingResult.signals && coachingResult.signals.length > 0
                          ? `Friction signals detected: ${coachingResult.signals.join(", ")}. Immediate focus: ${coachingResult.suggestedAction || coachingResult.nudge}`
                          : `Clean conversational delivery. Aligned with ${coachingResult.mode} objectives without observed disfluencies.`}
                      </Text>
                    </View>

                    {/* Score Card */}
                    <View style={styles.scoreHeroCard}>
                      <View style={styles.scoreNumberCol}>
                        <Text style={styles.scoreBigNumber}>{sessionInsights.score}</Text>
                        <Text style={styles.scoreTotalDenominator}>/100</Text>
                      </View>
                      <View style={styles.scoreMetaCol}>
                        <View style={styles.scoreLabelPill}>
                          <Text style={styles.scoreLabelPillText}>
                            {sessionInsights.scoreLabel}
                          </Text>
                        </View>
                        <Text style={styles.scoreSummaryDesc}>
                          {sessionInsights.score >= 80
                            ? "High conversational efficacy and fluency."
                            : sessionInsights.score >= 60
                            ? "Solid clarity with addressable friction."
                            : "Noticeable disfluencies or pace variance."}
                        </Text>
                      </View>
                    </View>

                    {/* Score Factors Breakdown */}
                    <View style={styles.factorsCard}>
                      <Text style={styles.factorsCardHeader}>DETERMINISTIC SCORE FACTORS</Text>
                      {sessionInsights.scoreFactors.map((item, idx) => (
                        <View key={idx} style={styles.factorRow}>
                          <View style={styles.factorLeft}>
                            <Text style={styles.factorTitle}>{item.factor}</Text>
                            <Text style={styles.factorDesc}>{item.description}</Text>
                          </View>
                          <View
                            style={[
                              styles.factorImpactBadge,
                              item.impact < 0 ? styles.impactNegative : styles.impactNeutral,
                            ]}
                          >
                            <Text
                              style={[
                                styles.factorImpactText,
                                item.impact < 0
                                  ? styles.impactTextNegative
                                  : styles.impactTextNeutral,
                              ]}
                            >
                              {item.impact === 0 ? "Optimal" : `${item.impact} pts`}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>

                    {/* Conversation Graph Card */}
                    <View style={styles.graphCard}>
                      <View style={styles.graphCardHeader}>
                        <View>
                          <Text style={styles.graphTitle}>Conversation Graph</Text>
                          <Text style={styles.graphSubtitle}>
                            {sessionInsights.graph.nodes.length} Nodes •{" "}
                            {sessionInsights.graph.relationships.length} Relationships
                          </Text>
                        </View>
                      </View>

                      {/* Graph Nodes */}
                      <Text style={styles.graphSubheading}>CONVERSATION ENTITIES</Text>
                      <View style={styles.graphNodesGrid}>
                        {sessionInsights.graph.nodes.map((node) => (
                          <View key={node.id} style={styles.graphNodeChip}>
                            <Text style={styles.graphNodeType}>{node.type.toUpperCase()}</Text>
                            <Text style={styles.graphNodeLabel} numberOfLines={1}>
                              {node.label}
                            </Text>
                          </View>
                        ))}
                      </View>

                      {/* Graph Relationships */}
                      <Text style={[styles.graphSubheading, { marginTop: 16 }]}>
                        SEMANTIC RELATIONSHIPS
                      </Text>
                      <ScrollView style={styles.graphRelsScroll} nestedScrollEnabled={true}>
                        {sessionInsights.graph.relationships.map((rel) => (
                          <View key={rel.id} style={styles.graphRelRow}>
                            <Text style={styles.graphRelSource} numberOfLines={1}>
                              {rel.source.replace("node_", "")}
                            </Text>
                            <View style={styles.graphRelArrowBadge}>
                              <Text style={styles.graphRelType}>--[{rel.type}]--&gt;</Text>
                            </View>
                            <Text style={styles.graphRelTarget} numberOfLines={1}>
                              {rel.target.replace("node_", "")}
                            </Text>
                          </View>
                        ))}
                      </ScrollView>
                    </View>

                    {/* Navigation Buttons */}
                    <View style={styles.bottomActionArea}>
                      <TouchableOpacity
                        style={[styles.primaryActionBtn, styles.nextBtn]}
                        onPress={() => setActiveStep("complete")}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.primaryActionBtnText}>Next: Complete Session →</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.secondaryTextBtn}
                        onPress={() => setActiveStep("result")}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.secondaryTextBtnLabel}>← Back to Nudge</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* ── STEP 3: COMPLETE SCREEN ────────────────────────────── */}
                {activeStep === "complete" && (
                  <View style={styles.stepContainer}>
                    <View style={styles.completeHeader}>
                      <View style={styles.completeCheckmarkBadge}>
                        <Text style={styles.completeCheckmarkText}>✓</Text>
                      </View>
                      <Text style={styles.completeTitle}>Conversation Complete</Text>
                      <Text style={styles.completeSub}>
                        Your speech session has been evaluated, scored, and saved locally.
                      </Text>
                    </View>

                    {/* Summary Card */}
                    <View style={styles.completeSummaryCard}>
                      <View style={styles.summaryMetaGrid}>
                        <View style={styles.summaryMetaItem}>
                          <Text style={styles.summaryMetaLabel}>SCORE</Text>
                          <Text style={styles.summaryMetaVal}>
                            {sessionInsights?.score ?? "—"}/100
                          </Text>
                        </View>
                        <View style={styles.summaryMetaItem}>
                          <Text style={styles.summaryMetaLabel}>MODE</Text>
                          <Text
                            style={[
                              styles.summaryMetaVal,
                              { color: getModeColor(coachingResult.mode) },
                            ]}
                          >
                            {coachingResult.mode.toUpperCase()}
                          </Text>
                        </View>
                        <View style={styles.summaryMetaItem}>
                          <Text style={styles.summaryMetaLabel}>DURATION</Text>
                          <Text style={styles.summaryMetaVal}>
                            {sessionDurationRef.current || recordingDuration}s
                          </Text>
                        </View>
                      </View>

                      <View style={styles.summaryDivider} />

                      <Text style={styles.summaryNudgeLabel}>KEY TAKEAWAY</Text>
                      <Text style={styles.summaryNudgeText}>{coachingResult.nudge}</Text>
                    </View>

                    {/* Bottom Actions */}
                    <View style={styles.bottomActionArea}>
                      <TouchableOpacity
                        style={[styles.primaryActionBtn, styles.startBtn]}
                        onPress={handleReset}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.primaryActionBtnText}>Start New Conversation</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.secondaryActionBtn}
                        onPress={() => setActiveStep("insights")}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.secondaryActionBtnText}>View Insights</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </ScrollView>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// ─── Design System Styles ───────────────────────────────────────────────────
// Follows strict 4pt/8pt spacing, dark layered surfaces (#0f172a, #1e293b, #334155),
// accessible typography, standard Android touch targets, and natural thumb reach.
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0B0E14",
  },
  container: {
    flex: 1,
    backgroundColor: "#0B0E14",
  },
  scrollArea: {
    flex: 1,
  },

  // ── Top Nav ───────────────────────────────────────────────────────────────
  topNav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
  },
  brandTitle: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  brandTitleWhite: {
    color: "#FFFFFF",
  },
  brandTitleBlue: {
    color: "#3B82F6",
  },
  brandSubtitleTracked: {
    fontSize: 10,
    fontWeight: "700",
    color: "#6B7280",
    letterSpacing: 2.2,
    lineHeight: 14,
    marginTop: 6,
  },
  settingsIconBtn: {
    padding: 6,
    marginTop: 2,
  },

  // ── Error Banner ──────────────────────────────────────────────────────────
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#450a0a",
    borderColor: "#b91c1c",
    borderWidth: 1,
    borderRadius: 10,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
  },
  errorContent: {
    flex: 1,
    marginRight: 10,
  },
  errorTitle: {
    color: "#fca5a5",
    fontSize: 13,
    fontWeight: "700",
  },
  errorBody: {
    color: "#fecaca",
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  errorDismissBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#7f1d1d",
    borderRadius: 6,
  },
  errorDismissText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },

  // ── Config Modal / Overlay ────────────────────────────────────────────────
  configModalOverlay: {
    position: "absolute",
    top: 60,
    left: 16,
    right: 16,
    zIndex: 99,
  },
  configModalCard: {
    backgroundColor: "#1e293b",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#475569",
    padding: 16,
    maxHeight: 400,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  configModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  configModalTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#f8fafc",
  },
  configModalClose: {
    fontSize: 16,
    color: "#94a3b8",
    padding: 4,
  },
  configModalScroll: {
    maxHeight: 320,
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#94a3b8",
    marginBottom: 4,
  },
  textInput: {
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: "#f8fafc",
  },

  // ── VIEW 1: HOME ──────────────────────────────────────────────────────────
  homeContainer: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    flexGrow: 1,
    justifyContent: "space-between",
  },
  homeHeroSection: {
    marginBottom: 24,
  },
  heroMainTitle: {
    fontSize: 42,
    fontWeight: "800",
    lineHeight: 48,
    letterSpacing: -1,
    marginBottom: 16,
  },
  heroWhiteText: {
    color: "#FFFFFF",
  },
  heroBlueText: {
    color: "#3B82F6",
  },
  heroDescription: {
    fontSize: 16,
    color: "#8F97A4",
    lineHeight: 24,
    fontWeight: "400",
  },
  pillarsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginTop: 8,
    marginBottom: 40,
  },
  pillarItem: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 4,
  },
  pillarLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "#C5CBD5",
    textAlign: "center",
    lineHeight: 18,
    marginTop: 10,
  },
  ctaWrapper: {
    width: "100%",
    marginBottom: 20,
  },
  startConversationBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#3B82F6",
    borderRadius: 16,
    height: 60,
    paddingHorizontal: 20,
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  btnMicIcon: {
    marginRight: 14,
  },
  startConversationBtnText: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: -0.2,
  },
  btnChevronIcon: {
    marginLeft: 8,
  },
  securityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    paddingHorizontal: 12,
  },
  lockIcon: {
    marginRight: 10,
  },
  securityText: {
    fontSize: 12.5,
    color: "#7E8695",
    lineHeight: 18,
    textAlign: "left",
    fontWeight: "400",
  },
  bottomQuoteContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    marginTop: 8,
  },
  bottomQuoteText: {
    fontSize: 13.5,
    fontStyle: "italic",
    color: "#4B5563",
    textAlign: "center",
    lineHeight: 20,
    letterSpacing: 0.2,
  },

  // ── VIEW 2: RECORDING ─────────────────────────────────────────────────────
  recordingContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 40,
    justifyContent: "space-between",
  },
  recordingHeader: {
    alignItems: "center",
  },
  recordingPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#450a0a",
    borderColor: "#ef4444",
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  recordingPillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ef4444",
    marginRight: 8,
  },
  recordingPillText: {
    color: "#fca5a5",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  timerBlock: {
    alignItems: "center",
    marginVertical: 24,
  },
  timerText: {
    fontSize: 56,
    fontWeight: "800",
    color: "#f8fafc",
    fontVariant: ["tabular-nums"],
    letterSpacing: 2,
  },
  timerSubtext: {
    fontSize: 13,
    color: "#94a3b8",
    marginTop: 4,
  },
  listeningCard: {
    backgroundColor: "#1e293b",
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: "#334155",
  },
  listeningCardTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: "#38bdf8",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  listeningCardBody: {
    fontSize: 14,
    color: "#cbd5e1",
    lineHeight: 20,
    marginBottom: 16,
  },
  audioActiveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  pulseBar: {
    width: 3,
    height: 12,
    backgroundColor: "#38bdf8",
    borderRadius: 2,
  },
  audioActiveText: {
    fontSize: 12,
    color: "#64748b",
    marginLeft: 8,
  },

  // ── VIEW 3: PROCESSING ────────────────────────────────────────────────────
  processingContainer: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  processingCard: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: "#334155",
    alignItems: "center",
  },
  processingSpinner: {
    marginBottom: 16,
  },
  processingTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#f8fafc",
    marginBottom: 6,
  },
  processingSubhead: {
    fontSize: 13,
    color: "#94a3b8",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 24,
  },
  pipelineSteps: {
    width: "100%",
    backgroundColor: "#0f172a",
    borderRadius: 10,
    padding: 14,
  },
  stepItem: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 6,
  },
  stepBullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  stepBulletActive: {
    backgroundColor: "#38bdf8",
  },
  stepBulletDone: {
    backgroundColor: "#10b981",
  },
  stepBulletPending: {
    backgroundColor: "#334155",
  },
  stepLabel: {
    fontSize: 12,
    color: "#64748b",
  },
  stepLabelActive: {
    color: "#f8fafc",
    fontWeight: "700",
  },

  // ── VIEW 4, 5, 6: COMPLETED FLOW WRAPPER ──────────────────────────────────
  completedFlowWrapper: {
    flex: 1,
  },
  flowTabsRow: {
    flexDirection: "row",
    backgroundColor: "#0f172a",
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  flowTabItem: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
  },
  flowTabItemActive: {
    backgroundColor: "#1e293b",
  },
  flowTabText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
  },
  flowTabTextActive: {
    color: "#38bdf8",
    fontWeight: "700",
  },
  flowContentContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  stepContainer: {
    width: "100%",
  },
  sectionHeaderTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#f8fafc",
    letterSpacing: -0.5,
  },
  sectionHeaderSub: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 2,
  },

  // ── RESULT SCREEN SPECIFICS ───────────────────────────────────────────────
  resultHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modeTagPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  modeTagPillText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  nudgeHeroCard: {
    backgroundColor: "#1e293b",
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: "#38bdf8",
    marginBottom: 14,
  },
  nudgeCardLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#38bdf8",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  nudgeHeroText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#f8fafc",
    lineHeight: 26,
  },
  actionCard: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 14,
  },
  actionCardLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#10b981",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  actionCardBody: {
    fontSize: 14,
    color: "#e2e8f0",
    lineHeight: 20,
    fontWeight: "500",
  },
  signalsCard: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 14,
  },
  signalsCardLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#94a3b8",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  signalsListRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  signalBadge: {
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#475569",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  signalBadgeText: {
    fontSize: 12,
    color: "#cbd5e1",
    fontWeight: "500",
  },
  emptySignalsText: {
    fontSize: 13,
    color: "#94a3b8",
    fontStyle: "italic",
  },
  transcriptCard: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 16,
  },
  transcriptToggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  transcriptToggleLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#38bdf8",
  },
  transcriptMetaText: {
    fontSize: 11,
    color: "#64748b",
  },
  transcriptScroll: {
    maxHeight: 120,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#334155",
  },
  transcriptBodyText: {
    fontSize: 13,
    color: "#cbd5e1",
    lineHeight: 18,
  },

  // ── INSIGHTS SCREEN SPECIFICS ─────────────────────────────────────────────
  insightsHeader: {
    marginBottom: 16,
  },
  sessionSummaryCard: {
    backgroundColor: "#1e293b",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 14,
  },
  sessionSummaryHeader: {
    fontSize: 10,
    fontWeight: "700",
    color: "#38bdf8",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  summaryStatsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  summaryStatBox: {
    flex: 1,
  },
  summaryStatLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#64748b",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  summaryStatVal: {
    fontSize: 14,
    fontWeight: "800",
    color: "#f8fafc",
  },
  sessionSummaryNote: {
    fontSize: 12,
    color: "#cbd5e1",
    lineHeight: 18,
    borderTopWidth: 1,
    borderTopColor: "#334155",
    paddingTop: 10,
  },
  scoreHeroCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1e293b",
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 14,
  },
  scoreNumberCol: {
    flexDirection: "row",
    alignItems: "baseline",
    marginRight: 16,
  },
  scoreBigNumber: {
    fontSize: 44,
    fontWeight: "800",
    color: "#f8fafc",
  },
  scoreTotalDenominator: {
    fontSize: 16,
    color: "#64748b",
    fontWeight: "600",
    marginLeft: 2,
  },
  scoreMetaCol: {
    flex: 1,
  },
  scoreLabelPill: {
    alignSelf: "flex-start",
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#38bdf8",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 4,
  },
  scoreLabelPillText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#38bdf8",
  },
  scoreSummaryDesc: {
    fontSize: 12,
    color: "#94a3b8",
    lineHeight: 16,
  },
  factorsCard: {
    backgroundColor: "#1e293b",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 14,
  },
  factorsCardHeader: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748b",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  factorRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  factorLeft: {
    flex: 1,
    marginRight: 12,
  },
  factorTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#f8fafc",
  },
  factorDesc: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 2,
    lineHeight: 15,
  },
  factorImpactBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  impactNegative: {
    backgroundColor: "#450a0a",
  },
  impactNeutral: {
    backgroundColor: "#064e3b",
  },
  factorImpactText: {
    fontSize: 11,
    fontWeight: "700",
  },
  impactTextNegative: {
    color: "#f87171",
  },
  impactTextNeutral: {
    color: "#34d399",
  },
  graphCard: {
    backgroundColor: "#1e293b",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 16,
  },
  graphCardHeader: {
    marginBottom: 12,
  },
  graphTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#f8fafc",
  },
  graphSubtitle: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 1,
  },
  graphSubheading: {
    fontSize: 10,
    fontWeight: "700",
    color: "#94a3b8",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  graphNodesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  graphNodeChip: {
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    maxWidth: "48%",
  },
  graphNodeType: {
    fontSize: 9,
    fontWeight: "700",
    color: "#38bdf8",
  },
  graphNodeLabel: {
    fontSize: 11,
    color: "#cbd5e1",
    marginTop: 1,
  },
  graphRelsScroll: {
    maxHeight: 140,
    backgroundColor: "#0f172a",
    borderRadius: 8,
    padding: 8,
  },
  graphRelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  graphRelSource: {
    fontSize: 11,
    color: "#94a3b8",
    maxWidth: "32%",
  },
  graphRelArrowBadge: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  graphRelType: {
    fontSize: 9,
    color: "#38bdf8",
    fontWeight: "700",
  },
  graphRelTarget: {
    fontSize: 11,
    color: "#cbd5e1",
    maxWidth: "32%",
    textAlign: "right",
  },

  // ── COMPLETE SCREEN SPECIFICS ─────────────────────────────────────────────
  completeHeader: {
    alignItems: "center",
    marginBottom: 20,
    paddingTop: 8,
  },
  completeCheckmarkBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#064e3b",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#10b981",
  },
  completeCheckmarkText: {
    fontSize: 24,
    color: "#10b981",
    fontWeight: "800",
  },
  completeTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#f8fafc",
    marginBottom: 6,
  },
  completeSub: {
    fontSize: 13,
    color: "#94a3b8",
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 16,
  },
  completeSummaryCard: {
    backgroundColor: "#1e293b",
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 24,
  },
  summaryMetaGrid: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  summaryMetaItem: {
    alignItems: "center",
  },
  summaryMetaLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748b",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  summaryMetaVal: {
    fontSize: 15,
    fontWeight: "800",
    color: "#f8fafc",
  },
  summaryDivider: {
    height: 1,
    backgroundColor: "#334155",
    marginVertical: 14,
  },
  summaryNudgeLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#38bdf8",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  summaryNudgeText: {
    fontSize: 14,
    color: "#cbd5e1",
    lineHeight: 20,
    fontStyle: "italic",
  },

  // ── ACTION BUTTONS & THUMB REACH ──────────────────────────────────────────
  bottomActionArea: {
    marginTop: 8,
    width: "100%",
  },
  primaryActionBtn: {
    width: "100%",
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  primaryActionBtnText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  startBtn: {
    backgroundColor: "#0284c7",
  },
  endRecordingBtn: {
    backgroundColor: "#dc2626",
  },
  nextBtn: {
    backgroundColor: "#0284c7",
  },
  secondaryActionBtn: {
    width: "100%",
    minHeight: 48,
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#334155",
    marginTop: 10,
  },
  secondaryActionBtnText: {
    color: "#cbd5e1",
    fontSize: 14,
    fontWeight: "600",
  },
  secondaryTextBtn: {
    alignItems: "center",
    paddingVertical: 10,
    marginTop: 6,
  },
  secondaryTextBtnLabel: {
    fontSize: 13,
    color: "#94a3b8",
    fontWeight: "600",
  },
});
