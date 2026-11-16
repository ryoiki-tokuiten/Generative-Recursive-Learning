import React, { useEffect, useRef, useMemo } from 'react';
import { AppMode, SelectionEvent } from '../types';

interface GenerativeCanvasProps {
  htmlContent: string;
  mode: AppMode;
  onElementSelect: (data: SelectionEvent) => void;
  onVerificationResult?: (errors: string[]) => void;
}

const ERROR_INTERCEPTOR_SCRIPT = `
<script>
  (function() {
    const capturedErrors = [];
    const seen = new Set();
    let reportTimer = null;
    let hasReported = false;

    const shouldIgnoreMessage = (msg) => {
      if (!msg) return true;
      const text = String(msg).trim();
      if (!text) return true;
      // Ignore non-error warnings and informational notices sometimes routed through console.error
      if (
        text.startsWith('Warning:') ||
        text.includes('You are using the in-browser Babel transformer') ||
        text.includes('cdn.tailwindcss.com should not be used in production') ||
        text.includes('Download the React DevTools') ||
        text.includes('ResizeObserver loop')
      ) {
        return true;
      }
      return false;
    };

    const formatArg = (arg) => {
      if (arg instanceof Error) {
        return arg.stack || (arg.name + ': ' + arg.message);
      }
      if (typeof arg === 'object' && arg !== null) {
        if (typeof arg.message === 'string') {
          return arg.stack || arg.message;
        }
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    };

    const sendReport = () => {
      if (hasReported) return;
      hasReported = true;
      if (reportTimer) clearTimeout(reportTimer);
      window.parent.postMessage({
        type: 'CANVAS_VERIFICATION_RESULT',
        payload: {
          errors: capturedErrors
        }
      }, '*');
    };

    const scheduleReport = (delayMs) => {
      if (hasReported) return;
      if (reportTimer) clearTimeout(reportTimer);
      reportTimer = setTimeout(sendReport, delayMs);
    };

    const recordError = (rawText) => {
      if (shouldIgnoreMessage(rawText)) return;
      const normalized = String(rawText).trim().slice(0, 2500);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        capturedErrors.push(normalized);
        scheduleReport(250);
      }
    };

    // 1. Intercept direct console.error calls (warnings and logs are ignored)
    const originalConsoleError = console.error;
    console.error = function(...args) {
      originalConsoleError.apply(console, args);
      const formatted = args.map(formatArg).join(' ');
      recordError(formatted);
    };

    // 2. Intercept uncaught runtime, syntax, and Babel transpilation errors
    window.addEventListener('error', (event) => {
      if (event.error) {
        recordError(event.error.stack || (event.error.name + ': ' + event.error.message));
      } else if (event.message) {
        const location = event.filename
          ? ' (' + event.filename + ':' + (event.lineno || 0) + ':' + (event.colno || 0) + ')'
          : '';
        recordError(event.message + location);
      } else if (event.target && event.target.tagName === 'SCRIPT') {
        const src = event.target.src || 'inline module script';
        recordError('Script load/execution error: Failed to load ' + src);
      }
    }, true);

    // 3. Intercept unhandled Promise rejections (e.g. failed ESM imports or async crashes)
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      if (reason instanceof Error) {
        recordError('Unhandled Promise Rejection: ' + (reason.stack || reason.message));
      } else {
        recordError('Unhandled Promise Rejection: ' + formatArg(reason));
      }
    });

    // Wait for page load and Babel/ESM module execution before reporting clean verification
    window.addEventListener('load', () => {
      const hasModuleScripts = !!document.querySelector(
        'script[type="text/babel"][data-type="module"], script[type="module"]'
      );

      if (!hasModuleScripts) {
        scheduleReport(400);
        return;
      }

      let checks = 0;
      const maxChecks = 35; // Up to ~5.25s for ESM imports over network
      const pollMount = () => {
        if (hasReported) return;
        if (capturedErrors.length > 0) {
          scheduleReport(250);
          return;
        }
        const rootEl = document.getElementById('root');
        if (!rootEl || (rootEl.children && rootEl.children.length > 0)) {
          scheduleReport(450);
          return;
        }
        checks += 1;
        if (checks >= maxChecks) {
          sendReport();
          return;
        }
        setTimeout(pollMount, 150);
      };

      setTimeout(pollMount, 150);
    });
  })();
</script>
`;

const INTERACTION_SCRIPT = `
<style>
  .interactive-hover {
    outline: 4px solid #6366f1 !important; /* Indigo 500 */
    outline-offset: -4px;
    background-color: rgba(99, 102, 241, 0.1) !important;
    cursor: help !important;
    transition: all 0.2s ease;
    box-shadow: 0 0 20px rgba(99, 102, 241, 0.3) !important;
  }
</style>
<script>
  (function() {
    let currentMode = 'browse';
    
    // --- Message Handling ---
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SET_MODE') {
        currentMode = event.data.mode;
        document.body.style.cursor = currentMode === 'interactive' ? 'help' : 'default';
        
        // Cleanup on mode switch
        if (currentMode !== 'interactive') {
          document.querySelectorAll('.interactive-hover').forEach(el => 
            el.classList.remove('interactive-hover')
          );
        }
      }
    });

    // --- Interaction Logic ---
    const getTargetBlock = (target) => {
       let current = target;
       // Traverse up to find a significant container, but stop before body
       while (current && current !== document.body && current.parentElement !== document.body) {
           const tag = current.tagName;
           // We prioritize semantic blocks or divs with content
           if (['SECTION', 'ARTICLE', 'DIV', 'MAIN', 'ASIDE', 'FIGURE'].includes(tag)) {
               return current;
           }
           current = current.parentElement;
       }
       return target === document.body ? null : target;
    };

    const getComponentId = (target) => {
      if (target.dataset.recursiveComponentId) {
        return target.dataset.recursiveComponentId;
      }

      const path = [];
      let current = target;

      while (current && current !== document.body && current !== document.documentElement) {
        const tag = current.tagName.toLowerCase();
        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter(sibling => sibling.tagName === current.tagName)
          : [current];
        const position = String(siblings.indexOf(current) + 1).padStart(2, '0');
        path.unshift(tag + '-' + position);
        current = current.parentElement;
      }

      const pathKey = path.join('-');
      const semanticName = (target.id || target.getAttribute('aria-label') || target.tagName.toLowerCase())
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 18) || 'block';
      let hash = 0;

      for (let index = 0; index < pathKey.length; index += 1) {
        hash = ((hash << 5) - hash + pathKey.charCodeAt(index)) | 0;
      }

      const componentId = 'cmp-' + semanticName + '-' + Math.abs(hash).toString(36).padStart(5, '0').slice(0, 5);
      target.dataset.recursiveComponentId = componentId;
      return componentId;
    };

    document.addEventListener('mouseover', (e) => {
      if (currentMode !== 'interactive') return;
      const target = getTargetBlock(e.target);
      if (target) {
        e.stopPropagation();
        target.classList.add('interactive-hover');
      }
    });

    document.addEventListener('mouseout', (e) => {
       if (currentMode !== 'interactive') return;
       const target = getTargetBlock(e.target);
       if (target) {
         target.classList.remove('interactive-hover');
       }
    });

    document.addEventListener('click', (e) => {
      if (currentMode !== 'interactive') return;
      e.preventDefault();
      e.stopPropagation();
      
      const target = getTargetBlock(e.target);
      if (target) {
        target.classList.remove('interactive-hover');
        const componentId = getComponentId(target);
        const htmlSnippet = target.outerHTML.replace(/\\sdata-recursive-component-id="[^"]*"/g, '');
        
        // Send to parent
        window.parent.postMessage({
          type: 'ELEMENT_SELECTED',
          payload: {
            componentId,
            htmlSnippet,
            textSummary: (target.innerText || "").substring(0, 150)
          }
        }, '*');
      }
    }, true); // Capture phase
  })();
</script>
`;

export const GenerativeCanvas: React.FC<GenerativeCanvasProps> = ({ 
  htmlContent, 
  mode, 
  onElementSelect,
  onVerificationResult
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Construct the full source document with error interceptor in <head> and interaction script before </body>
  const srcDoc = useMemo(() => {
    let doc = htmlContent;

    if (/<head[^>]*>/i.test(doc)) {
      doc = doc.replace(/<head[^>]*>/i, (match) => `${match}${ERROR_INTERCEPTOR_SCRIPT}`);
    } else {
      doc = `${ERROR_INTERCEPTOR_SCRIPT}${doc}`;
    }

    if (doc.includes('</body>')) {
      doc = doc.replace('</body>', `${INTERACTION_SCRIPT}</body>`);
    } else {
      doc = `${doc}${INTERACTION_SCRIPT}`;
    }

    return doc;
  }, [htmlContent]);

  // Handle Mode Updates via PostMessage
  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'SET_MODE', mode }, '*');
    }
  }, [mode]);

  // Handle Selection and Verification Messages from Iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data) return;

      if (event.data.type === 'ELEMENT_SELECTED') {
        onElementSelect(event.data.payload);
      } else if (event.data.type === 'CANVAS_VERIFICATION_RESULT') {
        const errors = Array.isArray(event.data.payload?.errors)
          ? event.data.payload.errors
          : [];
        onVerificationResult?.(errors);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onElementSelect, onVerificationResult]);

  // Initial load handler to sync mode
  const handleLoad = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'SET_MODE', mode }, '*');
    }
  };

  return (
    <div className="w-full h-screen overflow-hidden bg-slate-900">
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        title="Generative Content"
        className="w-full h-full border-none"
        onLoad={handleLoad}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      />
    </div>
  );
};
