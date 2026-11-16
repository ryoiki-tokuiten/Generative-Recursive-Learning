import React, { useState, useCallback, useRef } from 'react';
import { PageNode, NodeMap, AppMode, SelectionEvent } from './types';
import {
  startInitialLessonSession,
  startFollowUpLessonSession,
  repairLessonWithDiff,
  closeLessonSession,
  LessonGenerationSession
} from './services/geminiService';
import { GenerativeCanvas } from './components/GenerativeCanvas';
import { FloatingControls } from './components/FloatingControls';
import { InteractionModal } from './components/InteractionModal';
import { GenerationOverlay } from './components/GenerationOverlay';
import { GraphView } from './components/GraphView';
import { DatabaseView } from './components/DatabaseView';
import { LessonTemplateGallery } from './components/LessonTemplateGallery';
import { getRun, syncRun } from './services/dbService';
import { DEFAULT_LESSON_TEMPLATE } from './services/prompts';
import { ArrowRight, Database } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import {
  collectBranchIds,
  createGenerationId,
  isBranchForSelection
} from './utils/sessionGraph';

const MAX_REPAIR_ATTEMPTS = 3;
const CANVAS_VERIFY_TIMEOUT_MS = 10000;

const App: React.FC = () => {
  // --- State ---
  const [nodeMap, setNodeMap] = useState<NodeMap>({});
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [mode, setMode] = useState<AppMode>('browse');
  const [workspaceView, setWorkspaceView] = useState<'lesson' | 'graph' | 'db'>('lesson');
  const [isLoading, setIsLoading] = useState(false);
  const [initialTopic, setInitialTopic] = useState('');
  const [selectedTemplateFilename, setSelectedTemplateFilename] = useState(DEFAULT_LESSON_TEMPLATE);
  const [candidateHtml, setCandidateHtml] = useState<string | null>(null);

  // Interaction State
  const [pendingSelection, setPendingSelection] = useState<SelectionEvent | null>(null);

  // Canvas verification synchronization
  const verificationResolverRef = useRef<((errors: string[]) => void) | null>(null);
  const verificationTimeoutRef = useRef<number | null>(null);

  // Computed
  const currentNode = currentNodeId ? nodeMap[currentNodeId] : null;

  const handleCanvasVerificationResult = useCallback((errors: string[]) => {
    if (verificationTimeoutRef.current !== null) {
      window.clearTimeout(verificationTimeoutRef.current);
      verificationTimeoutRef.current = null;
    }
    if (verificationResolverRef.current) {
      const resolve = verificationResolverRef.current;
      verificationResolverRef.current = null;
      resolve(errors);
    }
  }, []);

  const verifyHtmlInCanvas = useCallback((html: string): Promise<string[]> => {
    return new Promise((resolve) => {
      if (verificationTimeoutRef.current !== null) {
        window.clearTimeout(verificationTimeoutRef.current);
      }

      verificationResolverRef.current = resolve;
      setCandidateHtml(html);

      verificationTimeoutRef.current = window.setTimeout(() => {
        if (verificationResolverRef.current) {
          const pendingResolve = verificationResolverRef.current;
          verificationResolverRef.current = null;
          pendingResolve([]);
        }
      }, CANVAS_VERIFY_TIMEOUT_MS);
    });
  }, []);

  const runVerifiedGeneration = useCallback(
    async (createSession: () => Promise<LessonGenerationSession>): Promise<string> => {
      const { sessionId, html: initialHtml } = await createSession();
      let currentHtml = initialHtml;

      try {
        let errors = await verifyHtmlInCanvas(currentHtml);

        let attempt = 0;
        while (errors.length > 0 && attempt < MAX_REPAIR_ATTEMPTS) {
          attempt += 1;
          currentHtml = await repairLessonWithDiff(sessionId, errors);
          errors = await verifyHtmlInCanvas(currentHtml);
        }

        if (errors.length > 0) {
          throw new Error(
            `Verification failed after ${MAX_REPAIR_ATTEMPTS} repair attempts:\n${errors[0]}`
          );
        }

        return currentHtml;
      } finally {
        await closeLessonSession(sessionId);
      }
    },
    [verifyHtmlInCanvas]
  );

  // --- Handlers ---

  const handleInitialSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!initialTopic.trim()) return;

    setIsLoading(true);
    try {
      const topic = initialTopic.trim();
      const verifiedHtml = await runVerifiedGeneration(() =>
        startInitialLessonSession(topic, selectedTemplateFilename)
      );
      const newId = createGenerationId({});
      const newNode: PageNode = {
        id: newId,
        parentId: null,
        topic,
        htmlContent: verifiedHtml,
        childrenIds: [],
        timestamp: Date.now()
      };

      const initialMap = { [newId]: newNode };
      const runId = uuidv4();

      setNodeMap(initialMap);
      setCurrentNodeId(newId);
      setActiveRunId(runId);
      setCandidateHtml(null);

      // Save initial run and node to Database without blocking lesson display
      try {
        await syncRun(runId, topic, newId, newId, initialMap);
      } catch (syncErr) {
        console.error("Failed to sync initial run to DB:", syncErr);
      }
    } catch (err) {
      setCandidateHtml(null);
      console.error("Lesson generation failed:", err);
      alert("Failed to generate lesson. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleElementSelect = (selection: SelectionEvent) => {
    setPendingSelection(selection);
  };

  const handleInteractionSubmit = async (prompt: string, templateFilename: string) => {
    if (!currentNode || !pendingSelection) return;

    setIsLoading(true);
    setSelectedTemplateFilename(templateFilename);
    const selection = pendingSelection;
    setPendingSelection(null);
    setMode('browse'); // Reset mode while loading
    setWorkspaceView('lesson');

    try {
      const originalUserRequest = initialTopic.trim() || currentNode.topic;
      const verifiedHtml = await runVerifiedGeneration(() =>
        startFollowUpLessonSession(
          originalUserRequest,
          selection.htmlSnippet,
          prompt,
          templateFilename,
          currentNode.htmlContent
        )
      );
      const newId = createGenerationId(nodeMap);
      const resolvedTopic = prompt.trim() || `Deep Dive: ${selection.textSummary || selection.componentId}`;
      const newNode: PageNode = {
        id: newId,
        parentId: currentNode.id,
        topic: resolvedTopic,
        htmlContent: verifiedHtml,
        triggerContext: selection.htmlSnippet,
        triggerSummary: selection.textSummary,
        parentComponentId: selection.componentId,
        childrenIds: [],
        timestamp: Date.now()
      };

      const parent = nodeMap[currentNode.id];
      const updatedNodeMap = {
        ...nodeMap,
        [currentNode.id]: {
          ...parent,
          childrenIds: [...parent.childrenIds, newId]
        },
        [newId]: newNode
      };

      setNodeMap(updatedNodeMap);
      setCurrentNodeId(newId);
      setCandidateHtml(null);

      // Sync follow-up to DB if we have an active run
      if (activeRunId) {
        try {
          const rootId = Object.keys(updatedNodeMap).find(id => !updatedNodeMap[id].parentId) || null;
          await syncRun(activeRunId, initialTopic, rootId, newId, updatedNodeMap);
        } catch (syncErr) {
          console.error("Failed to sync follow-up run to DB:", syncErr);
        }
      }
    } catch (err) {
      setCandidateHtml(null);
      console.error("Follow-up generation failed:", err);
      alert("Failed to generate follow-up. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const navigateToBranch = async (nodeId: string) => {
    setCurrentNodeId(nodeId);
    setPendingSelection(null);
    setMode('browse');
    setWorkspaceView('lesson');

    // Sync path navigation to DB
    if (activeRunId) {
      try {
        const rootId = Object.keys(nodeMap).find(id => !nodeMap[id].parentId) || null;
        await syncRun(activeRunId, initialTopic, rootId, nodeId, nodeMap);
      } catch (err) {
        console.error("Failed to sync navigation in DB:", err);
      }
    }
  };

  const handleDeleteBranch = async (nodeId: string) => {
    if (!currentNodeId) return;

    const updated = { ...nodeMap };
    const nodeToDelete = updated[nodeId];
    if (nodeToDelete && nodeToDelete.parentId && updated[nodeToDelete.parentId]) {
      const parent = updated[nodeToDelete.parentId];
      updated[parent.id] = {
        ...parent,
        childrenIds: parent.childrenIds.filter(id => id !== nodeId)
      };
    }

    const deletedIds = collectBranchIds(nodeMap, nodeId);
    deletedIds.forEach(id => {
      delete updated[id];
    });

    let nextNodeId = currentNodeId;
    if (currentNodeId && deletedIds.has(currentNodeId)) {
      nextNodeId = nodeToDelete?.parentId || Object.keys(updated)[0] || null;
    }

    setNodeMap(updated);
    setCurrentNodeId(nextNodeId);

    // Sync branch deletion to DB
    if (activeRunId && nextNodeId) {
      try {
        const rootId = Object.keys(updated).find(id => !updated[id].parentId) || null;
        await syncRun(activeRunId, initialTopic, rootId, nextNodeId, updated);
      } catch (err) {
        console.error("Failed to sync deletion to DB:", err);
      }
    }
  };

  const handleBack = () => {
    if (currentNode?.parentId) {
      navigateToBranch(currentNode.parentId);
    }
  };

  const handleReset = () => {
    if (confirm("Are you sure you want to start over? Current session state in memory will be cleared.")) {
      setNodeMap({});
      setCurrentNodeId(null);
      setCandidateHtml(null);
      setInitialTopic('');
      setActiveRunId(null);
      setMode('browse');
      setWorkspaceView('lesson');
    }
  };

  const handleSelectRun = async (runId: string) => {
    setIsLoading(true);
    try {
      const data = await getRun(runId);
      setNodeMap(data.nodeMap);
      setCurrentNodeId(data.currentNodeId);
      setInitialTopic(data.title);
      setActiveRunId(data.id);
      setWorkspaceView('lesson');
      setMode('browse');
    } catch (err: any) {
      alert("Failed to load run: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartNewSession = () => {
    setNodeMap({});
    setCurrentNodeId(null);
    setCandidateHtml(null);
    setInitialTopic('');
    setActiveRunId(null);
    setMode('browse');
    setWorkspaceView('lesson');
  };

  const getExistingBranchesForSelection = useCallback(() => {
    if (!currentNode || !pendingSelection) return [];

    return currentNode.childrenIds
      .map(id => nodeMap[id])
      .filter((child): child is PageNode => !!child && isBranchForSelection(child, pendingSelection));
  }, [currentNode, pendingSelection, nodeMap]);

  const handleLessonMode = (nextMode: AppMode) => {
    setMode(nextMode);
    setWorkspaceView('lesson');
  };

  const handleToggleGraph = () => {
    setPendingSelection(null);
    setWorkspaceView(view => view === 'graph' ? 'lesson' : 'graph');
  };

  const handleOpenDatabase = () => {
    setPendingSelection(null);
    setWorkspaceView('db');
  };

  // --- Render ---

  // Render Database View
  if (workspaceView === 'db') {
    return (
      <div className="min-h-screen bg-[#0a0a0c] text-[#e2e8f0] font-sans">
        <DatabaseView
          currentRunId={activeRunId}
          onSelectRun={handleSelectRun}
          onClose={() => setWorkspaceView('lesson')}
          onStartNewSession={handleStartNewSession}
        />
      </div>
    );
  }

  // Guard: if no session OR if currentNode doesn't exist in map (and no candidateHtml is being verified), show landing page
  if ((!currentNodeId || !currentNode) && !candidateHtml) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0a0a0c] p-4 text-[#e2e8f0]">
        {isLoading && <GenerationOverlay title="Generating your first lesson" />}

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(0,229,153,0.08),transparent_38%)]" />
        
        {/* Top Right Navigation */}
        <div className="absolute right-6 top-6 flex items-center gap-3">
          <button
            onClick={handleOpenDatabase}
            className="flex items-center gap-2 rounded-full border border-[#2a2a35] bg-[#121217]/80 px-4 py-2.5 text-xs font-medium text-[#94a3b8] backdrop-blur-md transition-colors hover:border-[#00e599]/40 hover:text-[#00e599]"
          >
            <Database size={14} />
            Database
          </button>
        </div>

        <div className="relative w-full max-w-5xl space-y-8 py-8 text-center">
          <div className="space-y-6">
            <h1 className="text-5xl font-semibold tracking-[-0.05em] text-[#e2e8f0] sm:text-6xl">
              GenLearn
            </h1>
          </div>

          <form onSubmit={handleInitialSubmit} className="relative mx-auto w-full max-w-3xl rounded-full border border-[#2a2a35] bg-[#121217] p-2 text-left shadow-[0_24px_80px_rgba(0,0,0,0.38)] focus-within:border-[#00e599]/50">
            <input
              type="text"
              value={initialTopic}
              onChange={(e) => setInitialTopic(e.target.value)}
              placeholder="e.g. Quantum Entanglement, French Revolution, React Hooks..."
              className="w-full rounded-full bg-transparent py-3.5 pl-5 pr-16 text-base text-[#e2e8f0] outline-none placeholder:text-[#64748b]"
              disabled={isLoading}
            />
            <button
              type="submit"
              className="absolute right-2 top-2.5 flex h-11 w-11 items-center justify-center rounded-full bg-[#00e599] text-[#0a0a0c] transition-all hover:bg-[#4dffc1] disabled:cursor-not-allowed disabled:opacity-40"
              disabled={isLoading || !initialTopic.trim()}
            >
              <ArrowRight size={19} />
            </button>
          </form>

          <LessonTemplateGallery
            selectedFilename={selectedTemplateFilename}
            onSelect={setSelectedTemplateFilename}
            disabled={isLoading}
          />
        </div>
      </div>
    );
  }

  const activeHtml = candidateHtml ?? currentNode?.htmlContent ?? '';

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-[#e2e8f0] font-sans">
      {isLoading && (
        <GenerationOverlay
          title={currentNode ? 'Generating recursive lesson' : 'Generating your first lesson'}
        />
      )}

      {workspaceView === 'graph' && currentNode && !candidateHtml ? (
        <GraphView
          nodeMap={nodeMap}
          currentNodeId={currentNode.id}
          onOpenGeneration={navigateToBranch}
        />
      ) : (
        <GenerativeCanvas
          htmlContent={activeHtml}
          mode={mode}
          onElementSelect={handleElementSelect}
          onVerificationResult={handleCanvasVerificationResult}
        />
      )}

      {currentNode && (
        <FloatingControls
          mode={mode}
          setMode={handleLessonMode}
          workspaceView={workspaceView}
          onToggleGraph={handleToggleGraph}
          canGoBack={!!currentNode.parentId}
          onBack={handleBack}
          title={currentNode.topic}
          onReset={handleReset}
          onOpenDatabase={handleOpenDatabase}
        />
      )}

      {workspaceView === 'lesson' && currentNode && pendingSelection && (
        <InteractionModal
          selection={pendingSelection}
          onClose={() => setPendingSelection(null)}
          onSubmit={handleInteractionSubmit}
          initialTemplateFilename={selectedTemplateFilename}
          existingBranches={getExistingBranchesForSelection()}
          onNavigateToBranch={navigateToBranch}
          onDeleteBranch={handleDeleteBranch}
        />
      )}
    </div>
  );
};

export default App;
