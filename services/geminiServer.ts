import crypto from "crypto";
import { Chat, GoogleGenAI, ThinkingLevel } from "@google/genai";

const MODEL_NAME = 'gemini-3.5-flash-lite';

// gemma-4-31b-it
// gemma-4-26b-a4b-it

const CLEAN_HTML_REGEX = /```html|```/gi;
const CLEAN_JSON_FENCE_REGEX = /^```(?:json)?\s*|\s*```$/gi;

export const MAX_REPAIR_ATTEMPTS = 3;
const MAX_DIFF_PARSE_ATTEMPTS = 3;
const SESSION_TTL_MS = 30 * 60 * 1000;

const GENERATION_CONFIG = {
    maxOutputTokens: 64536,
    thinkingConfig: {
        thinkingLevel: ThinkingLevel.HIGH,
    },
};

export interface DiffOperation {
    search: string;
    replace: string;
}

interface LessonChatSession {
    chat: Chat;
    html: string;
    repairAttempts: number;
    createdAt: number;
}

const activeSessions = new Map<string, LessonChatSession>();

const cleanupExpiredSessions = () => {
    const now = Date.now();
    for (const [id, session] of activeSessions.entries()) {
        if (now - session.createdAt > SESSION_TTL_MS) {
            activeSessions.delete(id);
        }
    }
};

export const getGeminiClient = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not configured on the server.");
    }
    return new GoogleGenAI({
        apiKey,
        httpOptions: {
            headers: {
                'User-Agent': 'aistudio-build',
            },
        },
    });
};

const cleanHtmlOutput = (raw: string): string =>
    raw.replace(CLEAN_HTML_REGEX, '').trim();

const buildErrorRepairPrompt = (errors: string[]): string => [
    "The HTML file you generated threw the following runtime/compilation error(s) when mounted in the browser canvas:",
    "",
    "<Console_Errors>",
    errors.join("\n\n"),
    "</Console_Errors>",
    "",
    "Fix the broken code by outputting a JSON diff against the current HTML file.",
    "Do NOT output the full HTML document and do NOT include any prose or explanation outside the JSON.",
    "Output ONLY a valid JSON array with this exact structure:",
    "[",
    "  {",
    '    "search": "exact contiguous substring from the current HTML file to replace",',
    '    "replace": "the corrected replacement substring"',
    "  }",
    "]",
    "",
    "Rules:",
    '1. Every "search" string must match the current HTML file character-for-character, including exact indentation and line breaks.',
    '2. Include enough surrounding lines in "search" so each target location is matched uniquely.',
    "3. Return raw JSON only."
].join("\n");

export const applyJsonDiffToHtml = (currentHtml: string, rawDiffOutput: string): string => {
    const trimmed = rawDiffOutput.trim().replace(CLEAN_JSON_FENCE_REGEX, '').trim();
    if (!trimmed) {
        throw new Error("Empty diff response. Expected a non-empty JSON array of {\"search\", \"replace\"} objects.");
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch (parseErr: any) {
        // Attempt extracting the outer JSON array if the model included stray leading/trailing text
        const firstBracket = trimmed.indexOf('[');
        const lastBracket = trimmed.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket > firstBracket) {
            try {
                parsed = JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
            } catch {
                throw new Error(`Invalid JSON syntax: ${parseErr?.message || 'Could not parse JSON diff'}`);
            }
        } else {
            throw new Error(`Invalid JSON syntax: ${parseErr?.message || 'Could not parse JSON diff'}`);
        }
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error(
            'Invalid diff shape: root value must be a non-empty JSON array of {"search": string, "replace": string} objects.'
        );
    }

    let workingHtml = currentHtml;

    for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i] as Record<string, unknown>;
        if (
            !item ||
            typeof item !== "object" ||
            typeof item.search !== "string" ||
            typeof item.replace !== "string"
        ) {
            throw new Error(
                `Invalid diff shape at index ${i}: each element must be an object with string "search" and "replace" fields.`
            );
        }

        if (item.search.length === 0) {
            throw new Error(`Invalid diff at index ${i}: "search" string cannot be empty.`);
        }

        const matchIndex = workingHtml.indexOf(item.search);
        if (matchIndex === -1) {
            const preview = item.search.length > 300 ? `${item.search.slice(0, 300)}...` : item.search;
            throw new Error(
                `Diff edit #${i + 1} failed: exact "search" string was not found in the current HTML file. Check exact characters, whitespace, and indentation:\n${preview}`
            );
        }

        workingHtml =
            workingHtml.slice(0, matchIndex) +
            item.replace +
            workingHtml.slice(matchIndex + item.search.length);
    }

    if (workingHtml === currentHtml) {
        throw new Error(
            'Diff applied no effective changes because "search" and "replace" were identical.'
        );
    }

    return workingHtml;
};

export const startLessonSession = async (
    prompt: string,
    model: string = MODEL_NAME
): Promise<{ sessionId: string; html: string }> => {
    cleanupExpiredSessions();
    const ai = getGeminiClient();
    const chat = ai.chats.create({
        model,
        config: GENERATION_CONFIG,
    });

    const response = await chat.sendMessage({ message: prompt });
    const html = cleanHtmlOutput(response.text || "");
    if (!html) {
        throw new Error("Model returned an empty HTML response.");
    }

    const sessionId = crypto.randomUUID();
    activeSessions.set(sessionId, {
        chat,
        html,
        repairAttempts: 0,
        createdAt: Date.now(),
    });

    return { sessionId, html };
};

export const repairLessonSession = async (
    sessionId: string,
    errors: string[]
): Promise<{ html: string; attempt: number }> => {
    cleanupExpiredSessions();
    const session = activeSessions.get(sessionId);
    if (!session) {
        throw new Error("Generation chat session not found or has expired.");
    }

    session.repairAttempts += 1;
    if (session.repairAttempts > MAX_REPAIR_ATTEMPTS) {
        activeSessions.delete(sessionId);
        throw new Error(`Exceeded maximum of ${MAX_REPAIR_ATTEMPTS} canvas repair attempts.`);
    }

    let nextPrompt = buildErrorRepairPrompt(errors);
    let lastDiffError: Error | null = null;

    // If the model outputs malformed JSON or a search block that doesn't match,
    // feed the parse/match error back in the SAME chat rather than restarting the run.
    for (let diffTry = 1; diffTry <= MAX_DIFF_PARSE_ATTEMPTS; diffTry++) {
        const response = await session.chat.sendMessage({ message: nextPrompt });
        const rawDiffText = response.text || "";

        try {
            const patchedHtml = applyJsonDiffToHtml(session.html, rawDiffText);
            session.html = patchedHtml;
            return {
                html: patchedHtml,
                attempt: session.repairAttempts,
            };
        } catch (diffErr: any) {
            lastDiffError = diffErr instanceof Error ? diffErr : new Error(String(diffErr));
            console.warn(
                `[Gemini Repair] Session ${sessionId} (attempt ${session.repairAttempts}, diff parse try ${diffTry}/${MAX_DIFF_PARSE_ATTEMPTS}): ${lastDiffError.message}`
            );

            if (diffTry < MAX_DIFF_PARSE_ATTEMPTS) {
                nextPrompt = [
                    "Your JSON diff could not be parsed or applied to the current HTML file:",
                    "",
                    lastDiffError.message,
                    "",
                    'Output ONLY a corrected JSON array of {"search": "...", "replace": "..."} objects where every "search" string matches the current HTML character-for-character.'
                ].join("\n");
            }
        }
    }

    activeSessions.delete(sessionId);
    throw new Error(
        `Failed to apply JSON diff repair on attempt ${session.repairAttempts}: ${lastDiffError?.message || 'Invalid diff output'}`
    );
};

export const closeLessonSession = (sessionId: string): void => {
    activeSessions.delete(sessionId);
};

export const generateLessonFromPrompt = async (
    prompt: string,
    model: string = MODEL_NAME
): Promise<string> => {
    const { html } = await startLessonSession(prompt, model);
    return html;
};

export const streamLessonFromPrompt = async (
    prompt: string,
    model: string = MODEL_NAME
) => {
    const ai = getGeminiClient();
    return ai.models.generateContentStream({
        model,
        contents: prompt,
        config: GENERATION_CONFIG,
    });
};
