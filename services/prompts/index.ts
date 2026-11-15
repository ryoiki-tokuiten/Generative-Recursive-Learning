/// <reference types="vite/client" />

import promptMarkdown from "./prompt.md?raw";

const templateSources = import.meta.glob<string>("./templates/*.html", {
    import: "default",
    query: "?raw"
});

const thumbnailSources = import.meta.glob<string>(
    "./templates/*.{svg,png,jpg,jpeg,webp,avif,gif}",
    {
        eager: true,
        import: "default",
        query: "?url"
    }
);

const IMAGE_EXTENSION_PATTERN = /\.(?:svg|png|jpe?g|webp|avif|gif)$/i;
const TEMPLATE_FILENAME_PATTERN = /^[A-Za-z0-9_-]+\.html$/;

const getFilename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const getStem = (filename: string) => filename.slice(0, filename.lastIndexOf("."));

export const SHARED_PROMPT_MAGIC = promptMarkdown.trim();

export const DEFAULT_LESSON_TEMPLATE = "Standard-2.html";

export const DEFAULT_FOLLOW_UP_HARNESS_MESSAGE =
    "The user did not type a custom question—they clicked directly on this element to zoom in and continue the lesson's natural progression. Diagnose the exact mechanism, claim, formula, or visual state inside `User clicked on`, identify what was treated as a black box or stepping stone in the parent lesson, and build a brand-new, multi-stage deep-dive progression lesson that unpacks how it works under the hood and carries the learner to the next deeper layer of understanding.";

export const LESSON_TEMPLATE_LOADERS = templateSources;

export interface LessonTemplateOption {
    filename: string;
    name: string;
    thumbnailUrl?: string;
}

export const LESSON_TEMPLATE_OPTIONS: LessonTemplateOption[] = Object.keys(templateSources)
    .map((templatePath) => {
        const filename = getFilename(templatePath);
        const stem = getStem(filename);
        const thumbnail = Object.entries(thumbnailSources).find(([imagePath]) => {
            const imageFilename = getFilename(imagePath);
            return IMAGE_EXTENSION_PATTERN.test(imageFilename) && getStem(imageFilename) === stem;
        });

        return {
            filename,
            name: stem,
            thumbnailUrl: thumbnail?.[1]
        };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

export const loadLessonTemplate = async (
    templateFilename: string = DEFAULT_LESSON_TEMPLATE
): Promise<string> => {
    if (!TEMPLATE_FILENAME_PATTERN.test(templateFilename)) {
        throw new Error("Template must be an HTML filename inside the templates directory.");
    }

    const loadTemplate = LESSON_TEMPLATE_LOADERS[`./templates/${templateFilename}`];
    if (!loadTemplate) {
        throw new Error(`Could not load lesson template "${templateFilename}".`);
    }

    try {
        const templateHtml = await loadTemplate();
        if (!templateHtml) {
            throw new Error(`Could not load lesson template "${templateFilename}".`);
        }
        return templateHtml;
    } catch (error) {
        throw new Error(`Could not load lesson template "${templateFilename}".`, { cause: error });
    }
};

export const formatInitialLessonContext = (topic: string): string =>
    [
        "<Initial_Lesson_Task>",
        `Original user request: ${topic}`,
        "",
        "Create a comprehensive, visually rich, standalone HTML lesson that teaches this request from first principles and builds step-by-step toward its deepest mechanisms and technical details.",
        "</Initial_Lesson_Task>"
    ].join("\n");

export const formatFollowUpLessonContext = (
    originalUserRequest: string,
    clickedElementHtml: string,
    userRecursivePrompt: string = "",
    previousFullHtml: string = ""
): string => {
    const resolvedRecursivePrompt =
        userRecursivePrompt.trim() || DEFAULT_FOLLOW_UP_HARNESS_MESSAGE;

    return [
        "<Follow_Up_Progression_Task>",
        "You are generating the NEXT child node in a recursive, branching learning graph.",
        "The learner started with the overarching topic (`Original user request`), studied the parent lesson (`Previous Full HTML File`), clicked on a specific element/section from that page (`User clicked on`), and triggered this follow-up branch with `User's_Recursive_Prompt`.",
        "",
        "DO NOT EDIT OR REWRITE THE PREVIOUS HTML FILE:",
        "1. NEVER return an updated, patched, or expanded copy of `Previous Full HTML File`.",
        "2. NEVER keep the parent lesson's existing tabs, stages, macro outline, or old sections and merely insert extra detail into one section.",
        "3. You must build a 100% BRAND-NEW, standalone HTML lesson whose ENTIRE multi-stage arc, every interactive visualization/simulation, and all prose are dedicated exclusively to unpacking `User clicked on`, answering `User's_Recursive_Prompt`, and driving the natural conceptual progression forward from that exact point.",
        "",
        "HOW TO INTERPRET AND USE THE 4 CONTEXT INPUTS BELOW:",
        "- `Original user request`: The root session topic. Use it to keep domain framing, goals, and big-picture relevance aligned.",
        "- `User clicked on`: The exact HTML/DOM fragment the learner selected to zoom into. Treat the specific mechanism, equation, claim, component, or visual state inside this snippet as the new root subject and launchpad (Stage 1) of your new lesson.",
        "- `User's_Recursive_Prompt`: The learner's specific question, challenge, or exploration direction for the clicked element (or the automatic progression harness instruction if they clicked without typing a prompt). Build the entire stage-by-step progression and interactive models to resolve this completely.",
        "",
        "HOW TO DESIGN THE FOLLOW-UP PROGRESSION:",
        "- Start right at the clicked concept: briefly connect to the notation/context from the parent page so the transition feels seamless, then immediately open up the black box.",
        "- Structure all stages/tabs of the new page as a deep progression inside this sub-topic: e.g., (1) the core problem or hidden mechanism inside the clicked element, (2) step-by-step constructive derivation or execution trace, (3) interactive sandbox/simulation to stress-test parameters and edge cases, and (4) deeper consequences, trade-offs, or how it plugs back into the larger system.",
        "- Create brand-new, microscopic/domain-specific interactive visuals (2D/3D simulations, state scrubbers, geometric constructions, or live traces) that let the learner directly manipulate the internal mechanics of what they clicked on.",
        "</Follow_Up_Progression_Task>",
        "",
        "<Follow_Up_Context>",
        `Original user request: ${originalUserRequest}`,
        "",
        "User clicked on:",
        clickedElementHtml,
        "",
        "Previous Full HTML File:",
        previousFullHtml,
        "",
        `User's_Recursive_Prompt: ${resolvedRecursivePrompt}`,
        "</Follow_Up_Context>"
    ].join("\n");
};

export const buildLessonPrompt = (
    basePrompt: string,
    contextBlock: string,
    templateFilename: string,
    templateHtml: string
): string => `${basePrompt.trim()}

<Lesson_Request_Context>
${contextBlock}
</Lesson_Request_Context>

<Implementation>
Return one complete, self-contained HTML document that runs directly in a modern browser with an internet connection. Include all needed markup, styles, data, and working behavior in the document. Return only the complete HTML document. Do not omit sections of the source or use placeholders such as "rest of code here".
</Implementation>

<Selected template file: templates/${templateFilename}>
The complete source below was loaded from that file for this request. It is the authoritative design reference for this page. Follow its page structure and visual philosophy closely while writing content for this topic. Use its source to infer this template’s design; do not treat it as a rule for other templates.

<selected-template-html>
${templateHtml}
</selected-template-html>
`;

export const getInitialLessonPrompt = async (
    topic: string,
    templateFilename: string = DEFAULT_LESSON_TEMPLATE
): Promise<string> => {
    const templateHtml = await loadLessonTemplate(templateFilename);

    return buildLessonPrompt(
        SHARED_PROMPT_MAGIC,
        formatInitialLessonContext(topic),
        templateFilename,
        templateHtml
    );
};

export const getFollowUpLessonPrompt = async (
    originalUserRequest: string,
    clickedElementHtml: string,
    userRecursivePrompt: string = "",
    templateFilename: string = DEFAULT_LESSON_TEMPLATE,
    previousFullHtml: string = ""
): Promise<string> => {
    const templateHtml = await loadLessonTemplate(templateFilename);

    return buildLessonPrompt(
        SHARED_PROMPT_MAGIC,
        formatFollowUpLessonContext(
            originalUserRequest,
            clickedElementHtml,
            userRecursivePrompt,
            previousFullHtml
        ),
        templateFilename,
        templateHtml
    );
};
