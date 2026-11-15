import fs from 'fs/promises';
import path from 'path';
import pg from 'pg';
import type { PageNode } from '../types.ts';

const { Pool } = pg;

interface StoredRunRecord {
  id: string;
  title: string;
  rootNodeId: string | null;
  currentNodeId: string | null;
  createdAt: string;
  updatedAt: string;
  nodeMap: { [id: string]: PageNode };
}

interface LocalDbStore {
  runs: { [runId: string]: StoredRunRecord };
}

const LOCAL_STORE_PATH = path.resolve(process.cwd(), '.data', 'runs.json');

let pool: pg.Pool | null = null;
let usePostgres = false;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: false,
      connectionTimeoutMillis: 2500,
    });
  }
  return pool;
}

async function readLocalStore(): Promise<LocalDbStore> {
  try {
    const raw = await fs.readFile(LOCAL_STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.runs) {
      return parsed as LocalDbStore;
    }
  } catch {
    // File does not exist or is invalid yet
  }
  return { runs: {} };
}

async function writeLocalStore(store: LocalDbStore): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_STORE_PATH), { recursive: true });
  await fs.writeFile(LOCAL_STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

// Helper functions to map local frontend node IDs to globally unique database IDs
function toDbId(runId: string, nodeId: string | null): string | null {
  if (!nodeId) return null;
  if (nodeId.startsWith(`${runId}::`)) return nodeId;
  return `${runId}::${nodeId}`;
}

function fromDbId(runId: string, nodeId: string | null): string | null {
  if (!nodeId) return null;
  const prefix = `${runId}::`;
  if (nodeId.startsWith(prefix)) {
    return nodeId.slice(prefix.length);
  }
  return nodeId;
}

// Initialize database tables or fallback file store
export async function initDb() {
  if (!process.env.DATABASE_URL) {
    usePostgres = false;
    await writeLocalStore(await readLocalStore());
    console.log('[Database] No DATABASE_URL set; initialized local JSON store at .data/runs.json');
    return;
  }

  let client: pg.PoolClient | null = null;
  try {
    client = await getPool().connect();
    await client.query('BEGIN');

    // Create runs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS runs (
        id UUID PRIMARY KEY,
        title TEXT NOT NULL,
        root_node_id VARCHAR(255),
        current_node_id VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create nodes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS nodes (
        id VARCHAR(255) PRIMARY KEY,
        run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        parent_id VARCHAR(255),
        topic TEXT NOT NULL,
        html_content TEXT NOT NULL,
        trigger_context TEXT,
        trigger_summary TEXT,
        parent_component_id TEXT,
        children_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        timestamp BIGINT NOT NULL
      );
    `);

    // Create performance index
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_nodes_run_id ON nodes(run_id);
    `);

    await client.query('COMMIT');
    usePostgres = true;
    console.log('[Database] PostgreSQL tables initialized successfully');
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    usePostgres = false;
    await writeLocalStore(await readLocalStore());
    console.warn('[Database] PostgreSQL unavailable, falling back to local JSON store:', (error as Error).message);
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Fetch all runs with count of nodes in them
export async function getAllRuns() {
  if (usePostgres) {
    try {
      const queryText = `
        SELECT r.id, r.title, r.root_node_id, r.current_node_id, r.created_at, r.updated_at,
               COUNT(n.id)::int as node_count
        FROM runs r
        LEFT JOIN nodes n ON r.id = n.run_id
        GROUP BY r.id
        ORDER BY r.updated_at DESC;
      `;
      const res = await getPool().query(queryText);
      return res.rows;
    } catch (error) {
      usePostgres = false;
      console.warn('[Database] Postgres query failed in getAllRuns, switching to local store:', (error as Error).message);
    }
  }

  const store = await readLocalStore();
  return Object.values(store.runs)
    .map((run) => ({
      id: run.id,
      title: run.title,
      root_node_id: run.rootNodeId,
      current_node_id: run.currentNodeId,
      created_at: run.createdAt,
      updated_at: run.updatedAt,
      node_count: Object.keys(run.nodeMap || {}).length,
    }))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

// Fetch a single run with all of its nodes built into a NodeMap
export async function getRun(runId: string) {
  if (usePostgres) {
    try {
      const runRes = await getPool().query('SELECT * FROM runs WHERE id = $1', [runId]);
      if (runRes.rows.length === 0) {
        return null;
      }

      const run = runRes.rows[0];
      const nodesRes = await getPool().query('SELECT * FROM nodes WHERE run_id = $1', [runId]);

      const nodeMap: { [id: string]: PageNode } = {};
      for (const row of nodesRes.rows) {
        const localId = fromDbId(runId, row.id) as string;
        const localParentId = fromDbId(runId, row.parent_id);
        const localChildrenIds = Array.isArray(row.children_ids)
          ? row.children_ids.map((id: string) => fromDbId(runId, id) as string)
          : [];

        nodeMap[localId] = {
          id: localId,
          parentId: localParentId,
          topic: row.topic,
          htmlContent: row.html_content,
          triggerContext: row.trigger_context || undefined,
          triggerSummary: row.trigger_summary || undefined,
          parentComponentId: row.parent_component_id || undefined,
          childrenIds: localChildrenIds,
          timestamp: Number(row.timestamp),
        };
      }

      return {
        id: run.id,
        title: run.title,
        rootNodeId: fromDbId(runId, run.root_node_id),
        currentNodeId: fromDbId(runId, run.current_node_id),
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        nodeMap,
      };
    } catch (error) {
      usePostgres = false;
      console.warn('[Database] Postgres query failed in getRun, switching to local store:', (error as Error).message);
    }
  }

  const store = await readLocalStore();
  return store.runs[runId] || null;
}

// Sync run metadata and all node elements in the graph
export async function syncRun(
  runId: string,
  title: string,
  rootNodeId: string | null,
  currentNodeId: string | null,
  nodeMap: { [id: string]: PageNode }
) {
  if (usePostgres) {
    let client: pg.PoolClient | null = null;
    try {
      client = await getPool().connect();
      await client.query('BEGIN');

      const dbRootNodeId = toDbId(runId, rootNodeId);
      const dbCurrentNodeId = toDbId(runId, currentNodeId);

      // 1. Upsert run metadata
      const upsertRunQuery = `
        INSERT INTO runs (id, title, root_node_id, current_node_id, updated_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          root_node_id = EXCLUDED.root_node_id,
          current_node_id = EXCLUDED.current_node_id,
          updated_at = CURRENT_TIMESTAMP;
      `;
      await client.query(upsertRunQuery, [runId, title, dbRootNodeId, dbCurrentNodeId]);

      // 2. Upsert each node in the nodeMap
      const nodeIds = Object.keys(nodeMap);
      const dbNodeIds: string[] = [];

      for (const id of nodeIds) {
        const node = nodeMap[id];
        const dbId = toDbId(runId, node.id) as string;
        dbNodeIds.push(dbId);

        const dbParentId = toDbId(runId, node.parentId);
        const dbChildrenIds = node.childrenIds.map((childId) => toDbId(runId, childId) as string);

        const upsertNodeQuery = `
          INSERT INTO nodes (
            id, run_id, parent_id, topic, html_content, 
            trigger_context, trigger_summary, parent_component_id, 
            children_ids, timestamp
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (id) DO UPDATE SET
            parent_id = EXCLUDED.parent_id,
            topic = EXCLUDED.topic,
            html_content = EXCLUDED.html_content,
            trigger_context = EXCLUDED.trigger_context,
            trigger_summary = EXCLUDED.trigger_summary,
            parent_component_id = EXCLUDED.parent_component_id,
            children_ids = EXCLUDED.children_ids,
            timestamp = EXCLUDED.timestamp;
        `;
        await client.query(upsertNodeQuery, [
          dbId,
          runId,
          dbParentId,
          node.topic,
          node.htmlContent,
          node.triggerContext || null,
          node.triggerSummary || null,
          node.parentComponentId || null,
          JSON.stringify(dbChildrenIds),
          node.timestamp,
        ]);
      }

      // 3. Delete any nodes that exist in DB but are no longer in frontend's nodeMap
      if (dbNodeIds.length > 0) {
        const deleteQuery = `
          DELETE FROM nodes 
          WHERE run_id = $1 AND id NOT IN (${dbNodeIds.map((_, i) => `$${i + 2}`).join(', ')});
        `;
        await client.query(deleteQuery, [runId, ...dbNodeIds]);
      } else {
        await client.query('DELETE FROM nodes WHERE run_id = $1;', [runId]);
      }

      await client.query('COMMIT');
      return { success: true };
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }
      usePostgres = false;
      console.warn(`[Database] Postgres error syncing run ${runId}, switching to local store:`, (error as Error).message);
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  const store = await readLocalStore();
  const nowIso = new Date().toISOString();
  const existing = store.runs[runId];
  store.runs[runId] = {
    id: runId,
    title,
    rootNodeId,
    currentNodeId,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
    nodeMap: nodeMap || {},
  };
  await writeLocalStore(store);
  return { success: true };
}

// Delete a run (cascade will delete its nodes)
export async function deleteRun(runId: string) {
  if (usePostgres) {
    try {
      const res = await getPool().query('DELETE FROM runs WHERE id = $1', [runId]);
      return { success: res.rowCount !== 0 };
    } catch (error) {
      usePostgres = false;
      console.warn(`[Database] Postgres error deleting run ${runId}, switching to local store:`, (error as Error).message);
    }
  }

  const store = await readLocalStore();
  const existed = Boolean(store.runs[runId]);
  delete store.runs[runId];
  await writeLocalStore(store);
  return { success: existed };
}
