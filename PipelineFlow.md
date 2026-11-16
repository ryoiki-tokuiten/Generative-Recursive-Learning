# GenLearn System Architecture & Pipeline Flow

GenLearn is a recursive, branching educational platform. Instead of giving you a static article or a linear chat thread, it generates a complete, standalone interactive web application (HTML, CSS, React, 2D/3D canvases, simulations) for whatever topic you want to learn.

When you see a specific diagram, formula, or visual block inside a lesson that you want to understand more deeply, you switch to **Interactive Mode** and click directly on that element. The system captures the exact DOM fragment you clicked, pairs it with the parent page and root topic, and generates a brand-new standalone lesson that zooms into that exact mechanism—forming an infinite, navigable **tree of lessons**.

---

## 1. High-Level End-to-End Pipeline

```text
[User Enters Topic + Picks Visual Template]
                  │
                  ▼
      [Prompt Assembly Layer]
  (System Taste + Template HTML + Task Context)
                  │
                  ▼
     [LLM Chat Session (Gemini)]
  (Generates standalone zero-build HTML/React app)
                  │
                  ▼
   [Canvas Verification & Repair Loop] ◄───────────────┐
  (Mounts HTML in sandboxed iframe & listens           │
   for runtime/transpilation errors; ignores           │ Up to 3 attempts
   warnings/logs)                                      │ in the SAME chat
                  │                                    │ (preserves KV cache)
         ┌────────┴────────┐                           │
         │ No Errors       │ Direct Console Error      │
         ▼                 ▼                           │
  [Commit PageNode]   [Send Error Stack in Same Chat]  │
         │                 │                           │
         │                 ▼                           │
         │            [LLM Outputs JSON Diff Patch] ───┘
         │                 │ (If 3rd attempt fails -> Hard Fail)
         ▼
   [Update Session Tree (`NodeMap`)]
  (Assign `gen-XXX` ID, link to parent & component)
         │
         ▼
   [Sync to Persistence Layer]
  (PostgreSQL `runs` + `nodes` tables, or `.data/runs.json`)
```

---

## 2. Step-by-Step Pipeline Breakdown

### Step 1: Entry & Template Selection
A learning session (called a **Run**) starts on the landing screen:
1. **Topic Input**: You type a subject (e.g., *"Markov Chain Monte Carlo"*, *"How B-Trees Work"*, *"Diffusion as Gradient Ascent"*).
2. **Template Selection**: You choose a reference HTML design shell from `services/prompts/templates/*.html` (such as `Standard-2.html`, `Anthropic-1.html`, `Apple-1.html`, `Graph.html`, `visuals-focused.html`, etc.).
   - Each template is paired with a preview thumbnail (`.svg`) displayed in the `LessonTemplateGallery`.
   - The chosen template acts **strictly as a visual and structural blueprint** (defining CSS variables, typography, split-pane or scrollytelling layout, and control styles). The LLM is instructed to strip out 100% of the template's sample text/charts and replace them with bespoke interactive simulations tailored to your topic.

---

### Step 2: Prompt Assembly (`services/prompts/index.ts`)
Before calling the model, the frontend builds a structured prompt composed of three distinct blocks:

1. **Core System Instructions (`services/prompts/prompt.md`)**:
   - **Pedagogy & Writing Taste**: Enforces a compressed, high-signal, intuition-first writing style (2–4 sentence blocks, zero fluff, building concepts from scratch before showing formulas).
   - **Modern Browser ESM Architecture**: Instructs the model to output a single zero-build-step HTML file using `<script type="importmap">` (configured with Singleton React 18.3.1, Lucide icons, Three.js / React Three Fiber, D3, Framer Motion, Recharts, KaTeX, Pyodide, etc.) and `<script type="text/babel" data-type="module" data-presets="react">`.
2. **Task Context (`<Lesson_Request_Context>`)**:
   - **For the Root Lesson (`<Initial_Lesson_Task>`)**: Contains the user's original topic request and instructions to teach it from first principles.
   - **For a Recursive Child Lesson (`<Follow_Up_Progression_Task>` + `<Follow_Up_Context>`)**: Packages four pieces of context so the model knows both the big picture and the exact microscope target:
     1. `Original user request` (the root topic of the entire session)
     2. `User clicked on` (the exact `outerHTML` of the DOM block the user clicked)
     3. `Previous Full HTML File` (the complete source code of the parent lesson page)
     4. `User's_Recursive_Prompt` (the user's custom question, or the automatic deep-dive harness instruction if the user left the prompt blank)
3. **Reference Template (`<selected-template-html>`)**:
   - The raw HTML source of the selected template file so the model matches its layout architecture and styling primitives.

---

### Step 3: LLM Generation & Same-Chat Verification Loop

Once the prompt is assembled, it is sent to the backend (`/api/gemini/generate`), which creates a stateful chat session (`ai.chats.create`) with the configured model (`gemini-3.5-flash-lite` with high thinking budget and 65,536 max output tokens), strips markdown fences (` ```html `) from the returned document, and returns `{ sessionId, html }`.

Because every generated lesson is a full React/ESM/WebGL application compiled in-browser by `@babel/standalone`, a single syntax error, bad import, or undefined variable can break the page. To prevent broken lessons from reaching the user, the pipeline runs the output directly through the **real `GenerativeCanvas` iframe** and executes a **Same-Chat JSON-Diff Repair Loop**:

1. **Real Canvas Mounting & Error Interception (`components/GenerativeCanvas.tsx`)**:
   - The candidate HTML is mounted directly in the live `GenerativeCanvas` iframe.
   - An error interceptor script injected at the top of `<head>` hooks into `console.error`, `window.addEventListener('error', ..., true)`, and `window.addEventListener('unhandledrejection')` before Babel, importmaps, or user modules execute.
   - **Noise Filtering**: Standard `console.warn`, `console.log`, and non-fatal dev notices are ignored. If no direct errors occur once the page and its ESM modules mount, the canvas posts `CANVAS_VERIFICATION_RESULT` with `errors: []` and the lesson is committed immediately without any extra LLM calls.
2. **Same-Chat JSON Diff Repair (`services/geminiServer.ts`)**:
   - When the canvas catches one or more direct errors, the frontend sends `{ sessionId, errors }` to `POST /api/gemini/repair`.
   - The server sends the captured console errors in the **exact same `Chat` instance**.
   - **No Structured Output Schema Mutation**: We intentionally do not enable `responseSchema` or `responseMimeType` on repair turns; mutating the generation schema alters the underlying system prompt and invalidates the provider's KV prefix cache. Instead, the prompt directly instructs the model to output a raw JSON array of `{ "search": "...", "replace": "..." }` diff operations.
   - **In-Chat Diff Parse & Match Recovery**: The server parses the JSON array and applies each exact `"search"` -> `"replace"` edit sequentially to the session's current HTML (`applyJsonDiffToHtml`). If the output has invalid JSON syntax, a bad diff shape, or a `"search"` string that is not found in the current HTML, the server does not restart the run—it sends that exact parse/match error back in the next message of the same chat so the model can immediately emit a corrected diff.
3. **Retry Budget (Max 3 Attempts) & Hard Fail**:
   - Each patched HTML string is returned to the frontend and re-verified in the real `GenerativeCanvas`.
   - This canvas verification and JSON-diff repair cycle runs **up to 3 times back and forth**.
   - **Strict Hard Fail**: If the page still throws console errors after 3 repair attempts (or if the model fails to produce a valid applicable diff), the session is closed and the pipeline fails literally rather than falling back to broken HTML.

---

## 3. Interactive Selection & Deterministic Component IDs

When a verified lesson is displayed in `GenerativeCanvas.tsx`, the system injects a small interaction script right before `</body>`.

The canvas operates in one of two modes controlled via `window.postMessage`:
- **Browse Mode (`mode = 'browse'`)**: The iframe behaves like a normal interactive website. You can drag sliders, scrub timelines, switch tabs, and orbit 3D scenes.
- **Interactive Mode (`mode = 'interactive'`)**: The injected script intercepts mouse hover and click events in the capture phase:
  1. **Semantic Block Traversal (`getTargetBlock`)**: When you hover or click on a deeply nested element (like a `<span>` or `<svg>`), the script walks up the DOM tree to find the nearest meaningful container (`SECTION`, `ARTICLE`, `DIV`, `MAIN`, `ASIDE`, or `FIGURE`) below `document.body` and highlights it with an indigo outline (`.interactive-hover`).
  2. **Deterministic Component ID Generation (`getComponentId`)**:
     - To track which part of a page spawned which child lessons, the script computes a stable, deterministic ID for the clicked DOM block without requiring the LLM to pre-assign IDs.
     - It walks from the clicked element up to `document.body`, recording each ancestor's tag name and 1-based sibling index (e.g., `main-01-section-02-div-03`).
     - It hashes this structural DOM path into a 5-character base-36 string and combines it with a sanitized semantic name from the element's `id`, `aria-label`, or tag name:
       ```text
       cmp-section-00k4z
       ```
  3. **PostMessage Payload (`SelectionEvent`)**:
     - Clicking the highlighted block prevents default page behavior and posts an `ELEMENT_SELECTED` message to the parent React app containing:
       - `componentId`: The deterministic ID (e.g., `cmp-section-00k4z`)
       - `htmlSnippet`: The clean `outerHTML` of the selected container
       - `textSummary`: The first 150 characters of `innerText` for UI previews

---

## 4. Tree Architecture, Recursion & Branch Management

GenLearn represents your entire learning session in memory as a flat dictionary (`NodeMap`) of `PageNode` objects that form a directed tree (and visually render as a bipartite graph).

### Data Structure (`types.ts`)
Each generated lesson page is a `PageNode`:
```ts
interface PageNode {
  id: string;                 // Sequential generation ID: "gen-001", "gen-002", ...
  parentId: string | null;    // null for the root lesson; parent's "gen-XXX" ID for children
  topic: string;              // Topic title or user's follow-up prompt
  htmlContent: string;        // Complete standalone HTML document
  triggerContext?: string;    // Exact outerHTML of the DOM block clicked in the parent page
  triggerSummary?: string;    // 150-char text preview of the clicked DOM block
  parentComponentId?: string; // Deterministic componentId ("cmp-...") that spawned this node
  childrenIds: string[];      // Array of child generation IDs spawned from this page
  timestamp: number;          // Creation time (ms)
}
```

### How Recursion & Multi-Branching Work
1. **Root Generation (`gen-001`)**:
   - Created from the landing page prompt. Its `parentId` is `null` and `childrenIds` is `[]`.
2. **Spawning a Child Branch (`gen-002`)**:
   - While viewing `gen-001`, you switch to Interactive Mode and click a visual card (`cmp-div-01a9f`).
   - `InteractionModal` opens. You can either type a specific question (e.g., *"Derive why the error scales as 1/sqrt(N)"*) or leave the input blank.
   - If left blank, the system automatically injects `DEFAULT_FOLLOW_UP_HARNESS_MESSAGE`, instructing the LLM to unpack whatever was treated as a black box inside that clicked element.
   - Once generated and verified, `gen-002` is added to `nodeMap` with `parentId: "gen-001"` and `parentComponentId: "cmp-div-01a9f"`, and `"gen-002"` is appended to `gen-001.childrenIds`.
3. **Multiple Branches from the Same Component**:
   - If you return to `gen-001` and click that **same** component (`cmp-div-01a9f`) again, `App.tsx` checks `isBranchForSelection()` (matching `child.parentComponentId === selection.componentId`).
   - `InteractionModal` detects that this component already has existing explorations and opens the **Previous Explorations** view first—letting you jump straight into an existing child branch, delete an old branch, or click **Start New Exploration** to fork a second sibling branch (`gen-003`) from the exact same component (for example, using a different visual template or asking a different question).
4. **Infinite Depth**:
   - Every child page (`gen-002`, `gen-003`, ...) is rendered inside the exact same `GenerativeCanvas` with the same injected selection script. You can click any element inside `gen-002` to spawn `gen-004`, recursing as many levels deep as you want.

### Bipartite Graph Visualization (`components/GraphView.tsx`)
When you toggle the **Graph View**, `buildGraph()` transforms the `NodeMap` into a two-layer (bipartite) tree laid out top-to-bottom via **Dagre** (`@dagrejs/dagre`) and rendered with **React Flow** (`@xyflow/react`):

```text
          ┌────────────────────────────┐
          │   GEN-001 (Root Lesson)    │
          │ "Markov Chain Monte Carlo" │
          └──────┬──────────────┬──────┘
                 │              │
                 ▼              ▼
      ┌──────────────────┐   ┌──────────────────┐
      │ Component Node   │   │ Component Node   │
      │ cmp-div-01a9f    │   │ cmp-section-04b2 │
      │ (2 generations)  │   │ (1 generation)   │
      └───┬──────────┬───┘   └────────┬─────────┘
          │          │                │
          ▼          ▼                ▼
   ┌───────────┐  ┌───────────┐  ┌───────────┐
   │  GEN-002  │  │  GEN-003  │  │  GEN-004  │
   └───────────┘  └─────┬─────┘  └───────────┘
                        │
                        ▼
               ┌──────────────────┐
               │ Component Node   │
               │ cmp-figure-09x1  │
               └────────┬─────────┘
                        │
                        ▼
                  ┌───────────┐
                  │  GEN-005  │
                  └───────────┘
```

- **Generation Cards (`generation::gen-XXX`)**: Represent full standalone HTML lessons. Clicking one in the graph previews its live interactive iframe or syntax-highlighted HTML source on the right panel, with an **Open** button to jump the main workspace directly to that lesson.
- **Component Cards (`component::gen-XXX::cmp-YYY`)**: Inserted between a parent generation and its child generations. All sibling branches spawned from the same DOM element are grouped under a single Component Card. Clicking a Component Card wraps its captured `triggerContext` (`outerHTML` snippet) in a standalone dark-mode Tailwind preview document so you can inspect the exact UI element that triggered those branches.

### Recursive Subtree Deletion (`collectBranchIds`)
When you delete a branch from the `InteractionModal`:
1. `collectBranchIds(nodeMap, nodeId)` performs a depth-first traversal starting at `nodeId` to collect `nodeId` and **all of its descendants** at every depth below it.
2. The target `nodeId` is removed from its parent's `childrenIds` array.
3. Every collected descendant ID is deleted from `nodeMap`.
4. If your currently active view was inside the deleted subtree, focus automatically steps back to the parent node.

---

## 5. Persistence & Database Synchronization (`services/dbServer.ts`)

Every time a lesson is generated, a branch is navigated, or a subtree is deleted, the frontend calls `syncRun(runId, title, rootNodeId, currentNodeId, nodeMap)` (`POST /api/runs/:id/sync`).

### Dual-Storage Engine (PostgreSQL + Automatic Local JSON Fallback)
The server (`server.ts` + `services/dbServer.ts`) supports two storage backends seamlessly:
1. **Primary — PostgreSQL (`DATABASE_URL`)**:
   - Uses two relational tables initialized on server startup (`initDb()`):
     - `runs`: Stores session metadata (`id` UUID, `title`, `root_node_id`, `current_node_id`, `created_at`, `updated_at`).
     - `nodes`: Stores every `PageNode` in the tree (`id`, `run_id` foreign key with `ON DELETE CASCADE`, `parent_id`, `topic`, `html_content`, `trigger_context`, `trigger_summary`, `parent_component_id`, `children_ids` as `JSONB`, and `timestamp`).
   - **Global ID Namespacing (`toDbId` / `fromDbId`)**:
     - Inside the frontend, every session numbers its nodes starting from `gen-001`.
     - When saving to PostgreSQL, `dbServer.ts` prefixes every node ID, parent ID, and child ID with the run's UUID (`<runId>::gen-001`) so node primary keys never collide across different runs. When loading a run back via `GET /api/runs/:id`, `fromDbId()` strips the `<runId>::` prefix so the frontend works with clean `gen-001` IDs.
   - **Transactional Graph Sync**:
     - Each `syncRun` executes inside a single SQL transaction (`BEGIN` ... `COMMIT`): it upserts the `runs` row, upserts all current `nodes` in `nodeMap`, and executes a `DELETE FROM nodes WHERE run_id = $1 AND id NOT IN (...)` to prune any branches that were deleted in the UI.
2. **Fallback — Local JSON File Store (`.data/runs.json`)**:
   - If `DATABASE_URL` is not configured or if PostgreSQL becomes unreachable, `dbServer.ts` automatically falls back to reading and writing the full run records (including `nodeMap`) to `.data/runs.json` on disk without interrupting the user's session.
