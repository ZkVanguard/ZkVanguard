/**
 * @fileoverview Base Agent abstract class for all specialized agents
 * @module agents/core/BaseAgent
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@shared/utils/logger';
import { AgentConfig, AgentStatus, AgentMessage, AgentTask, AgentType, TaskResult } from '@shared/types/agent';

/**
 * Abstract base class for all agents in the system
 * Provides common functionality for agent communication, state management, and lifecycle
 */
export abstract class BaseAgent extends EventEmitter {
  protected id: string;
  protected agentId: string; // Alias for specialized agents
  protected name: string;
  protected type: string;
  protected status: AgentStatus;
  protected config: AgentConfig;
  protected capabilities: string[];
  protected messageBus: EventEmitter;

  protected taskQueue: AgentTask[] = [];
  protected currentTask: AgentTask | null = null;
  protected executionHistory: AgentTask[] = [];

  // Overloaded constructor to support both patterns
  constructor(name: string, type: string, config: AgentConfig, messageBus: EventEmitter);
  constructor(agentId: string, name: string, capabilities: string[]);
  constructor(
    nameOrId: string,
    typeOrName: string,
    configOrCapabilities?: AgentConfig | string[],
    messageBus?: EventEmitter
  ) {
    super();
    
    // Detect which constructor pattern is being used
    if (messageBus && typeof configOrCapabilities === 'object' && !Array.isArray(configOrCapabilities)) {
      // Full constructor: (name, type, config, messageBus)
      this.id = uuidv4();
      this.agentId = this.id;
      this.name = nameOrId;
      this.type = typeOrName;
      this.config = configOrCapabilities as AgentConfig;
      this.messageBus = messageBus;
      this.capabilities = [];
      this.setupMessageHandlers();
    } else {
      // Simplified constructor: (agentId, name, capabilities)
      this.id = nameOrId;
      this.agentId = nameOrId;
      this.name = typeOrName;
      const derivedType = typeOrName.toLowerCase().replace('agent', '') as AgentType;
      this.type = derivedType;
      this.config = { name: typeOrName, type: derivedType };
      this.messageBus = new EventEmitter();
      this.capabilities = Array.isArray(configOrCapabilities) ? configOrCapabilities : [];
    }
    
    this.status = 'idle';
    logger.info(`Agent initialized: ${this.name} (${this.type})`, { agentId: this.id });
  }

  /**
   * Initialize the agent and set up connections
   */
  async initialize(): Promise<void> {
    try {
      this.status = 'initializing';
      await this.onInitialize();
      this.status = 'idle';
      this.emit('initialized', { agentId: this.id, name: this.name });
      logger.info(`Agent ready: ${this.name}`, { agentId: this.id });
    } catch (error) {
      this.status = 'error';
      logger.error(`Agent initialization failed: ${this.name}`, { error, agentId: this.id });
      throw error;
    }
  }

  /**
   * Execute a task assigned to this agent
   */
  async executeTask(task: AgentTask): Promise<TaskResult> {
    this.currentTask = task;
    this.status = 'busy';

    logger.info(`Agent executing task: ${task.type}`, {
      agentId: this.id,
      taskId: task.id,
      name: this.name,
    });

    const startTime = Date.now();
    try {
      const result = await this.onExecuteTask(task);
      const executionTime = Date.now() - startTime;

      // Ensure returned TaskResult includes measured execution time
      const finalResult: TaskResult = Object.assign({}, result, { executionTime: Math.max(1, executionTime) });

      task.status = 'completed';
      task.result = finalResult as any;
      task.executionTime = executionTime;
      task.completedAt = new Date();

      this.executionHistory.push(task);
      this.currentTask = null;
      this.status = 'idle';

      this.emit('taskCompleted', { agentId: this.id, task, result: finalResult });
      logger.info(`Task completed: ${task.type}`, {
        agentId: this.id,
        taskId: task.id,
        executionTime,
      });

      return finalResult;
    } catch (error) {
      this.currentTask = null;
      this.status = 'error';
      task.status = 'failed';
      task.error = error as Error;

      const details = error instanceof Error ? { message: error.message, stack: error.stack } : { error: String(error) };
      logger.error(`Task failed: ${task.type}`, {
        error: details,
        agentId: this.id,
        taskId: task.id,
      });

      this.emit('taskFailed', { agentId: this.id, task, error });

      // Return standardized TaskResult instead of throwing so callers receive consistent results
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime,
        agentId: this.id,
      };
    }
  }

  /**
   * Send a message to another agent or broadcast
   */
  protected sendMessage(message: AgentMessage): void {
    message.from = this.id;
    message.timestamp = new Date();
    
    logger.debug(`Agent sending message: ${message.type}`, {
      from: this.id,
      to: message.to,
      type: message.type,
    });

    this.messageBus.emit('message', message);
  }

  /**
   * Handle incoming messages
   */
  protected handleMessage(message: AgentMessage): void {
    logger.debug(`Agent received message: ${message.type}`, {
      agentId: this.id,
      from: message.from,
      type: message.type,
    });

    this.onMessageReceived(message);
  }

  /**
   * Add a task to the queue
   */
  enqueueTask(task: AgentTask): void {
    task.status = 'queued';
    task.assignedTo = this.id;
    this.taskQueue.push(task);
    
    logger.info(`Task queued: ${task.type}`, {
      agentId: this.id,
      taskId: task.id,
      queueLength: this.taskQueue.length,
    });

    this.emit('taskQueued', { agentId: this.id, task });
  }

  /**
   * Add task and execute immediately (convenience method)
   * @param taskInput Task input object
   * @returns TaskResult from execution
   */
  async addTask(taskInput: {
    id: string;
    action: string;
    parameters: Record<string, unknown>;
    priority?: number;
    createdAt?: number;
  }): Promise<TaskResult> {
    const task: AgentTask = {
      id: taskInput.id,
      type: taskInput.action,
      action: taskInput.action, // Set both for compatibility
      status: 'queued',
      priority: taskInput.priority || 1,
      createdAt: new Date(taskInput.createdAt || Date.now()),
      parameters: taskInput.parameters,
    };
    
    return await this.executeTask(task);
  }

  /**
   * Process next task in queue
   */
  async processNextTask(): Promise<TaskResult | null> {
    if (this.taskQueue.length === 0 || this.status !== 'idle') {
      return null;
    }

    const task = this.taskQueue.shift()!;
    return await this.executeTask(task);
  }

  /**
   * Get agent status information
   */
  getStatus(): {
    id: string;
    name: string;
    type: string;
    status: AgentStatus;
    queueLength: number;
    currentTask: string | null;
    executionHistoryCount: number;
    capabilities: string[];
  } {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      status: this.status,
      queueLength: this.taskQueue.length,
      currentTask: this.currentTask?.type || null,
      executionHistoryCount: this.executionHistory.length,
      capabilities: this.capabilities,
    };
  }

  /**
   * Get execution history
   */
  getExecutionHistory(limit?: number): AgentTask[] {
    if (limit) {
      return this.executionHistory.slice(-limit);
    }
    return this.executionHistory;
  }

  /**
   * Cleanup and shutdown agent
   */
  async shutdown(): Promise<void> {
    this.status = 'idle';
    await this.onShutdown();
    this.removeAllListeners();
    logger.info(`Agent shutdown: ${this.name}`, { agentId: this.id });
  }

  // Abstract methods to be implemented by specialized agents
  protected abstract onInitialize(): Promise<void>;
  protected abstract onExecuteTask(task: AgentTask): Promise<TaskResult>;
  protected abstract onMessageReceived(message: AgentMessage): void;
  protected abstract onShutdown(): Promise<void>;

  // Private helper methods
  private setupMessageHandlers(): void {
    if (this.messageBus) {
      this.messageBus.on('message', (message: AgentMessage) => {
        if (message.to === this.id || message.to === 'broadcast') {
          this.handleMessage(message);
        }
      });
    }
  }
  
  // Helper methods for specialized agents
  getCapabilities(): string[] {
    return this.capabilities;
  }
  
  getPendingCount(): number {
    return this.taskQueue.length;
  }
}
