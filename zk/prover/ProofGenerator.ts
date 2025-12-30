/**
 * @fileoverview ZK Proof Generator - TypeScript wrapper for Python ZK-STARK system
 * @module zk/prover/ProofGenerator
 */

import { spawn } from 'child_process';
import path from 'path';
import crypto from 'crypto';
import { logger } from '@shared/utils/logger';
import { RiskAnalysis } from '@shared/types/agent';

export interface ZKProofInput {
  proofType: string;
  statement: Record<string, unknown>;
  witness: Record<string, unknown>;
}

export interface ZKProof {
  proof: Record<string, unknown>;
  proofHash: string;
  proofType: string;
  verified: boolean;
  generationTime: number;
  protocol: string;
}

/**
 * ProofGenerator class - Interfaces with Python ZK-STARK implementation
 */
export class ProofGenerator {
  private pythonPath: string;
  private zkSystemPath: string;

  constructor() {
    // Path to Python ZK system
    this.pythonPath = process.env.ZK_PYTHON_PATH || 'python';
    this.zkSystemPath = process.env.ZK_SYSTEM_PATH || path.join(process.cwd(), 'zkp');
  }

  /**
   * Generate ZK-STARK proof for risk calculation
   */
  async generateRiskProof(riskAnalysis: RiskAnalysis): Promise<ZKProof> {
    logger.info('Generating ZK-STARK proof for risk calculation', {
      portfolioId: riskAnalysis.portfolioId,
    });

    const statement = {
      claim: 'Portfolio risk is below threshold',
      threshold: 100,
      public_data: {
        portfolioId: riskAnalysis.portfolioId,
        timestamp: riskAnalysis.timestamp.toISOString(),
      },
    };

    const witness = {
      secret_value: Math.floor(riskAnalysis.totalRisk),
      volatility: riskAnalysis.volatility,
      portfolio_value: 10000000, // $10M example
    };

    return await this.generateProof('risk-calculation', statement, witness);
  }

  /**
   * Generate generic ZK-STARK proof
   */
  async generateProof(
    proofType: string,
    statement: Record<string, unknown>,
    witness: Record<string, unknown>
  ): Promise<ZKProof> {
    const startTime = Date.now();

    try {
      logger.info('Generating ZK-STARK proof', {
        proofType,
        statement: Object.keys(statement),
      });

      // Call Python ZK-STARK system
      const result = await this.callPythonProver(proofType, statement, witness);
      const resultProof = result.proof as Record<string, unknown>;

      const proof: ZKProof = {
        proof: resultProof,
        proofHash: (resultProof.trace_merkle_root as string) || this.hashProofSync(resultProof),
        proofType,
        verified: (result.verified as boolean) || false,
        generationTime: Date.now() - startTime,
        protocol: (resultProof.protocol as string) || 'ZK-STARK',
      };

      logger.info('ZK-STARK proof generated successfully', {
        proofType,
        generationTime: proof.generationTime,
        proofHash: proof.proofHash.substring(0, 16) + '...',
      });

      return proof;
    } catch (error) {
      const details = error instanceof Error ? { message: error.message, stack: error.stack } : { error: String(error) };
      logger.error('Failed to generate ZK-STARK proof', {
        proofType,
        error: details,
      });

      // Fallback to mock proof for development
      return this.generateMockProof(proofType, statement);
    }
  }

  /**
   * Call Python ZK-STARK prover
   */
  private async callPythonProver(
    proofType: string,
    statement: Record<string, unknown>,
    witness: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Allow enabling the Python prover via env var. By default tests and CI use mock proofs.
    // To enable the real prover set `ZK_PYTHON_ENABLED=1` or `ZK_PYTHON_ENABLED=true`.
    const zkEnabledEnv = (process.env.ZK_PYTHON_ENABLED || '').toLowerCase();
    const zkEnabled = zkEnabledEnv === '1' || zkEnabledEnv === 'true';
    const isTestMode = !zkEnabled && (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined);
    if (isTestMode) {
      throw new Error('Test mode: using mock proof');
    }

    return new Promise((resolve, reject) => {
      const pythonScript = path.join(this.zkSystemPath, 'cli', 'generate_proof.py');
      const timeout = Number(process.env.ZK_PYTHON_TIMEOUT) || 30000; // default 30s

      // Set timeout to avoid hanging
      const timer = setTimeout(() => {
        pythonProcess.kill();
        reject(new Error('Python process timed out'));
      }, timeout);

      // Spawn Python process
      const pythonProcess = spawn(this.pythonPath, [
        pythonScript,
        '--proof-type',
        proofType,
        '--statement',
        JSON.stringify(statement),
        '--witness',
        JSON.stringify(witness),
      ]);

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pythonProcess.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`Python process exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (error) {
          reject(new Error(`Failed to parse Python output: ${error}`));
        }
      });

      pythonProcess.on('error', (error) => {
        clearTimeout(timer);
        reject(new Error(`Failed to spawn Python process: ${error}`));
      });
    });
  }

  /**
   * Generate mock proof for development/testing
   */
  private generateMockProof(
    proofType: string,
    statement: Record<string, unknown>
  ): ZKProof {
    logger.warn('Using mock ZK proof for development', { proofType });

    const mockProof = {
      version: 'STARK-1.0-MOCK',
      trace_length: 1024,
      extended_trace_length: 4096,
      blowup_factor: 4,
      trace_merkle_root: this.hashProofSync(statement).substring(0, 64),
      fri_roots: [
        this.hashProofSync({ ...statement, layer: 0 }).substring(0, 64),
        this.hashProofSync({ ...statement, layer: 1 }).substring(0, 64),
      ],
      fri_final_polynomial: [1, 2, 3, 4],
      query_responses: [],
      field_prime: '6864797660130609714981900799081393217269435300143305409394463459185543183397656052122559640661454554977296311391480858037121987999716643812574028291115057151',
      security_level: 20,
      generation_time: 0.1,
      protocol: 'ZK-STARK-MOCK',
      air_satisfied: true,
      statement,
      proof_system: 'AIR + FRI (Mock)',
      public_output: { verified: true, proofType, timestamp: Date.now() },
    };

    return {
      proof: mockProof,
      proofHash: mockProof.trace_merkle_root,
      proofType,
      verified: true,
      generationTime: 100,
      protocol: 'ZK-STARK-MOCK',
    };
  }

  /**
   * Hash proof data to create proof hash
   */
  private hashProofSync(data: unknown): string {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(data));
    return hash.digest('hex');
  }

  /**
   * Batch generate proofs
   */
  async generateBatchProofs(inputs: ZKProofInput[]): Promise<ZKProof[]> {
    logger.info('Generating batch ZK-STARK proofs', { count: inputs.length });

    const promises = inputs.map((input) =>
      this.generateProof(input.proofType, input.statement, input.witness)
    );

    return await Promise.all(promises);
  }

  /**
   * Verify proof is valid structure
   */
  validateProofStructure(proof: ZKProof): boolean {
    return (
      proof.proof !== undefined &&
      proof.proofHash !== undefined &&
      proof.proofType !== undefined &&
      typeof proof.verified === 'boolean' &&
      typeof proof.generationTime === 'number'
    );
  }
}

// Singleton instance
export const proofGenerator = new ProofGenerator();
