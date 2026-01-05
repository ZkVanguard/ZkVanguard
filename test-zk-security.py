#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZK Security Test - Verify that fake proofs are properly rejected
"""
import requests
import time
import json
import sys

# Fix Windows console encoding
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

ZK_API_URL = 'http://localhost:8000'

def test_zk_security():
    print('[LOCK] Testing ZK Proof Security\n')
    print('=' * 60)

    # Test 1: Generate a valid proof
    print('\n📝 Test 1: Generate valid proof')
    valid_request = {
        'proof_type': 'settlement',
        'data': {
            'statement': {
                'claim': 'Valid settlement batch',
                'amount': 1000,
                'timestamp': int(time.time())
            },
            'witness': {
                'secret_value': 42,
                'batch_id': 'test_batch_001'
            }
        }
    }

    try:
        gen_response = requests.post(f'{ZK_API_URL}/api/zk/generate', json=valid_request)
        gen_result = gen_response.json()
        job_id = gen_result['job_id']
    print('[OK] Proof generation started, job_id: {job_id}')
    except Exception as e:
        print(f'❌ Failed to start proof generation: {e}')
        return

    # Poll for completion
    valid_proof = None
    claim = None
    print('⏳ Waiting for proof generation...')
    for i in range(30):
        time.sleep(1)
        try:
            status_response = requests.get(f'{ZK_API_URL}/api/zk/proof/{job_id}')
            status_result = status_response.json()
            
            if status_result['status'] == 'completed' and status_result['proof']:
                valid_proof = status_result['proof']
                claim = status_result['claim']
                print(f'✅ Proof generated in {status_result.get("duration_ms", "?")}ms')
                break
            elif status_result['status'] == 'failed':
                print(f'❌ Proof generation failed: {status_result.get("error")}')
                return
        except Exception as e:
            print(f'⚠️  Poll attempt {i+1} failed: {e}')

    if not valid_proof:
        print('❌ Proof generation timeout')
        return

    print(f'\n📄 Proof structure:')
    print(f'   - Version: {valid_proof.get("version")}')
    print(f'   - Challenge: {str(valid_proof.get("challenge"))[:20]}...')
    print(f'   - Response: {str(valid_proof.get("response"))[:20]}...')
    print(f'   - Merkle Root: {valid_proof.get("merkle_root", "")[:20]}...')

    # Test 2: Verify the valid proof
    print('\n📝 Test 2: Verify valid proof')
    valid_verify_request = {
        'proof': valid_proof,
        'public_inputs': [],
        'claim': claim['claim']
    }

    try:
        valid_verify_response = requests.post(f'{ZK_API_URL}/api/zk/verify', json=valid_verify_request)
        valid_verify_result = valid_verify_response.json()
        is_valid = valid_verify_result.get('valid', False)
        print(f'{"✅" if is_valid else "❌"} Valid proof verification: {is_valid}')
        print(f'   Duration: {valid_verify_result.get("duration_ms")}ms')
        
        if not is_valid:
            print('❌ CRITICAL: Valid proof was rejected!')
            return
    except Exception as e:
        print(f'❌ Verification failed: {e}')
        return

    # Test 3: Fake proof - Modified challenge
    print('\n📝 Test 3: Fake proof - Modified challenge')
    fake_proof_1 = valid_proof.copy()
    try:
        original_challenge = int(valid_proof['challenge'])
        fake_proof_1['challenge'] = str(original_challenge + 1)
    except:
        fake_proof_1['challenge'] = '999999999'

    fake_verify_1 = {
        'proof': fake_proof_1,
        'public_inputs': [],
        'claim': claim['claim']
    }

    try:
        fake_response_1 = requests.post(f'{ZK_API_URL}/api/zk/verify', json=fake_verify_1)
        fake_result_1 = fake_response_1.json()
        is_rejected = not fake_result_1.get('valid', False)
        print(f'{"✅" if is_rejected else "❌ SECURITY BREACH"} Modified challenge rejected: {is_rejected}')
    except Exception as e:
        print(f'⚠️  Test failed with error: {e}')

    # Test 4: Fake proof - Modified response
    print('\n📝 Test 4: Fake proof - Modified response')
    fake_proof_2 = valid_proof.copy()
    try:
        original_response = int(valid_proof['response'])
        fake_proof_2['response'] = str(original_response + 999)
    except:
        fake_proof_2['response'] = '111111111'

    fake_verify_2 = {
        'proof': fake_proof_2,
        'public_inputs': [],
        'claim': claim['claim']
    }

    try:
        fake_response_2 = requests.post(f'{ZK_API_URL}/api/zk/verify', json=fake_verify_2)
        fake_result_2 = fake_response_2.json()
        is_rejected = not fake_result_2.get('valid', False)
        print(f'{"✅" if is_rejected else "❌ SECURITY BREACH"} Modified response rejected: {is_rejected}')
    except Exception as e:
        print(f'⚠️  Test failed with error: {e}')

    # Test 5: Fake proof - Modified merkle root
    print('\n📝 Test 5: Fake proof - Modified merkle root')
    fake_proof_3 = valid_proof.copy()
    original_root = valid_proof.get('merkle_root', '')
    if original_root:
        fake_proof_3['merkle_root'] = original_root[:-4] + 'dead'
    else:
        fake_proof_3['merkle_root'] = '0' * 64

    fake_verify_3 = {
        'proof': fake_proof_3,
        'public_inputs': [],
        'claim': claim['claim']
    }

    try:
        fake_response_3 = requests.post(f'{ZK_API_URL}/api/zk/verify', json=fake_verify_3)
        fake_result_3 = fake_response_3.json()
        is_rejected = not fake_result_3.get('valid', False)
        print(f'{"✅" if is_rejected else "❌ SECURITY BREACH"} Modified merkle root rejected: {is_rejected}')
    except Exception as e:
        print(f'⚠️  Test failed with error: {e}')

    # Test 6: Wrong claim
    print('\n📝 Test 6: Valid proof with wrong claim')
    fake_verify_4 = {
        'proof': valid_proof,
        'public_inputs': [],
        'claim': 'This is a completely different claim that should not match'
    }

    try:
        fake_response_4 = requests.post(f'{ZK_API_URL}/api/zk/verify', json=fake_verify_4)
        fake_result_4 = fake_response_4.json()
        is_rejected = not fake_result_4.get('valid', False)
        print(f'{"✅" if is_rejected else "❌ SECURITY BREACH"} Wrong claim rejected: {is_rejected}')
    except Exception as e:
        print(f'⚠️  Test failed with error: {e}')

    # Summary
    print('\n' + '=' * 60)
    print('✅ ZK Security Test Complete')
    print('   All fake proofs should be rejected to pass security checks')
    print('=' * 60)

if __name__ == '__main__':
    try:
        test_zk_security()
    except Exception as e:
        print(f'\n❌ Test execution failed: {e}')
        import traceback
        traceback.print_exc()
