import { query } from '../lib/db/postgres';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function checkHedges() {
  try {
    // First check what columns exist
    const columns = await query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'hedges' ORDER BY ordinal_position
    `);
    console.log('Columns in hedges table:');
    console.log(columns.map((c: { column_name: string }) => c.column_name).join(', '));
    
    // Check recent hedges
    const result = await query(`
      SELECT order_id, asset, side, status, created_at 
      FROM hedges 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    
    console.log('\nRecent hedges in database:');
    console.log(JSON.stringify(result, null, 2));
    
    // Check for the specific hedge
    const specificHedge = await query(
      `SELECT * FROM hedges WHERE order_id = $1`,
      ['sim-hedge-1770228114651']
    );
    
    console.log('\nSpecific hedge lookup:');
    console.log(JSON.stringify(specificHedge, null, 2));
    
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

checkHedges();
