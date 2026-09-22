import AsyncStorage from "@react-native-async-storage/async-storage";

const SESSIONS_INDEX_KEY = "@livenudge_completed_sessions";
const SESSION_PREFIX = "@livenudge_session:";

const ALLOWED_MODES = [
  "clarity",
  "empathy",
  "confidence",
  "listening",
  "tone",
  "concise_response",
];

/**
 * Generate a unique session ID.
 */
function generateSessionId() {
  const timestamp = Date.now();
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `session_${timestamp}_${randomPart}`;
}

/**
 * Validates whether the session is a valid completed session.
 */
function isValidCompletedSession(data) {
  if (!data || typeof data !== "object") return false;

  const hasTranscript =
    typeof data.transcript === "string" && data.transcript.trim().length > 0;
  const hasNudge =
    typeof data.nudge === "string" && data.nudge.trim().length > 0;
  const hasValidMode =
    typeof data.mode === "string" &&
    ALLOWED_MODES.includes(data.mode.trim().toLowerCase());
  const hasSignals = Array.isArray(data.signals);
  const hasSuggestedAction = typeof data.suggestedAction === "string";

  return (
    hasTranscript &&
    hasNudge &&
    hasValidMode &&
    hasSignals &&
    hasSuggestedAction
  );
}

/**
 * Saves a completed session locally.
 * Never persists API keys, model prompts, or chain-of-thought/reasoning.
 *
 * @param {Object} sessionData
 * @returns {Promise<Object|null>} The saved session object, or null if invalid or failed.
 */
export async function saveSession(sessionData) {
  try {
    if (!isValidCompletedSession(sessionData)) {
      console.warn(
        "⚠️ [LiveNudge Storage] Cannot persist incomplete or invalid session:",
        sessionData
      );
      return null;
    }

    const sessionId =
      typeof sessionData.sessionId === "string" && sessionData.sessionId.trim().length > 0
        ? sessionData.sessionId.trim()
        : generateSessionId();

    const startedAt =
      typeof sessionData.startedAt === "string" && sessionData.startedAt.trim().length > 0
        ? sessionData.startedAt.trim()
        : new Date().toISOString();

    const endedAt =
      typeof sessionData.endedAt === "string" && sessionData.endedAt.trim().length > 0
        ? sessionData.endedAt.trim()
        : new Date().toISOString();

    const duration =
      typeof sessionData.duration === "number" && sessionData.duration >= 0
        ? sessionData.duration
        : 0;

    // Strict schema projection - never include api keys, reasoning, or unverified fields
    const sessionRecord = {
      sessionId,
      startedAt,
      endedAt,
      duration,
      transcript: sessionData.transcript.trim(),
      nudge: sessionData.nudge.trim(),
      mode: sessionData.mode.trim().toLowerCase(),
      signals: sessionData.signals
        .filter((s) => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim()),
      suggestedAction: sessionData.suggestedAction.trim(),
    };

    // Save individual session record
    await AsyncStorage.setItem(
      `${SESSION_PREFIX}${sessionId}`,
      JSON.stringify(sessionRecord)
    );

    // Update session index list (most recent first, up to 100 sessions)
    const existingRaw = await AsyncStorage.getItem(SESSIONS_INDEX_KEY);
    const existingList = existingRaw ? JSON.parse(existingRaw) : [];
    const filteredList = existingList.filter((s) => s.sessionId !== sessionId);
    const updatedList = [sessionRecord, ...filteredList].slice(0, 100);

    await AsyncStorage.setItem(
      SESSIONS_INDEX_KEY,
      JSON.stringify(updatedList)
    );

    console.log(
      `💾 [LiveNudge Storage] Session ${sessionId} persisted locally (${sessionRecord.mode}, duration: ${sessionRecord.duration}s)`
    );

    return sessionRecord;
  } catch (err) {
    console.error("❌ [LiveNudge Storage] Failed to save session:", err);
    // Non-fatal: do not crash or disrupt the in-memory flow
    return null;
  }
}

/**
 * Retrieves a single session by its unique sessionId.
 *
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function getSession(sessionId) {
  try {
    if (!sessionId || typeof sessionId !== "string") {
      return null;
    }

    const raw = await AsyncStorage.getItem(`${SESSION_PREFIX}${sessionId.trim()}`);
    if (!raw) {
      // Fallback search in index list
      const indexRaw = await AsyncStorage.getItem(SESSIONS_INDEX_KEY);
      if (!indexRaw) return null;
      const list = JSON.parse(indexRaw);
      return list.find((s) => s.sessionId === sessionId.trim()) || null;
    }

    return JSON.parse(raw);
  } catch (err) {
    console.error(`❌ [LiveNudge Storage] Failed to get session ${sessionId}:`, err);
    return null;
  }
}

/**
 * Retrieves recently completed sessions, ordered newest first.
 *
 * @param {number} [limit=10]
 * @returns {Promise<Array<Object>>}
 */
export async function getRecentSessions(limit = 10) {
  try {
    const raw = await AsyncStorage.getItem(SESSIONS_INDEX_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    const max = typeof limit === "number" && limit > 0 ? limit : 10;
    return list.slice(0, max);
  } catch (err) {
    console.error("❌ [LiveNudge Storage] Failed to get recent sessions:", err);
    return [];
  }
}
