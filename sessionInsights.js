/**
 * Deterministic Session Insights for LiveNudge
 * Computes reproducible scoring and graph datasets derived strictly
 * from real conversation and coaching session data.
 */

/**
 * Computes deterministic score, label, and factor breakdown
 * based strictly on real observable data from the session.
 *
 * @param {Object} session
 * @param {string} session.transcript
 * @param {number} session.duration
 * @param {string} session.mode
 * @param {string[]} session.signals
 * @param {string} session.nudge
 * @param {string} session.suggestedAction
 * @returns {{ score: number, scoreLabel: string, scoreFactors: Array<{ factor: string, impact: number, description: string }> }}
 */
export function computeSessionScore(session) {
  const transcript = (session?.transcript || "").trim();
  const duration = typeof session?.duration === "number" ? session.duration : 0;
  const signals = Array.isArray(session?.signals) ? session.signals : [];
  const mode = (session?.mode || "").trim().toLowerCase();

  const words = transcript.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  let currentScore = 100;
  const scoreFactors = [];

  // Factor 1: Observed Friction Signals
  if (signals.length === 0) {
    scoreFactors.push({
      factor: "Friction Signals",
      impact: 0,
      description: "No communication friction signals detected in transcript.",
    });
  } else {
    // Each signal deducts 7 points (capped at -35 points)
    const deduction = Math.min(35, signals.length * 7);
    currentScore -= deduction;
    scoreFactors.push({
      factor: "Friction Signals",
      impact: -deduction,
      description: `${signals.length} signal(s) observed: ${signals.join(", ")}.`,
    });
  }

  // Factor 2: Delivery Pace (Words Per Minute)
  if (duration > 0 && wordCount > 0) {
    const wpm = Math.round((wordCount / duration) * 60);

    if (wpm < 85) {
      // Significantly slow pace
      const slowDeduction = 8;
      currentScore -= slowDeduction;
      scoreFactors.push({
        factor: "Delivery Pace",
        impact: -slowDeduction,
        description: `Speaking pace was slow (${wpm} WPM vs optimal 120-160 WPM).`,
      });
    } else if (wpm > 185) {
      // Rushed pace
      const rushDeduction = 8;
      currentScore -= rushDeduction;
      scoreFactors.push({
        factor: "Delivery Pace",
        impact: -rushDeduction,
        description: `Speaking pace was rushed (${wpm} WPM vs optimal 120-160 WPM).`,
      });
    } else {
      scoreFactors.push({
        factor: "Delivery Pace",
        impact: 0,
        description: `Speaking pace was within normal conversational range (${wpm} WPM).`,
      });
    }
  } else {
    scoreFactors.push({
      factor: "Delivery Pace",
      impact: 0,
      description: "Pace evaluation neutral (insufficient duration or word count).",
    });
  }

  // Factor 3: Mode Alignment & Verbosity
  if (mode === "concise_response") {
    if (wordCount > 100) {
      const verboseDeduction = 6;
      currentScore -= verboseDeduction;
      scoreFactors.push({
        factor: "Mode Alignment",
        impact: -verboseDeduction,
        description: `Target was concise response, but word count was high (${wordCount} words).`,
      });
    } else {
      scoreFactors.push({
        factor: "Mode Alignment",
        impact: 0,
        description: `Concise response goal met (${wordCount} words).`,
      });
    }
  } else if (mode === "clarity") {
    const hasFillerSignal = signals.some((s) =>
      /filler|pause|hesitat|stumble|repeat/i.test(s)
    );
    if (hasFillerSignal) {
      const clarityDeduction = 5;
      currentScore -= clarityDeduction;
      scoreFactors.push({
        factor: "Mode Alignment",
        impact: -clarityDeduction,
        description: "Clarity mode penalized due to identified speech disfluencies.",
      });
    } else {
      scoreFactors.push({
        factor: "Mode Alignment",
        impact: 0,
        description: "Clarity mode maintained without major disfluencies.",
      });
    }
  } else {
    scoreFactors.push({
      factor: "Mode Alignment",
      impact: 0,
      description: `Evaluation aligned with '${mode || "general"}' mode.`,
    });
  }

  // Clamp score strictly between 0 and 100
  const finalScore = Math.max(0, Math.min(100, currentScore));

  // Deterministic Label
  let scoreLabel = "Strong Delivery";
  if (finalScore < 55) {
    scoreLabel = "Needs Adjustment";
  } else if (finalScore < 70) {
    scoreLabel = "Developing";
  } else if (finalScore < 85) {
    scoreLabel = "Effective";
  }

  return {
    score: finalScore,
    scoreLabel,
    scoreFactors,
  };
}

/**
 * Generates a renderer-independent, fully serializable graph dataset
 * (nodes and relationships) from real session attributes.
 *
 * @param {Object} session
 * @param {string} session.sessionId
 * @param {string} session.startedAt
 * @param {string} session.endedAt
 * @param {number} session.duration
 * @param {string} session.transcript
 * @param {string} session.nudge
 * @param {string} session.mode
 * @param {string[]} session.signals
 * @param {string} session.suggestedAction
 * @returns {{ nodes: Array<Object>, relationships: Array<Object> }}
 */
export function generateSessionGraph(session) {
  const sessionId = (session?.sessionId || `session_${Date.now()}`).trim();
  const transcript = (session?.transcript || "").trim();
  const nudge = (session?.nudge || "").trim();
  const mode = (session?.mode || "concise_response").trim().toLowerCase();
  const signals = Array.isArray(session?.signals) ? session.signals : [];
  const suggestedAction = (session?.suggestedAction || "").trim();
  const duration = typeof session?.duration === "number" ? session.duration : 0;

  const words = transcript.split(/\s+/).filter(Boolean);

  const nodes = [];
  const relationships = [];

  let relationshipCounter = 1;
  const nextRelId = (prefix) => `rel_${prefix}_${relationshipCounter++}`;

  // 1. Session Node
  const sessionNodeId = `node_session_${sessionId}`;
  nodes.push({
    id: sessionNodeId,
    label: "Session",
    type: "session",
    properties: {
      sessionId,
      duration,
      startedAt: session?.startedAt || null,
      endedAt: session?.endedAt || null,
    },
  });

  // 2. Transcript Node
  const transcriptNodeId = `node_transcript_${sessionId}`;
  nodes.push({
    id: transcriptNodeId,
    label: "Speech Input",
    type: "transcript",
    properties: {
      text: transcript,
      wordCount: words.length,
    },
  });

  relationships.push({
    id: nextRelId("session_transcript"),
    source: sessionNodeId,
    target: transcriptNodeId,
    type: "PRODUCED",
    properties: { duration },
  });

  // 3. Mode Node
  const modeNodeId = `node_mode_${mode}`;
  nodes.push({
    id: modeNodeId,
    label: `Mode: ${mode}`,
    type: "mode",
    properties: {
      name: mode,
    },
  });

  relationships.push({
    id: nextRelId("transcript_mode"),
    source: transcriptNodeId,
    target: modeNodeId,
    type: "EVALUATED_IN_MODE",
    properties: {},
  });

  // 4. Coaching Nudge Node
  const nudgeNodeId = `node_nudge_${sessionId}`;
  nodes.push({
    id: nudgeNodeId,
    label: "Coaching Nudge",
    type: "nudge",
    properties: {
      text: nudge,
    },
  });

  relationships.push({
    id: nextRelId("mode_nudge"),
    source: modeNodeId,
    target: nudgeNodeId,
    type: "TARGETED_BY",
    properties: {},
  });

  // 5. Signal Nodes & Relationships (handle zero/missing signals gracefully)
  if (signals.length > 0) {
    signals.forEach((sig, index) => {
      const signalText = String(sig).trim();
      const signalNodeId = `node_signal_${sessionId}_${index}`;
      nodes.push({
        id: signalNodeId,
        label: signalText,
        type: "signal",
        properties: {
          name: signalText,
          index,
        },
      });

      relationships.push({
        id: nextRelId("transcript_signal"),
        source: transcriptNodeId,
        target: signalNodeId,
        type: "EXHIBITED_SIGNAL",
        properties: {},
      });

      relationships.push({
        id: nextRelId("signal_nudge"),
        source: signalNodeId,
        target: nudgeNodeId,
        type: "INFORMED_NUDGE",
        properties: {},
      });
    });
  } else {
    // Graceful handling of zero friction signals
    const cleanSignalNodeId = `node_signal_clean_${sessionId}`;
    nodes.push({
      id: cleanSignalNodeId,
      label: "No Friction Signals",
      type: "signal",
      properties: {
        status: "clean",
      },
    });

    relationships.push({
      id: nextRelId("transcript_clean"),
      source: transcriptNodeId,
      target: cleanSignalNodeId,
      type: "EXHIBITED_SIGNAL",
      properties: {},
    });

    relationships.push({
      id: nextRelId("clean_nudge"),
      source: cleanSignalNodeId,
      target: nudgeNodeId,
      type: "INFORMED_NUDGE",
      properties: {},
    });
  }

  // 6. Suggested Action Node (if present)
  if (suggestedAction) {
    const actionNodeId = `node_action_${sessionId}`;
    nodes.push({
      id: actionNodeId,
      label: "Suggested Action",
      type: "action",
      properties: {
        text: suggestedAction,
      },
    });

    relationships.push({
      id: nextRelId("nudge_action"),
      source: nudgeNodeId,
      target: actionNodeId,
      type: "RECOMMENDS",
      properties: {},
    });
  }

  return {
    nodes,
    relationships,
  };
}

/**
 * Convenience entry point to generate both deterministic scoring
 * and serializable graph data for a completed session.
 *
 * @param {Object} session
 * @returns {{ score: number, scoreLabel: string, scoreFactors: Array<Object>, graph: { nodes: Array<Object>, relationships: Array<Object> } }}
 */
export function generateSessionInsights(session) {
  const scoreResult = computeSessionScore(session);
  const graphResult = generateSessionGraph(session);

  return {
    score: scoreResult.score,
    scoreLabel: scoreResult.scoreLabel,
    scoreFactors: scoreResult.scoreFactors,
    graph: graphResult,
  };
}
