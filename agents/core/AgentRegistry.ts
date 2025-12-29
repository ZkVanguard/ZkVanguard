/**
 * @fileoverview Agent Registry for managing all agents in the system
 * @module agents/core/AgentRegistry
 */

import { EventEmitter } from 'eventemitter3';
import { BaseAgent } from './BaseAgent';
import { logger } from '@shared/utils/logger';
import { AgentType, AgentStatus } from '@shared/types/agent';

/**
 * Agent Registry class for agent discovery and management
 */
export class AgentRegistry extends EventEmitter {
  private agents: Map<string, BaseAgent>;
  private agentsByType: Map<AgentType, BaseAgent[]>;

  constructor() {
    super();
    this.agents = new Map();
    this.agentsByType = new Map();
  }

  /**
   * Register an agent
   */
  register(agent: BaseAgent): void {
    const status = agent.getStatus();
    this.agents.set(status.id, agent);

    // Add to type map
    const typeAgents = this.agentsByType.get(status.type as AgentType) || [];
    typeAgents.push(agent);
    this.agentsByType.set(status.type as AgentType, typeAgents);

    logger.info('Agent registered', {
      agentId: status.id,
      agentName: status.name,
      agentType: status.type,
    });

    this.emit('agent-registered', { agentId: status.id, agent });
  }

  /**
   * Unregister an agent
   */
  unregister(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    const status = agent.getStatus();
    this.agents.delete(agentId);

    // Remove from type map
    const typeAgents = this.agentsByType.get(status.type as AgentType) || [];
    const filtered = typeAgents.filter((a) => a.getStatus().id !== agentId);
    this.agentsByType.set(status.type as AgentType, filtered);

    logger.info('Agent unregistered', {
      agentId: status.id,
      agentName: status.name,
    });

    this.emit('agent-unregistered', { agentId: status.id });
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): BaseAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get agents by type
   */
  getAgentsByType(type: AgentType): BaseAgent[] {
    return this.agentsByType.get(type) || [];
  }

  /**
   * Get first available agent of a type
   */
  getAgentByType(type: AgentType): BaseAgent | undefined {
    const agents = this.getAgentsByType(type);
    return agents.find((agent) => agent.getStatus().status === 'idle') || agents[0];
  }

  /**
   * Get all agents
   */
  getAllAgents(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agent statuses
   */
  getAgentStatuses(): Array<{
    id: string;
    name: string;
    type: string;
    status: AgentStatus;
    queueLength: number;
    currentTask: string | null;
    executionHistoryCount: number;
    capabilities: string[];
  }> {
    return this.getAllAgents().map((agent) => agent.getStatus());
  }

  /**
   * Check if agent exists
   */
  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * Get agent count
   */
  getAgentCount(): number {
    return this.agents.size;
  }

  /**
   * Find agents by capability
   */
  findAgentsByCapability(capability: string): Array<{ agentId: string; name: string; capabilities: string[] }> {
    return this.getAllAgents()
      .filter((agent) => agent.getCapabilities().includes(capability))
      .map((agent) => {
        const status = agent.getStatus();
        return {
          agentId: status.id,
          name: status.name,
          capabilities: status.capabilities,
        };
      });
  }

  /**
   * Find agents by type name
   */
  findAgentsByType(typeName: string): Array<{ agentId: string; name: string; type: string }> {
    return this.getAllAgents()
      .filter((agent) => agent.getStatus().name === typeName || agent.getStatus().type === typeName.toLowerCase().replace('agent', ''))
      .map((agent) => {
        const status = agent.getStatus();
        return {
          agentId: status.id,
          name: status.name,
          type: status.type,
        };
      });
  }

  /**
   * Shutdown all agents
   */
  async shutdownAll(): Promise<void> {
    logger.info('Shutting down all agents');
    
    const shutdownPromises = this.getAllAgents().map((agent) => agent.shutdown());
    await Promise.all(shutdownPromises);
    
    this.agents.clear();
    this.agentsByType.clear();
    
    logger.info('All agents shut down');
  }
}
