import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scenario, statement, witness } = body;

    // Create a temporary Python script to generate proof
    const scriptContent = `
import json
import sys
from zkp.core.zk_system import AuthenticZKStark

zk = AuthenticZKStark()

statement = ${JSON.stringify(statement)}
witness = ${JSON.stringify(witness)}

result = zk.generate_proof(statement, witness)
proof = result['proof']

# Output proof as JSON
print(json.dumps({
    'success': True,
    'proof': proof,
    'statement': statement,
    'scenario': '${scenario}'
}))
`;

    const scriptPath = path.join(process.cwd(), 'temp_generate_proof.py');
    await fs.writeFile(scriptPath, scriptContent);

    // Execute Python script
    const { stdout, stderr } = await execAsync(`python "${scriptPath}"`, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    // Clean up
    await fs.unlink(scriptPath).catch(() => {});

    if (stderr && !stderr.includes('ZK Core System loaded')) {
      console.error('Python stderr:', stderr);
    }

    // Parse the last line of output (the JSON result)
    const lines = stdout.trim().split('\n');
    const jsonLine = lines[lines.length - 1];
    const result = JSON.parse(jsonLine);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error generating proof:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
