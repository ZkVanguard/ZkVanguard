/**
 * @fileoverview Message Bus for inter-agent communication
 * @module agents/communication/MessageBus
 */

import { EventEmitter } from 'eventemitter3';
import { logger } from '@shared/utils/logger';
import { AgentMessage } from '@shared/types/agent';

/**
 * Message Bus for routing messages between agents
 */
export class MessageBus extends EventEmitter {
  private messageHistory: AgentMessage[] = [];
  private maxHistorySize: number;

  constructor(maxHistorySize: number = 1000) {
    super();
    this.maxHistorySize = maxHistorySize;
    this.setupMessageLogging();
  }

  /**
   * Send a message through the bus
   */
  send(message: AgentMessage): void {
    // Add to history
    this.messageHistory.push(message);
    
    // Trim history if needed
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory = this.messageHistory.slice(-this.maxHistorySize);
    }

    // Log message
    logger.debug('Message sent', {
      messageId: message.id,
      from: message.from,
      to: message.to,
      type: message.type,
    });

    // Emit message event
    this.emit('message', message);

    // Emit specific event for message type
    this.emit(`message:${message.type}`, message);

    // Emit event for specific recipient
    if (message.to !== 'broadcast') {
      this.emit(`message:${message.to}`, message);
    }
  }

  /**
   * Broadcast message to all agents
   */
  broadcast(message: Omit<AgentMessage, 'to'>): void {
    const broadcastMessage: AgentMessage = {
      ...message,
      to: 'broadcast',
    };
    this.send(broadcastMessage);
  }

  /**
   * Get message history
   */
  getHistory(limit?: number): AgentMessage[] {
    if (limit) {
      return this.messageHistory.slice(-limit);
    }
    return this.messageHistory;
  }

  /**
   * Get messages for a specific agent
   */
  getAgentMessages(agentId: string, limit?: number): AgentMessage[] {
    const messages = this.messageHistory.filter(
      (msg) => msg.from === agentId || msg.to === agentId || msg.to === 'broadcast'
    );
    
    if (limit) {
      return messages.slice(-limit);
    }
    return messages;
  }

  /**
   * Clear message history
   */
  clearHistory(): void {
    this.messageHistory = [];
    logger.info('Message history cleared');
  }

  /**
   * Setup message logging
   */
  private setupMessageLogging(): void {
    this.on('message', (message: AgentMessage) => {
      logger.debug('Message routed', {
        messageId: message.id,
        from: message.from,
        to: message.to,
        type: message.type,
      });
    });
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalMessages: number;
    messagesByType: Record<string, number>;
    messagesByAgent: Record<string, number>;
  } {
    const stats = {
      totalMessages: this.messageHistory.length,
      messagesByType: {} as Record<string, number>,
      messagesByAgent: {} as Record<string, number>,
    };

    this.messageHistory.forEach((msg) => {
      // Count by type
      stats.messagesByType[msg.type] = (stats.messagesByType[msg.type] || 0) + 1;
      
      // Count by sender
      stats.messagesByAgent[msg.from] = (stats.messagesByAgent[msg.from] || 0) + 1;
    });

    return stats;
  }
}
