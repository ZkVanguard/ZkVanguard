import json

data = {
    'privacy_enhancements': {
        'witness_blinding': False,
        'multi_polynomial': False
    },
    'statement_hash': 44620813622430180211862061922014157571665447624715181525936334993318593500646
}

print("=== Trying json.dumps ===")
try:
    result = json.dumps(data)
    print("Success!")
    print(result[:200])
except Exception as e:
    print(f"Error: {e}")

print("\n=== Parsed back ===")
parsed = json.loads(json.dumps(data))
print(f"witness_blinding: {parsed['privacy_enhancements']['witness_blinding']} (type: {type(parsed['privacy_enhancements']['witness_blinding'])})")
print(f"statement_hash: {parsed['statement_hash']} (type: {type(parsed['statement_hash'])})")
