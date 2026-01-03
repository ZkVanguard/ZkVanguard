import { resetAgentOrchestrator } from '../lib/services/agent-orchestrator';

const globalTeardown = async () => {
  await resetAgentOrchestrator();
};

export default globalTeardown;
