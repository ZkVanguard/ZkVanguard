import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { proof, statement } = body;

    // Create a temporary Python script to verify proof
    const scriptContent = `
import json
import sys
from zkp.core.zk_system import AuthenticZKStark

zk = AuthenticZKStark()

proof = ${JSON.stringify(proof)}
statement = ${JSON.stringify(statement)}

verified = zk.verify_proof(proof, statement)

print(json.dumps({
    'success': True,
    'verified': verified
}))
`;

    const scriptPath = path.join(process.cwd(), 'temp_verify_proof.py');
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
    console.error('Error verifying proof:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
