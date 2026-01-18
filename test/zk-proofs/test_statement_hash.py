import hashlib

claim = 'settlement_proof'
hash_bytes = hashlib.sha3_256(claim.encode()).digest()
hash_int = int.from_bytes(hash_bytes, 'big')
prime = 6864797660130609714981900799081393217269435300143305409394463459185543183397656052122559640661454554977296311391480858037121987999716643812574028291115057151
statement_hash = hash_int % prime

print(f'Statement hash for "{claim}": {statement_hash}')
print(f'In scientific notation: {statement_hash:.15E}')
print(f'Proof statement hash: 4.46208136224302E+76')
print(f'Match: {abs(statement_hash - 4.46208136224302E+76) < 1e60}')
