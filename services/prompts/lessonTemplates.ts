/// <reference types="vite/client" />

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
const TEMPLATE_NAME_OVERRIDES: Record<string, string> = {
    "opt_chat.html": "Opt Chat"
};

const getFilename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const getStem = (filename: string) => filename.slice(0, filename.lastIndexOf("."));

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
            name: TEMPLATE_NAME_OVERRIDES[filename] ?? stem,
            thumbnailUrl: thumbnail?.[1]
        };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
