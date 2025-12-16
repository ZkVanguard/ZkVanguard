/**
 * @fileoverview ZK Proof Validator - Off-chain verification of ZK-STARK proofs
 * @module zk/verifier/ProofValidator
 */

import { spawn } from 'child_process';
import path from 'path';
import { logger } from '@shared/utils/logger';

export interface ProofValidationResult {
  valid: boolean;
  proofHash: string;
  proofType: string;
  protocol: string;
  verificationTime: number;
  errors?: string[];
}

/**
 * ProofValidator class - Validates ZK-STARK proofs off-chain
 */
export class ProofValidator {
  private pythonPath: string;
  private zkSystemPath: string;

  constructor() {
    this.pythonPath = 'python';
    this.zkSystemPath = path.join(process.cwd(), 'zkp');
  }

  /**
   * Validate ZK-STARK proof off-chain
   */
  async validateProof(
    proof: Record<string, unknown>,
    statement: Record<string, unknown>,
    proofType: string
  ): Promise<ProofValidationResult> {
    const startTime = Date.now();

    try {
      logger.info('Validating ZK-STARK proof', {
        proofType,
        protocol: proof.protocol,
      });

      // Call Python verifier
      const result = await this.callPythonVerifier(proof, statement);

      const validation: ProofValidationResult = {
        valid: result.verified,
        proofHash: proof.trace_merkle_root || 'unknown',
        proofType,
        protocol: proof.protocol || 'ZK-STARK',
        verificationTime: Date.now() - startTime,
      };

      if (!result.verified) {
        validation.errors = [result.error || 'Proof verification failed'];
      }

      logger.info('ZK-STARK proof validation complete', {
        valid: validation.valid,
        verificationTime: validation.verificationTime,
      });

      return validation;
    } catch (error) {
      logger.error('Failed to validate ZK-STARK proof', {
        error,
        proofType,
      });

      return {
        valid: false,
        proofHash: proof.trace_merkle_root || 'unknown',
        proofType,
        protocol: proof.protocol || 'ZK-STARK',
        verificationTime: Date.now() - startTime,
        errors: [(error as Error).message],
      };
    }
  }

  /**
   * Call Python ZK-STARK verifier
   */
  private async callPythonVerifier(
    proof: Record<string, unknown>,
    statement: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const pythonScript = path.join(this.zkSystemPath, 'cli', 'verify_proof.py');

      const pythonProcess = spawn(this.pythonPath, [
        pythonScript,
        '--proof',
        JSON.stringify(proof),
        '--statement',
        JSON.stringify(statement),
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
        if (code !== 0) {
          // Try to parse error output
          try {
            const errorResult = JSON.parse(stderr);
            resolve(errorResult);
          } catch {
            reject(new Error(`Python process exited with code ${code}: ${stderr}`));
          }
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
        reject(new Error(`Failed to spawn Python process: ${error}`));
      });
    });
  }

  /**
   * Batch validate proofs
   */
  async validateBatchProofs(
    proofs: Array<{ proof: Record<string, unknown>; statement: Record<string, unknown>; proofType: string }>
  ): Promise<ProofValidationResult[]> {
    logger.info('Validating batch ZK-STARK proofs', { count: proofs.length });

    const promises = proofs.map((p) => this.validateProof(p.proof, p.statement, p.proofType));

    return await Promise.all(promises);
  }

  /**
   * Quick validation of proof structure (without full verification)
   */
  validateProofStructure(proof: Record<string, unknown>): boolean {
    // Check required fields for STARK proof
    const requiredFields = [
      'version',
      'trace_length',
      'trace_merkle_root',
      'fri_roots',
      'query_responses',
      'protocol',
    ];

    for (const field of requiredFields) {
      if (!(field in proof)) {
        logger.warn('Proof missing required field', { field });
        return false;
      }
    }

    // Check protocol is STARK
    if (!proof.protocol.includes('STARK')) {
      logger.warn('Proof protocol is not STARK', { protocol: proof.protocol });
      return false;
    }

    return true;
  }

  /**
   * Extract public outputs from proof
   */
  extractPublicOutputs(proof: Record<string, unknown>): Record<string, unknown> {
    return {
      publicOutput: proof.public_output,
      statement: proof.statement,
      protocol: proof.protocol,
      securityLevel: proof.security_level,
      generationTime: proof.generation_time,
    };
  }
}

// Singleton instance
export const proofValidator = new ProofValidator();
