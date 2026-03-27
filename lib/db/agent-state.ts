/**
 * Agent Orchestrator State Persistence
 * 
 * Persists critical agent state to DB so it survives Vercel cold starts.
 * This is NOT a full state backup — only the data needed for warm restarts:
 * - Last risk assessment results
 * - Agent initialization timestamps
 * - Last known market context summary
 */

import { query, queryOne } from './postgres';
import { logger } from '@/lib/utils/logger';

interface AgentStateRecord {
  last_risk_assessment: {
    riskScore: number;
    drawdownPercent: number;
    volatility: number;
    recommendations: number;
    timestamp: string;
  } | null;
  last_snapshot_summary: {
    btcPrice: number;
    ethPrice: number;
    suiPrice: number;
    croPrice: number;
    timestamp: number;
  } | null;
  initialized_at: string;
  agents_active: string[];
}

/**
 * Ensure the agent_orchestrator_state table exists
 */
async function ensureAgentStateTable(): Promise<void> {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS agent_orchestrator_state (
        id INTEGER PRIMARY KEY DEFAULT 1,
        last_risk_assessment JSONB,
        last_snapshot_summary JSONB,
        initialized_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        agents_active JSONB DEFAULT '[]',
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT single_agent_state CHECK (id = 1)
      )
    `);
  } catch (err) {
    // Table may already exist
    logger.debug('[AgentState] Table ensure completed', { err });
  }
}

/**
 * Save orchestrator state to DB (called after initialization and after each risk cycle)
 */
export async function saveAgentState(state: Partial<AgentStateRecord>): Promise<void> {
  try {
    await ensureAgentStateTable();
    await query(`
      INSERT INTO agent_orchestrator_state (id, last_risk_assessment, last_snapshot_summary, initialized_at, agents_active, updated_at)
      VALUES (1, $1, $2, $3, $4, NOW())
      ON CONFLICT (id) DO UPDATE SET
        last_risk_assessment = COALESCE($1, agent_orchestrator_state.last_risk_assessment),
        last_snapshot_summary = COALESCE($2, agent_orchestrator_state.last_snapshot_summary),
        initialized_at = COALESCE($3, agent_orchestrator_state.initialized_at),
        agents_active = COALESCE($4, agent_orchestrator_state.agents_active),
        updated_at = NOW()
    `, [
      state.last_risk_assessment ? JSON.stringify(state.last_risk_assessment) : null,
      state.last_snapshot_summary ? JSON.stringify(state.last_snapshot_summary) : null,
      state.initialized_at || new Date().toISOString(),
      state.agents_active ? JSON.stringify(state.agents_active) : null,
    ]);
  } catch (err) {
    logger.warn('[AgentState] Failed to save state', { err });
  }
}

/**
 * Load last known orchestrator state from DB (called on cold start)
 */
export async function loadAgentState(): Promise<AgentStateRecord | null> {
  try {
    await ensureAgentStateTable();
    const row = await queryOne(`SELECT * FROM agent_orchestrator_state WHERE id = 1`) as Record<string, unknown> | null;
    if (!row) return null;
    
    return {
      last_risk_assessment: row.last_risk_assessment as AgentStateRecord['last_risk_assessment'],
      last_snapshot_summary: row.last_snapshot_summary as AgentStateRecord['last_snapshot_summary'],
      initialized_at: String(row.initialized_at || ''),
      agents_active: (row.agents_active as string[]) || [],
    };
  } catch (err) {
    logger.warn('[AgentState] Failed to load state', { err });
    return null;
  }
}
