import {
    DEFAULT_LESSON_TEMPLATE,
    getFollowUpLessonPrompt,
    getInitialLessonPrompt
} from "./prompts";

const requestLessonGeneration = async (prompt: string): Promise<string> => {
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

    return typeof data.html === "string" ? data.html : "";
};

export const generateInitialLesson = async (
    topic: string,
    templateFilename: string = DEFAULT_LESSON_TEMPLATE
): Promise<string> => {
    try {
        const prompt = await getInitialLessonPrompt(topic, templateFilename);
        return await requestLessonGeneration(prompt);
    } catch (error) {
        console.error("Gemini API Error:", error);
        throw error;
    }
};

export const generateFollowUpLesson = async (
    currentTopic: string,
    clickedElementHtml: string,
    userQuestion: string = "",
    templateFilename: string = DEFAULT_LESSON_TEMPLATE,
    previousFullHtml: string = ""
): Promise<string> => {
    try {
        const prompt = await getFollowUpLessonPrompt(
            currentTopic,
            clickedElementHtml,
            userQuestion,
            templateFilename,
            previousFullHtml
        );
        return await requestLessonGeneration(prompt);
    } catch (error) {
        console.error("Gemini API Error:", error);
        throw error;
    }
};
