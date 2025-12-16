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
from typing import Dict, Any, List, Optional, Union
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import uvicorn
import orjson

# Add project root to path (two levels up from api/server.py)
project_root = str(Path(__file__).parent.parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from zkp.integration.zk_system_hub import ZKSystemFactory
from zkp.core.zk_system import AuthenticProofManager

print("=" * 70, flush=True)
print("🔄 SERVER MODULE LOADED - WITH BOOLEAN FIX (v1.1)", flush=True)
print("=" * 70, flush=True)

# Helper to convert large integers to strings for JSON serialization
def convert_large_ints_to_strings(obj: Any, threshold: int = 2**53, _depth: int = 0) -> Any:
    """Recursively convert integers larger than JS safe integer to strings"""
    # DEBUG: Print every call
    if _depth == 0:
        print(f"🔧 convert_large_ints_to_strings CALLED at depth {_depth}", flush=True)
    
    # Debug privacy_enhancements specifically
    if isinstance(obj, dict) and 'privacy_enhancements' in obj and _depth < 2:
        print(f"DEBUG CONVERT: Found privacy_enhancements at depth {_depth}", flush=True)
        pe = obj['privacy_enhancements']
        print(f"DEBUG CONVERT: Type: {type(pe)}, Value: {pe}", flush=True)
        if isinstance(pe, dict):
            for k, v in pe.items():
                print(f"DEBUG CONVERT:   {k} = {v} (type: {type(v)}, isinstance bool: {isinstance(v, bool)}, isinstance int: {isinstance(v, int)})", flush=True)
    
    # IMPORTANT: Check bool BEFORE int (bool is subclass of int in Python)
    if isinstance(obj, bool):
        return obj
    elif isinstance(obj, int):
        # Convert large integers to strings to preserve precision
        return str(obj) if abs(obj) > threshold else obj
    elif isinstance(obj, dict):
        return {k: convert_large_ints_to_strings(v, threshold, _depth + 1) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_large_ints_to_strings(item, threshold, _depth + 1) for item in obj]
    elif isinstance(obj, tuple):
        return tuple(convert_large_ints_to_strings(item, threshold, _depth + 1) for item in obj)
    return obj

# Custom JSONResponse that handles large integers
class LargeIntJSONResponse(JSONResponse):
    def render(self, content: Any) -> bytes:
        print(f"🎨 LargeIntJSONResponse.render() CALLED!", flush=True)
        print(f"🎨 Content type: {type(content)}", flush=True)
        # Convert large integers to strings before serialization
        safe_content = convert_large_ints_to_strings(content)
        return orjson.dumps(safe_content, option=orjson.OPT_INDENT_2)

# Initialize FastAPI with custom response for lossless large integer serialization
app = FastAPI(
    title="Chronos Vanguard ZK System",
    description="CUDA-accelerated ZK-STARK proof generation and verification",
    version="1.0.0",
    default_response_class=LargeIntJSONResponse  # Custom handler for big integers as strings
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


# Helper to convert string integers back to int for verification
def parse_string_ints_to_int(obj: Any, parent_key: str = None) -> Any:
    """
    Recursively convert string integers back to int for ZK proof fields.
    Only converts fields that should be large integers (cryptographic values).
    Preserves booleans, regular strings, and other types.
    """
    # Fields that should definitely be converted to int
    INT_FIELDS = {
        'statement_hash', 'challenge', 'response', 'witness_commitment',
        'value', 'index', 'extended_trace_length', 'execution_trace_length',
        'computation_steps'
    }
    
    if isinstance(obj, str):
        # Only convert if this is a field that should be an integer
        # AND it's a valid integer string (digits only or negative number)
        if parent_key in INT_FIELDS and (obj.isdigit() or (obj.startswith('-') and obj[1:].isdigit())):
            try:
                return int(obj)
            except (ValueError, OverflowError):
                return obj
        return obj
    elif isinstance(obj, dict):
        return {k: parse_string_ints_to_int(v, k) for k, v in obj.items()}
    elif isinstance(obj, list):
        # For lists, recursively process each element
        # Don't pass parent_key down since list items are independent structures
        return [parse_string_ints_to_int(item) for item in obj]
    return obj


# Pydantic models
class ProofRequest(BaseModel):
    proof_type: str = Field(..., description="Type of proof: settlement, risk, rebalance")
    data: Dict[str, Any] = Field(..., description="Data to prove")
    portfolio_id: Optional[int] = Field(None, description="Portfolio ID for context")


class VerificationRequest(BaseModel):
    proof: Dict[str, Any] = Field(..., description="Proof to verify")
    public_inputs: List[int] = Field(..., description="Public inputs")
    claim: Optional[str] = Field(None, description="Statement claim to verify against")


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
@app.get("/", response_class=LargeIntJSONResponse)
async def root():
    """Root endpoint"""
    test_data = {
        "service": "Chronos Vanguard ZK System",
        "status": "operational",
        "version": "1.0.0",
        "test_boolean": False,
        "test_large_int": 12345678901234567890123456789012345678901234567890
    }
    return LargeIntJSONResponse(content=test_data)


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


@app.get("/api/zk/proof/{job_id}", response_class=LargeIntJSONResponse)
async def get_proof_status(job_id: str):
    """Get proof generation status and result"""
    if job_id not in proof_jobs:
        raise HTTPException(status_code=404, detail="Proof job not found")
    
    job = proof_jobs[job_id]
    
    # DEBUG: Check what's in the stored proof
    if job.get("proof"):
        pe = job["proof"].get("privacy_enhancements", {})
        print(f"📦 STORED proof privacy_enhancements: {pe}", flush=True)
        print(f"📦 witness_blinding in storage: {pe.get('witness_blinding')} (type: {type(pe.get('witness_blinding'))})", flush=True)
    
    # Return raw dict and explicitly use LargeIntJSONResponse
    response_data = {
        "job_id": job_id,
        "status": job["status"],
        "proof": job.get("proof"),
        "claim": job.get("claim"),  # Include original claim for verification
        "error": job.get("error"),
        "timestamp": job["created_at"],
        "duration_ms": job.get("duration_ms")
    }
    
    return LargeIntJSONResponse(content=response_data)


@app.post("/api/zk/verify")
async def verify_proof(request: VerificationRequest):
    """
    Verify ZK proof
    Returns: { valid: bool, verified_at: str }
    """
    try:
        start_time = datetime.now()
        
        # Extract proof, public inputs, and claim
        proof_data = request.proof
        public_inputs = request.public_inputs
        claim = request.claim
        
        # Debug: Check types before parsing
        print(f"DEBUG: proof_data statement_hash type BEFORE parse: {type(proof_data.get('statement_hash'))}", flush=True)
        print(f"DEBUG: proof_data statement_hash value: {str(proof_data.get('statement_hash'))[:50]}...", flush=True)
        
        # CRITICAL: Parse string integers back to int for proper verification
        # This ensures lossless round-trip: int -> string -> int
        proof_data = parse_string_ints_to_int(proof_data)
        
        # Debug: Check types after parsing
        print(f"DEBUG: proof_data statement_hash type AFTER parse: {type(proof_data.get('statement_hash'))}", flush=True)
        print(f"DEBUG: proof_data statement_hash value: {str(proof_data.get('statement_hash'))[:50]}...", flush=True)
        print(f"DEBUG: proof_data challenge type AFTER parse: {type(proof_data.get('challenge'))}", flush=True)
        print(f"DEBUG: proof_data response type AFTER parse: {type(proof_data.get('response'))}", flush=True)
        
        # Debug query_responses types
        qr = proof_data.get('query_responses', [])
        if len(qr) > 0:
            print(f"DEBUG: First query_response index type: {type(qr[0].get('index'))}", flush=True)
            print(f"DEBUG: First query_response value type: {type(qr[0].get('value'))}", flush=True)
        
        # Verify using ZK system
        zk_system = zk_factory.create_zk_system(enable_cuda=True)
        
        # Reconstruct statement - verifier must provide the correct claim
        # This is proper ZK protocol: verifier knows what they're verifying
        if not claim:
            raise HTTPException(status_code=400, detail="Claim required for verification")
        
        statement = {
            "claim": claim,
            "public_inputs": public_inputs
        }
        
        # Debug: Verify the parsed types are correct
        print(f"DEBUG: About to verify with types:", flush=True)
        print(f"  statement_hash: {type(proof_data.get('statement_hash'))} = {proof_data.get('statement_hash')}", flush=True)
        print(f"  challenge: {type(proof_data.get('challenge'))} = {proof_data.get('challenge')}", flush=True)
        print(f"  response: {type(proof_data.get('response'))}", flush=True)
        
        # Verify using REAL proof structure (statement_hash, challenge, response, etc.)
        is_valid = zk_system.verify_proof(proof_data, statement)
        
        print(f"DEBUG: Verification result: {is_valid}", flush=True)
        
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
    print(f"🚀 BACKGROUND TASK STARTED for job {job_id}", flush=True)
    try:
        start_time = datetime.now()
        
        # Update status
        proof_jobs[job_id]["status"] = "generating"
        print(f"📝 Status updated to generating", flush=True)
        
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
        # CRITICAL: Create claim from data for proper verification
        import json
        claim = json.dumps(data, sort_keys=True)
        
        statement = {
            "claim": claim,
            "type": proof_type,
            "portfolio_id": portfolio_id,
            "public_inputs": [100]  # Use portfolio risk score as public input
        }
        witness_data = witness  # Pass witness dict directly
        
        # Generate real ZK-STARK proof
        proof_result = zk_system.generate_proof(statement, witness_data)
        
        # Calculate duration
        duration = (datetime.now() - start_time).total_seconds() * 1000
        
        # Store result with REAL proof structure (no secrets!)
        actual_proof = proof_result.get('proof', proof_result)
        
        # DEBUG: Check privacy_enhancements before storing
        privacy_enh = actual_proof.get('privacy_enhancements', {})
        print(f"DEBUG STORAGE: privacy_enhancements before storage: {privacy_enh}", flush=True)
        print(f"DEBUG STORAGE: witness_blinding type: {type(privacy_enh.get('witness_blinding'))}", flush=True)
        print(f"DEBUG STORAGE: witness_blinding value: {privacy_enh.get('witness_blinding')}", flush=True)
        
        # FINAL DEBUG: Check types RIGHT BEFORE storing
        final_check = actual_proof.get('privacy_enhancements', {}).get('witness_blinding')
        print(f"⚠️ FINAL CHECK before storage: witness_blinding = {final_check} (type: {type(final_check).__name__}, id: {id(final_check)})", flush=True)
        print(f"⚠️ False constant id: {id(False)}", flush=True)
        print(f"⚠️ Are they the same object? {final_check is False}", flush=True)
        
        proof_jobs[job_id].update({
            "status": "completed",
            "proof": actual_proof,
            "proof_type": proof_type,  # Stored at job level only
            "claim": claim,  # Store original claim for verification
            "duration_ms": int(duration),
            "completed_at": datetime.now().isoformat()
        })
        
        # DEBUG: Check AFTER storing
        stored_check = proof_jobs[job_id]["proof"].get('privacy_enhancements', {}).get('witness_blinding')
        print(f"⚠️ AFTER storage: witness_blinding = {stored_check} (type: {type(stored_check).__name__})", flush=True)
        
    except Exception as e:
        print(f"ERROR in proof generation: {type(e).__name__}: {str(e)}", flush=True)
        import traceback
        traceback.print_exc()
        proof_jobs[job_id].update({
            "status": "failed",
            "error": str(e),
            "failed_at": datetime.now().isoformat()
        })


def _prepare_settlement_witness(data: Dict[str, Any]) -> Dict[str, Any]:
    """Prepare witness for settlement proof as dict"""
    # Extract settlement data
    payments = data.get('payments', [])
    total_amount = sum(p.get('amount', 0) for p in payments)
    
    # Create witness dict for AuthenticZKStark
    witness = {
        'total_amount': total_amount,
        'num_payments': len(payments),
        'payment_sum': sum(p.get('amount', 0) for p in payments[:5])  # First 5 payments
    }
    
    return witness


def _prepare_risk_witness(data: Dict[str, Any]) -> Dict[str, Any]:
    """Prepare witness for risk assessment proof as dict"""
    # Extract risk data
    portfolio_value = data.get('portfolio_value', 0)
    volatility = data.get('volatility', 0)
    var = data.get('value_at_risk', 0)
    
    # Create witness dict for AuthenticZKStark
    witness = {
        'portfolio_value': portfolio_value,
        'volatility': volatility,
        'value_at_risk': var
    }
    
    return witness


def _prepare_rebalance_witness(data: Dict[str, Any]) -> Dict[str, Any]:
    """Prepare witness for rebalance proof as dict"""
    # Extract rebalance data
    old_allocations = data.get('old_allocations', [])
    new_allocations = data.get('new_allocations', [])
    
    # Create witness dict for AuthenticZKStark
    witness = {
        'old_total': sum(old_allocations) if old_allocations else 0,
        'new_total': sum(new_allocations) if new_allocations else 0,
        'num_assets': len(old_allocations)
    }
    
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
