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
  private static instance: MessageBus | null = null;
  private messageHistory: AgentMessage[] = [];
  private maxHistorySize: number;

  constructor(maxHistorySize: number = 1000) {
    super();
    this.maxHistorySize = maxHistorySize;
    this.setupMessageLogging();
  }

  /**
   * Get singleton instance
   */
  static getInstance(maxHistorySize: number = 1000): MessageBus {
    if (!MessageBus.instance) {
      MessageBus.instance = new MessageBus(maxHistorySize);
    }
    return MessageBus.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  static resetInstance(): void {
    MessageBus.instance = null;
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

    // Emit specific event for message type and recipient.
    // Avoid emitting the same event twice when `type` and `to` are identical.
    const typeEvent = `message:${message.type}`;
    const toEvent = `message:${message.to}`;

    if (typeEvent === toEvent) {
      this.emit(typeEvent, message);
    } else {
      this.emit(typeEvent, message);
      if (message.to !== 'broadcast') {
        this.emit(toEvent, message);
      }
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
   * Subscribe to a channel (convenience method)
   */
  subscribe(channel: string, callback: (message: AgentMessage) => void): void {
    // Subscribe to channel-specific messages
    this.on(`message:${channel}`, callback);
  }

  /**
   * Publish to a channel (convenience method)
   */
  publish(channel: string, message: Partial<AgentMessage>): void {
    const fullMessage: AgentMessage = {
      ...message,  // Spread first so explicit values below take precedence
      id: message.id || `msg-${Date.now()}`,
      from: message.from || 'system',
      to: channel,  // Always use the channel parameter
      type: message.type || 'broadcast',
      payload: message.payload || {},
      timestamp: new Date(),
    };
    this.send(fullMessage);
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
   * Get message history (alias for compatibility)
   */
  getMessageHistory(channel?: string, limit?: number): AgentMessage[] {
    if (channel) {
      return this.getAgentMessages(channel, limit);
    }
    return this.getHistory(limit);
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
