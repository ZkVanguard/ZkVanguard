/**
 * Test Auto-Rebalance Cron Job
 * 
 * Manually triggers the auto-rebalance cron endpoint to test functionality
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const PRODUCTION_URL = 'https://zkvanguard-nmm4wv0tt-mrarejimmyzs-projects.vercel.app';
const LOCAL_URL = 'http://localhost:3000';

async function testCron(isProduction: boolean = false) {
  const baseUrl = isProduction ? PRODUCTION_URL : LOCAL_URL;
  const url = `${baseUrl}/api/cron/auto-rebalance`;
  
  console.log('\n🧪 Testing Auto-Rebalance Cron Job');
  console.log('=' .repeat(60));
  console.log(`Environment: ${isProduction ? 'PRODUCTION' : 'LOCAL'}`);
  console.log(`URL: ${url}`);
  console.log('=' .repeat(60));
  
  try {
    const cronSecret = process.env.CRON_SECRET?.trim();
    
    if (!cronSecret) {
      console.error('❌ CRON_SECRET not set in environment variables');
      process.exit(1);
    }
    
    console.log('\n📡 Sending request...');
    console.log(`Authorization: Bearer ${cronSecret.substring(0, 10)}...`);
    
    const startTime = Date.now();
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${cronSecret}`,
      },
      timeout: 60000, // 60 seconds
    });
    
    const duration = Date.now() - startTime;
    
    console.log('\n✅ Response received:');
    console.log(`Status: ${response.status}`);
    console.log(`Duration: ${duration}ms`);
    console.log('\nResponse Data:');
    console.log(JSON.stringify(response.data, null, 2));
    
    // Check results
    if (response.data.success) {
      console.log('\n✅ Cron job executed successfully!');
      
      if (response.data.summary) {
        const { total, rebalanced, checked, skipped, errors } = response.data.summary;
        console.log('\n📊 Summary:');
        console.log(`  Total portfolios: ${total}`);
        console.log(`  Rebalanced: ${rebalanced}`);
        console.log(`  Checked: ${checked}`);
        console.log(`  Skipped: ${skipped}`);
        console.log(`  Errors: ${errors}`);
      }
      
      if (response.data.results) {
        console.log('\n📝 Portfolio Results:');
        response.data.results.forEach((result: any) => {
          console.log(`\n  Portfolio ${result.portfolioId}:`);
          console.log(`    Status: ${result.status}`);
          if (result.reason) console.log(`    Reason: ${result.reason}`);
          if (result.drift !== undefined) console.log(`    Drift: ${result.drift.toFixed(2)}%`);
          if (result.txHash) console.log(`    TX Hash: ${result.txHash}`);
          if (result.error) console.log(`    Error: ${result.error}`);
        });
      }
    } else {
      console.log('\n❌ Cron job failed:');
      console.log(response.data.error || 'Unknown error');
    }
    
  } catch (error: any) {
    console.error('\n❌ Error testing cron job:');
    
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Response:', error.response.data);
    } else if (error.request) {
      console.error('No response received from server');
      console.error('Make sure the server is running!');
    } else {
      console.error(error.message);
    }
    
    process.exit(1);
  }
}

// Parse command line args
const args = process.argv.slice(2);
const isProduction = args.includes('--production') || args.includes('-p');

testCron(isProduction).catch(console.error);
