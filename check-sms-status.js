/**
 * Quick SMS Diagnostic Script
 * Run: node check-sms-status.js
 */

const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:3000';

async function checkSMSStatus() {
  console.log('🔍 SMS Diagnostic Check\n');
  console.log('═══════════════════════════════════════\n');

  try {
    // Check all SMS statuses
    console.log('1️⃣  Checking all SMS message statuses...');
    const statusResponse = await axios.get(`${API_URL}/api/esms/status`);
    
    if (statusResponse.data.count === 0) {
      console.log('   ❌ No SMS messages found in system');
      console.log('   This means either:');
      console.log('   - SMS was never attempted');
      console.log('   - ESMS_ENABLED is false');
      console.log('   - Phone number was missing');
      console.log('   - Error occurred before SMS attempt\n');
    } else {
      console.log(`   ✅ Found ${statusResponse.data.count} SMS message(s)\n`);
      statusResponse.data.messages.forEach((msg, index) => {
        console.log(`   Message ${index + 1}:`);
        console.log(`     Transaction ID: ${msg.transactionId}`);
        console.log(`     Phone: ${msg.phone}`);
        console.log(`     Status: ${msg.status}`);
        console.log(`     Sent At: ${msg.sentAt}`);
        if (msg.deliveredAt) {
          console.log(`     Delivered At: ${msg.deliveredAt}`);
        }
        if (msg.errorMessage) {
          console.log(`     ❌ Error: ${msg.errorMessage}`);
        }
        console.log('');
      });
    }

    // Check environment
    console.log('2️⃣  Environment Check:');
    console.log('   Please verify in server/server.env:');
    console.log('   - ESMS_ENABLED=true');
    console.log('   - ESMS_USERNAME=ehands');
    console.log('   - ESMS_PASSWORD=ANVehands!8425');
    console.log('   - ESMS_SENDER_ID=Amila K\n');

    // Check health
    console.log('3️⃣  API Health Check:');
    try {
      const healthResponse = await axios.get(`${API_URL}/health`);
      console.log('   ✅ API is running\n');
    } catch (error) {
      console.log('   ❌ API is not accessible\n');
    }

    console.log('═══════════════════════════════════════');
    console.log('📋 Next Steps:');
    console.log('1. Check server logs for SMS-related messages');
    console.log('2. Verify ESMS_ENABLED=true in server.env');
    console.log('3. Check MongoDB SeatLock for phone number');
    console.log('4. Test Dialog eSMS API directly with Postman');
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Error checking SMS status:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
  }
}

checkSMSStatus();

