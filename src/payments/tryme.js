const apiUrl = 'https://api.uat.geniebiz.lk/public/v2/transactions';
const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhcHBJZCI6IjM2YmFmY2U3LWEyMDEtNDI5Yi1hOWUyLWM1Yjc4NTQ2Njc3YyIsImNvbXBhbnlJZCI6IjYzOTdmMzlkZjA3ZmJhMDAwODQyYTkwYiIsImlhdCI6MTY3MDkwMjY4NSwiZXhwIjo0ODI2NTc2Mjg1fQ.fy12dgFhA3iB_RCjD7y8j5HClNRZUiBZgAg-QzFpxaE';

const headers = {
  'Accept': 'application/json',
  'Authorization': apiKey,
  'Content-Type': 'application/json',
};

const payload = {
  amount: 400,
  currency: 'LKR',
  localId: 'Test dialog txn local id',
  customer: {
    name: 'dsdsds',
    email: 'akudahewa@gmail.com',
    billingEmail: 'akudahewa@gmail.com',
    billingAddress1: 'dddsdsd',
    billingCity: 'dsdsds',
    billingCountry: 'sri lanka',
    billingPostCode: '11410',
  },
};

async function executeApiCall() {
  try {
    console.log('Making API call to:', apiUrl);
    console.log('Payload:', JSON.stringify(payload, null, 2));
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Error:');
      console.error('Status:', response.status);
      console.error('Response:', JSON.stringify(data, null, 2));
      throw new Error(`API call failed with status ${response.status}`);
    }
    
    console.log('✅ Success!');
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    
    return data;
  } catch (error) {
    console.error('❌ Error:');
    console.error('Error message:', error.message);
    throw error;
  }
}

// Execute the API call
executeApiCall()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch(() => {
    process.exit(1);
  });

