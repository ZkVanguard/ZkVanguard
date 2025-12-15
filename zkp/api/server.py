#!/usr/bin/env python3
"""
ZK Proof System API Server
FastAPI server that exposes the Python/CUDA ZK system to the Next.js frontend
"""

import os
import sys
import json
import asyncio
import secrets
from typing import Dict, Any, List, Optional
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

# Add parent directory to path
sys.path.append(str(Path(__file__).parent.parent))

from zkp.integration.zk_system_hub import ZKSystemFactory
from zkp.core.zk_system import AuthenticProofManager

# Initialize FastAPI
app = FastAPI(
    title="Chronos Vanguard ZK System",
    description="CUDA-accelerated ZK-STARK proof generation and verification",
    version="1.0.0"
)

# CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize ZK system
zk_factory = ZKSystemFactory()
proof_manager = zk_factory.create_proof_manager(
    storage_dir="./zkp/proofs",
    enable_cuda=True
)

# In-memory proof job tracking
proof_jobs: Dict[str, Dict[str, Any]] = {}


# Pydantic models
class ProofRequest(BaseModel):
    proof_type: str = Field(..., description="Type of proof: settlement, risk, rebalance")
    data: Dict[str, Any] = Field(..., description="Data to prove")
    portfolio_id: Optional[int] = Field(None, description="Portfolio ID for context")


class VerificationRequest(BaseModel):
    proof: Dict[str, Any] = Field(..., description="Proof to verify")
    public_inputs: List[int] = Field(..., description="Public inputs")


class ProofResponse(BaseModel):
    job_id: str
    status: str
    proof: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    timestamp: str
    duration_ms: Optional[int] = None


class HealthResponse(BaseModel):
    status: str
    cuda_available: bool
    cuda_enabled: bool
    system_info: Dict[str, Any]


# Routes
@app.get("/", response_model=Dict[str, str])
async def root():
    """Root endpoint"""
    return {
        "service": "Chronos Vanguard ZK System",
        "status": "operational",
        "version": "1.0.0"
    }


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check with system status"""
    status = zk_factory.get_system_status()
    
    return HealthResponse(
        status="healthy",
        cuda_available=status['cuda_optimization']['available'],
        cuda_enabled=status['cuda_optimization']['enabled'],
        system_info=status
    )


@app.post("/api/zk/generate", response_model=ProofResponse)
async def generate_proof(
    request: ProofRequest,
    background_tasks: BackgroundTasks
):
    """
    Generate ZK proof asynchronously
    
    Proof types:
    - settlement: Prove valid batch settlement
    - risk: Prove risk assessment calculations
    - rebalance: Prove portfolio rebalancing logic
    """
    job_id = f"proof_{datetime.now().timestamp()}_{secrets.token_hex(8)}"
    
    # Initialize job tracking
    proof_jobs[job_id] = {
        "status": "pending",
        "proof_type": request.proof_type,
        "created_at": datetime.now().isoformat(),
        "proof": None,
        "error": None
    }
    
    # Start proof generation in background
    background_tasks.add_task(
        _generate_proof_async,
        job_id,
        request.proof_type,
        request.data,
        request.portfolio_id
    )
    
    return ProofResponse(
        job_id=job_id,
        status="pending",
        timestamp=datetime.now().isoformat()
    )


@app.get("/api/zk/proof/{job_id}", response_model=ProofResponse)
async def get_proof_status(job_id: str):
    """Get proof generation status and result"""
    if job_id not in proof_jobs:
        raise HTTPException(status_code=404, detail="Proof job not found")
    
    job = proof_jobs[job_id]
    
    return ProofResponse(
        job_id=job_id,
        status=job["status"],
        proof=job.get("proof"),
        error=job.get("error"),
        timestamp=job["created_at"],
        duration_ms=job.get("duration_ms")
    )


@app.post("/api/zk/verify")
async def verify_proof(request: VerificationRequest):
    """
    Verify ZK proof
    Returns: { valid: bool, verified_at: str }
    """
    try:
        start_time = datetime.now()
        
        # Extract proof components
        proof_data = request.proof
        public_inputs = request.public_inputs
        
        # Verify using ZK system
        zk_system = zk_factory.create_zk_system(enable_cuda=True)
        
        # Convert proof format
        formatted_proof = {
            'witness': proof_data.get('witness', []),
            'commitments': proof_data.get('commitments', []),
            'evaluations': proof_data.get('evaluations', []),
            'fri_proof': proof_data.get('fri_proof', {})
        }
        
        # Verify
        is_valid = zk_system.verify_proof(formatted_proof, public_inputs)
        
        duration = (datetime.now() - start_time).total_seconds() * 1000
        
        return {
            "valid": is_valid,
            "verified_at": datetime.now().isoformat(),
            "duration_ms": int(duration),
            "cuda_accelerated": zk_factory.cuda_optimizer is not None
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Verification failed: {str(e)}")


@app.get("/api/zk/stats")
async def get_zk_stats():
    """Get ZK system statistics"""
    return {
        "total_proofs_generated": len(proof_jobs),
        "pending_jobs": sum(1 for j in proof_jobs.values() if j["status"] == "pending"),
        "completed_jobs": sum(1 for j in proof_jobs.values() if j["status"] == "completed"),
        "failed_jobs": sum(1 for j in proof_jobs.values() if j["status"] == "failed"),
        "cuda_enabled": zk_factory.cuda_optimizer is not None
    }


# Background tasks
async def _generate_proof_async(
    job_id: str,
    proof_type: str,
    data: Dict[str, Any],
    portfolio_id: Optional[int]
):
    """Generate proof in background"""
    try:
        start_time = datetime.now()
        
        # Update status
        proof_jobs[job_id]["status"] = "generating"
        
        # Get ZK system
        zk_system = zk_factory.create_zk_system(enable_cuda=True)
        
        # Prepare data based on proof type
        if proof_type == "settlement":
            witness = _prepare_settlement_witness(data)
        elif proof_type == "risk":
            witness = _prepare_risk_witness(data)
        elif proof_type == "rebalance":
            witness = _prepare_rebalance_witness(data)
        else:
            raise ValueError(f"Unknown proof type: {proof_type}")
        
        # Generate proof
        statement = {"type": proof_type, "portfolio_id": portfolio_id}
        witness_data = {"witness": witness, "data": data}
        proof = zk_system.generate_proof(statement, witness_data)
        
        # Calculate duration
        duration = (datetime.now() - start_time).total_seconds() * 1000
        
        # Store result
        proof_jobs[job_id].update({
            "status": "completed",
            "proof": {
                "witness": proof.get('witness', []),
                "commitments": [c.hex() if isinstance(c, bytes) else str(c) for c in proof.get('commitments', [])],
                "evaluations": proof.get('evaluations', []),
                "fri_proof": proof.get('fri_proof', {}),
                "proof_type": proof_type,
                "cuda_accelerated": zk_factory.cuda_optimizer is not None
            },
            "duration_ms": int(duration),
            "completed_at": datetime.now().isoformat()
        })
        
    except Exception as e:
        proof_jobs[job_id].update({
            "status": "failed",
            "error": str(e),
            "failed_at": datetime.now().isoformat()
        })


def _prepare_settlement_witness(data: Dict[str, Any]) -> List[int]:
    """Prepare witness for settlement proof"""
    # Extract settlement data
    payments = data.get('payments', [])
    total_amount = sum(p.get('amount', 0) for p in payments)
    
    # Create witness: [total_amount, num_payments, payment_amounts...]
    witness = [total_amount, len(payments)]
    witness.extend([p.get('amount', 0) for p in payments])
    
    return witness


def _prepare_risk_witness(data: Dict[str, Any]) -> List[int]:
    """Prepare witness for risk assessment proof"""
    # Extract risk data
    portfolio_value = data.get('portfolio_value', 0)
    volatility = data.get('volatility', 0)
    var = data.get('value_at_risk', 0)
    
    # Create witness: [portfolio_value, volatility, VaR]
    witness = [portfolio_value, volatility, var]
    
    return witness


def _prepare_rebalance_witness(data: Dict[str, Any]) -> List[int]:
    """Prepare witness for rebalance proof"""
    # Extract rebalance data
    old_allocations = data.get('old_allocations', [])
    new_allocations = data.get('new_allocations', [])
    
    # Create witness: [old_alloc1, old_alloc2, ..., new_alloc1, new_alloc2, ...]
    witness = old_allocations + new_allocations
    
    return witness


# Run server
if __name__ == "__main__":
    import secrets
    
    print("🚀 Starting Chronos Vanguard ZK System API")
    print("=" * 60)
    print(f"📍 Server: http://0.0.0.0:8000")
    print(f"📖 Docs: http://0.0.0.0:8000/docs")
    print(f"🔧 CUDA: {'Enabled' if zk_factory.cuda_optimizer else 'Disabled (CPU fallback)'}")
    print("=" * 60)
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
