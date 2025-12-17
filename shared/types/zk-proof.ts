/**
 * ZK Proof Type Definitions
 */

export interface ZKProofData {
  proof_id: string;
  statement: unknown;
  proof: string;
  timestamp: number;
  security_level?: number;
}

export interface ProofCommitment {
  proofHash: string;
  merkleRoot: string;
  timestamp: number;
  securityLevel: number;
}

export interface AIAnalysis {
  summary: string;
  insights: string[];
  recommendations: string[];
  riskLevel?: string;
  confidence?: number;
}
