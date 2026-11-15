import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const MODEL_NAME = 'gemini-3.5-flash-lite';

// gemma-4-31b-it
// gemma-4-26b-a4b-it

const CLEAN_REGEX = /```html|```/g;

const GENERATION_CONFIG = {
    maxOutputTokens: 65536,
    thinkingConfig: {
        thinkingLevel: ThinkingLevel.HIGH,
    },
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

export const generateLessonFromPrompt = async (
    prompt: string,
    model: string = MODEL_NAME
): Promise<string> => {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: GENERATION_CONFIG,
    });

    return (response.text || "").replace(CLEAN_REGEX, '').trim();
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
