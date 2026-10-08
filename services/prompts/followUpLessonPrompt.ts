import {
    DEFAULT_LESSON_TEMPLATE,
    loadLessonTemplate,
    SHARED_PROMPT_MAGIC
} from "./initialLessonPrompt";

export const getFollowUpLessonPrompt = async (
    currentTopic: string,
    clickedElementHtml: string,
    userQuestion: string,
    templateFilename: string = DEFAULT_LESSON_TEMPLATE
): Promise<string> => {
    const templateHtml = await loadLessonTemplate(templateFilename);

    return `Context: The user is studying "${currentTopic}". They selected a section from the existing lesson and asked: "${userQuestion}".

${SHARED_PROMPT_MAGIC}

<Selected source section>
${clickedElementHtml}
</Selected source section>

<Task>
Create a new, standalone HTML deep-dive page that answers the user's question and explains the selected concept in much greater detail. Keep the discussion clearly connected to the broader topic and to the selected section. Expand the reasoning step by step, define technical terms when they first matter, and use concrete examples, derivations, comparisons, or realistic cases where useful.

Write substantial, clear explanatory prose. This is a teaching page, not a short answer decorated with UI. Use plain language while keeping the technical details accurate. Do not add filler or make claims unsupported by the context or the subject. Do not put AI disclaimers, conversational commentary, or generation instructions into the rendered page.

<Visual and interaction quality>
Create a polished, responsive experience with a clear hierarchy. Use visualizations that explain this specific deep-dive: for example, an interactive model, diagram, chart, simulation, timeline, map, or another useful representation. Make controls functional and understandable. Connect the explanation to its relevant visualization using nearby links, anchors, tabs, or a navigation pattern that fits the selected design. Reuse components when that improves the experience. Include accessible labels, keyboard support, and sensible mobile behavior.

The new page should feel like a natural continuation of the existing lesson while still being a complete page on its own. Follow the selected template’s page structure, visual hierarchy, navigation, interaction patterns, and design philosophy closely. Adjust the number and wording of sections to explain the deep-dive, and translate any component that cannot directly teach this concept into an equivalent interaction in the same design language.

<Selected template guidance>
A complete HTML example from the selected file is included below. Inspect the actual source to learn its visual language: typography, colors, spacing, surfaces, information density, page composition, navigation, components, and visualization behavior.

The selected template is authoritative for the generated page visual style and design philosophy. Follow its actual typography, palette, spacing, surfaces, information density, composition, navigation, components, motion, and interaction patterns closely and consistently. Preserve its recognizable hierarchy and design language while adapting the explanation and replacing only behavior that cannot meaningfully teach this concept. Templates in this directory differ, so infer the design solely from the complete HTML included below. Do not import assumptions from another template or from the former Reinforcement Learning example, and do not carry unrelated subject matter into the deep dive.

Treat the selected HTML as a presentation template, not a content or visualization blueprint. Preserve its layout, hierarchy, visual language, and placement of visual regions, but derive the deep-dive content, examples, data, and actual visuals entirely from the user’s question and selected concept. Do not copy the template’s sample topic, text, data, or diagrams. Go substantially beyond the example with exceptionally clear, detailed teaching and topic-specific interactive visuals that stay synchronized with the explanation, underlying model, and user controls.

<Unlimited external resources>
Use public CDNs, libraries, fonts, icons, and hosted assets freely. There is no quota, cost budget, or fixed allow-list: use any suitable number of dependable resources, including libraries not mentioned in the template. This unlimited access is part of the requirements. Prefer established libraries for substantial charting, visualization, animation, math, or UI work when they help. Do not avoid a useful dependency just to keep the file small. Choose compatible versions and loading patterns for a standalone HTML document. The selected template's dependencies are neither mandatory nor exhaustive.

<Implementation>
Return one complete, self-contained HTML document that runs directly in a modern browser with an internet connection. Include all needed markup, styles, data, and working behavior. Plan the explanation and functionality before writing the page. Use realistic and consistent data; generate useful numerical variation logically when appropriate. Keep the code modular, readable, accessible, responsive, and robust. Use error handling that suits the actual behavior instead of adding empty try/catch blocks.

The generated HTML must contain more than 1500 and fewer than 2000 lines. Meet that requirement with meaningful explanation, components, interactions, data handling, accessibility, responsiveness, and error handling. Do not pad with blank lines, repeated markup, comments, or meaningless code.

Return only the complete HTML document. Do not omit source sections or use placeholders such as "rest of code here".

<Selected template file: templates/${templateFilename}>
The complete source below was loaded from that file for this request. It is the authoritative design reference for this page. Follow its page structure and visual philosophy closely while writing content for this topic. Use its source to infer this template’s design; do not treat it as a rule for other templates.

<selected-template-html>
${templateHtml}
</selected-template-html>
`;
};
