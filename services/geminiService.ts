import {
    DEFAULT_LESSON_TEMPLATE,
    getFollowUpLessonPrompt,
    getInitialLessonPrompt
} from "./prompts";

export interface LessonGenerationSession {
    sessionId: string;
    html: string;
}

const requestLessonSession = async (prompt: string): Promise<LessonGenerationSession> => {
    const response = await fetch("/api/gemini/generate", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || `Request failed with status ${response.status}`);
    }

    return {
        sessionId: typeof data.sessionId === "string" ? data.sessionId : "",
        html: typeof data.html === "string" ? data.html : "",
    };
};

export const startInitialLessonSession = async (
    topic: string,
    templateFilename: string = DEFAULT_LESSON_TEMPLATE
): Promise<LessonGenerationSession> => {
    const prompt = await getInitialLessonPrompt(topic, templateFilename);
    return await requestLessonSession(prompt);
};

export const startFollowUpLessonSession = async (
    currentTopic: string,
    clickedElementHtml: string,
    userQuestion: string = "",
    templateFilename: string = DEFAULT_LESSON_TEMPLATE,
    previousFullHtml: string = ""
): Promise<LessonGenerationSession> => {
    const prompt = await getFollowUpLessonPrompt(
        currentTopic,
        clickedElementHtml,
        userQuestion,
        templateFilename,
        previousFullHtml
    );
    return await requestLessonSession(prompt);
};

export const repairLessonWithDiff = async (
    sessionId: string,
    errors: string[]
): Promise<string> => {
    const response = await fetch("/api/gemini/repair", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId, errors }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || `Repair failed with status ${response.status}`);
    }

    if (typeof data.html !== "string" || !data.html.trim()) {
        throw new Error("Server returned empty patched HTML.");
    }

    return data.html;
};

export const closeLessonSession = async (sessionId: string): Promise<void> => {
    if (!sessionId) return;
    await fetch(`/api/gemini/session/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
    }).catch(() => {});
};
