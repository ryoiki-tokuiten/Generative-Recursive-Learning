import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Expand, LayoutTemplate, X } from 'lucide-react';
import { LESSON_TEMPLATE_OPTIONS } from '../services/prompts';

interface LessonTemplateGalleryProps {
  selectedFilename: string;
  onSelect: (filename: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

export const LessonTemplateGallery: React.FC<LessonTemplateGalleryProps> = ({
  selectedFilename,
  onSelect,
  disabled = false,
  compact = false
}) => {
  const [failedThumbnails, setFailedThumbnails] = useState<Set<string>>(() => new Set());
  const [previewFilename, setPreviewFilename] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previewDialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!previewFilename) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewFilename(null);
        return;
      }

      if (event.key === 'Tab') {
        const focusableElements = previewDialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusableElements?.length) return;

        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [previewFilename]);

  const markThumbnailAsFailed = (filename: string) => {
    setFailedThumbnails((current) => new Set(current).add(filename));
  };

  const previewTemplate = LESSON_TEMPLATE_OPTIONS.find(
    (template) => template.filename === previewFilename
  );

  return (
    <>
      <section
        className={`${compact ? 'space-y-2' : 'space-y-3'} text-left`}
        aria-labelledby={compact ? 'follow-up-template-heading' : 'initial-template-heading'}
      >
        <h2
          id={compact ? 'follow-up-template-heading' : 'initial-template-heading'}
          className="text-sm font-semibold text-[#e2e8f0]"
        >
          Select visual style for the lesson
        </h2>

        <fieldset disabled={disabled} className="min-w-0">
          <legend className="sr-only">Lesson template</legend>
          <div className={`grid ${compact ? 'grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'}`}>
            {LESSON_TEMPLATE_OPTIONS.map((template) => {
              const hasThumbnail = !!template.thumbnailUrl && !failedThumbnails.has(template.filename);
              const isSelected = template.filename === selectedFilename;
              const radioId = `template-${compact ? 'follow-up' : 'initial'}-${template.filename}`;

              return (
                <div key={template.filename} className="group relative min-w-0">
                  <input
                    id={radioId}
                    className="peer sr-only"
                    type="radio"
                    name={compact ? 'follow-up-template' : 'initial-template'}
                    value={template.filename}
                    checked={isSelected}
                    onChange={() => onSelect(template.filename)}
                  />
                  <label
                    htmlFor={radioId}
                    className={`block cursor-pointer overflow-hidden rounded-xl border transition duration-200 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-[#00e599] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[#0a0a0c] ${isSelected
                      ? 'border-[#00e599]/80 bg-[#00e599]/[0.06] shadow-[0_0_0_1px_rgba(0,229,153,0.18)]'
                      : 'border-[#2a2a35] bg-[#121217] group-hover:border-[#00e599]/40 group-hover:bg-[#15151d]'
                    }`}
                  >
                    <span className="relative block aspect-[16/9] overflow-hidden bg-[#1a1a24]">
                      {hasThumbnail ? (
                        <img
                          src={template.thumbnailUrl}
                          alt=""
                          aria-hidden="true"
                          loading="lazy"
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                          onError={() => markThumbnailAsFailed(template.filename)}
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_50%_40%,rgba(0,229,153,0.12),transparent_58%)] text-[#64748b]">
                          <LayoutTemplate size={compact ? 20 : 25} strokeWidth={1.4} aria-hidden="true" />
                          <span className="sr-only">Preview unavailable</span>
                        </span>
                      )}
                    </span>
                    <span className={`flex ${compact ? 'min-h-8 px-2 py-1.5' : 'min-h-10 px-3 py-2'} items-center`}>
                      <span className={`truncate text-xs font-medium ${isSelected ? 'text-[#e2e8f0]' : 'text-[#94a3b8] group-hover:text-[#e2e8f0]'}`}>
                        {template.name}
                      </span>
                    </span>
                  </label>

                  {hasThumbnail && (
                    <button
                      type="button"
                      onClick={() => setPreviewFilename(template.filename)}
                      aria-label={`Open ${template.name} thumbnail full screen`}
                      aria-haspopup="dialog"
                      title="View full screen"
                      className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg border border-white/15 bg-[#0a0a0c]/75 text-white/85 opacity-90 shadow-sm backdrop-blur transition hover:border-[#00e599]/50 hover:text-[#00e599] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e599] sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                    >
                      <Expand size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>
      </section>

      {previewTemplate && createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-[#050508]/75 p-3 backdrop-blur-md sm:p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPreviewFilename(null);
          }}
        >
          <div
            ref={previewDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-preview-title"
            tabIndex={-1}
            className="flex h-[min(92vh,1000px)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-[#2a2a35] bg-[#0a0a0c] text-[#e2e8f0] shadow-[0_28px_100px_rgba(0,0,0,0.65)] outline-none"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[#2a2a35] bg-[#121217] px-5 py-4">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#64748b]">Template preview</p>
                <h2 id="template-preview-title" className="mt-1 truncate text-sm font-semibold text-[#e2e8f0]">
                  {previewTemplate.name}
                </h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setPreviewFilename(null)}
                aria-label="Close template preview"
                className="ml-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#2a2a35] text-[#94a3b8] transition hover:border-[#00e599]/40 hover:bg-[#00e599]/10 hover:text-[#00e599] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e599]"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#0d0d12] p-3 sm:p-6">
              {previewTemplate.thumbnailUrl && !failedThumbnails.has(previewTemplate.filename) ? (
                <img
                  src={previewTemplate.thumbnailUrl}
                  alt={`${previewTemplate.name} lesson template preview`}
                  className="max-h-full max-w-full rounded-lg object-contain shadow-[0_16px_60px_rgba(0,0,0,0.5)]"
                  onError={() => markThumbnailAsFailed(previewTemplate.filename)}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 text-center text-[#64748b]">
                  <LayoutTemplate size={38} strokeWidth={1.2} aria-hidden="true" />
                  <p className="text-sm">Preview unavailable</p>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
