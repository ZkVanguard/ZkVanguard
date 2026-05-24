/**
 * Proves the agent integration-test harness works: the mocked LLM intercepts
 * the dynamic import the agents use, and LeadAgent's intent parsing runs
 * deterministically offline (JSON path + keyword fallback), with no API keys
 * or network.
 */
import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { installMockLLM, restoreAgentMocks, type MockLLMHandle } from '../helpers/agent-harness';

describe('agent integration harness', () => {
  let llm: MockLLMHandle;
  beforeEach(() => { llm = installMockLLM(); });
  afterAll(() => { restoreAgentMocks(); });

  it('intercepts the dynamically-imported llmProvider', async () => {
    llm.setResponder(() => ({ content: 'mocked-response', model: 'mock-llm' }));
    const { llmProvider } = await import('@/lib/ai/llm-provider');
    const r = await llmProvider.generateResponse('ping');
    expect(r.content).toBe('mocked-response');
    expect(r.model).toBe('mock-llm');
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].method).toBe('generateResponse');
  });

  it('drives LeadAgent intent parsing via the mocked LLM (JSON path)', async () => {
    llm.setResponder(() =>
      JSON.stringify({ action: 'hedge', riskLimit: 5, assets: ['BTC'], urgency: 'high' }),
    );
    const { LeadAgent } = await import('@/agents/core/LeadAgent');
    const agent = new LeadAgent('harness-lead-1');

    const intent = await (agent as unknown as {
      parseNaturalLanguage(i: { naturalLanguage: string; portfolioId: number }): Promise<{ action: string; requiredAgents: string[] }>;
    }).parseNaturalLanguage({ naturalLanguage: 'protect my BTC position', portfolioId: 0 });

    expect(intent.action).toBe('hedge');
    expect(intent.requiredAgents).toContain('hedging');
    // confirm the LLM was actually consulted via the orchestrator's seam
    expect(llm.calls.some(c => c.method === 'generateDirectResponse')).toBe(true);
  });

  it('falls back to keyword parsing when the LLM returns invalid JSON', async () => {
    llm.setResponder(() => 'sorry, I cannot help with that');
    const { LeadAgent } = await import('@/agents/core/LeadAgent');
    const agent = new LeadAgent('harness-lead-2');

    const intent = await (agent as unknown as {
      parseNaturalLanguage(i: { naturalLanguage: string; portfolioId: number }): Promise<{ action: string; requiredAgents: string[] }>;
    }).parseNaturalLanguage({ naturalLanguage: 'please rebalance the pool', portfolioId: 0 });

    expect(intent.action).toBe('rebalance');
  });
});
