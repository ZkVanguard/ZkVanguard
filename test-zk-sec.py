#!/usr/bin/env python3
"""ZK Security Test - Verify that fake proofs are properly rejected"""
import requests
import time

ZK_API_URL = 'http://localhost:8000'

def test_zk_security():
    print('[SECURITY TEST] Testing ZK Proof System')
    print('='  * 60)

    # Test 1: Generate a valid proof
    print('\n[TEST 1] Generating valid proof...')
    valid_request = {
        'proof_type': 'settlement',
        'data': {
            'statement': {'claim': 'Valid settlement batch', 'amount': 1000, 'timestamp': int(time.time())},
            'witness': {'secret_value': 42, 'batch_id': 'test_batch_001'}
        }
    }

    try:
        gen_response = requests.post(f'{ZK_API_URL}/api/zk/generate', json=valid_request, timeout=10)
        gen_result = gen_response.json()
        job_id = gen_result['job_id']
        print(f'[OK] Proof generation started: {job_id}')
    except Exception as e:
        print(f'[FAIL] Could not start proof generation: {e}')
        return

    # Poll for completion
    valid_proof = None
    claim = None
    print('[WAIT] Polling for proof completion...')
    for i in range(30):
        time.sleep(1)
        try:
            status_response = requests.get(f'{ZK_API_URL}/api/zk/proof/{job_id}', timeout=5)
            status_result = status_response.json()
            
            if status_result['status'] == 'completed' and status_result['proof']:
                valid_proof = status_result['proof']
                claim = status_result['claim']
                print(f'[OK] Proof generated in {status_result.get("duration_ms", "?")}ms')
                break
            elif status_result['status'] == 'failed':
                print(f'[FAIL] Proof generation failed: {status_result.get("error")}')
                return
            print(f'  Attempt {i+1}/30: {status_result["status"]}')
        except Exception as e:
            print(f'  Poll error: {e}')

    if not valid_proof:
        print('[FAIL] Proof generation timeout')
        return

    print(f'[INFO] Proof details:')
    print(f'  Version: {valid_proof.get("version")}')
    print(f'  Challenge: {str(valid_proof.get("challenge"))[:30]}...')
    print(f'  Response: {str(valid_proof.get("response"))[:30]}...')

    # Test 2: Verify valid proof
    print('\n[TEST 2] Verifying valid proof...')
    valid_verify = {'proof': valid_proof, 'public_inputs': [], 'claim': claim['claim']}

    try:
        valid_verify_response = requests.post(f'{ZK_API_URL}/api/zk/verify', json=valid_verify, timeout=10)
        valid_result = valid_verify_response.json()
        is_valid = valid_result.get('valid', False)
        
        if is_valid:
            print(f'[PASS] Valid proof accepted ({valid_result.get("duration_ms")}ms)')
        else:
            print(f'[FAIL] Valid proof was REJECTED!')
            return
    except Exception as e:
        print(f'[ERROR] Verification failed: {e}')
        return

    results = {'passed': 0, 'failed': 0}

    # Test 3: Modified challenge
    print('\n[TEST 3] Testing fake proof - Modified challenge')
    fake_proof_1 = valid_proof.copy()
    try:
        original = int(valid_proof['challenge'])
        fake_proof_1['challenge'] = str(original + 1)
    except:
        fake_proof_1['challenge'] = '999999999'

    try:
        fake_response = requests.post(f'{ZK_API_URL}/api/zk/verify', 
                                     json={'proof': fake_proof_1, 'public_inputs': [], 'claim': claim['claim']},
                                     timeout=10)
        fake_result = fake_response.json()
        is_rejected = not fake_result.get('valid', False)
        
        if is_rejected:
            print('[PASS] Modified challenge correctly rejected')
            results['passed'] += 1
        else:
            print('[FAIL] SECURITY BREACH: Modified challenge was accepted!')
            results['failed'] += 1
    except Exception as e:
        print(f'[ERROR] Test error: {e}')

    # Test 4: Modified response
    print('\n[TEST 4] Testing fake proof - Modified response')
    fake_proof_2 = valid_proof.copy()
    try:
        original = int(valid_proof['response'])
        fake_proof_2['response'] = str(original + 999)
    except:
        fake_proof_2['response'] = '111111111'

    try:
        fake_response = requests.post(f'{ZK_API_URL}/api/zk/verify',
                                     json={'proof': fake_proof_2, 'public_inputs': [], 'claim': claim['claim']},
                                     timeout=10)
        fake_result = fake_response.json()
        is_rejected = not fake_result.get('valid', False)
        
        if is_rejected:
            print('[PASS] Modified response correctly rejected')
            results['passed'] += 1
        else:
            print('[FAIL] SECURITY BREACH: Modified response was accepted!')
            results['failed'] += 1
    except Exception as e:
        print(f'[ERROR] Test error: {e}')

    # Test 5: Modified merkle root
    print('\n[TEST 5] Testing fake proof - Modified merkle root')
    fake_proof_3 = valid_proof.copy()
    if valid_proof.get('merkle_root'):
        fake_proof_3['merkle_root'] = valid_proof['merkle_root'][:-4] + 'dead'

    try:
        fake_response = requests.post(f'{ZK_API_URL}/api/zk/verify',
                                     json={'proof': fake_proof_3, 'public_inputs': [], 'claim': claim['claim']},
                                     timeout=10)
        fake_result = fake_response.json()
        is_rejected = not fake_result.get('valid', False)
        
        if is_rejected:
            print('[PASS] Modified merkle root correctly rejected')
            results['passed'] += 1
        else:
            print('[FAIL] SECURITY BREACH: Modified merkle root was accepted!')
            results['failed'] += 1
    except Exception as e:
        print(f'[ERROR] Test error: {e}')

    # Test 6: Wrong claim
    print('\n[TEST 6] Testing valid proof with wrong claim')
    try:
        fake_response = requests.post(f'{ZK_API_URL}/api/zk/verify',
                                     json={'proof': valid_proof, 'public_inputs': [], 
                                          'claim': 'Wrong claim that does not match'},
                                     timeout=10)
        fake_result = fake_response.json()
        is_rejected = not fake_result.get('valid', False)
        
        if is_rejected:
            print('[PASS] Wrong claim correctly rejected')
            results['passed'] += 1
        else:
            print('[FAIL] SECURITY BREACH: Wrong claim was accepted!')
            results['failed'] += 1
    except Exception as e:
        print(f'[ERROR] Test error: {e}')

    # Summary
    print('\n' + '=' * 60)
    print(f'[RESULTS] {results["passed"]}/4 security tests passed')
    if results['failed'] == 0:
        print('[SUCCESS] All security tests passed! ZK system is secure.')
    else:
        print(f'[WARNING] {results["failed"]} test(s) failed - system may be vulnerable!')
    print('=' * 60)

if __name__ == '__main__':
    try:
        test_zk_security()
    except KeyboardInterrupt:
        print('\n[CANCELLED] Test interrupted by user')
    except Exception as e:
        print(f'\n[ERROR] Test execution failed: {e}')
        import traceback
        traceback.print_exc()
