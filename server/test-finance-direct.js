require('dotenv').config();
const app = require('./src/app');
const http = require('http');

const PORT = 5002;

const server = http.createServer(app);

server.listen(PORT, async () => {
  console.log(`Test server running on port ${PORT}`);
  
  // Test without auth first to see raw error
  const pool = require('./src/db/pool');
  const { rows: projects } = await pool.query("SELECT id, name FROM projects WHERE name = 'Finance Module Test Project' LIMIT 1");
  if (projects.length > 0) {
    const pid = projects[0].id;
    
    // Test without auth
    console.log('\n--- Test without auth ---');
    await makeRequest('GET', `/api/projects/${pid}/finance/summary`, null, null);
    
    // Test with auth
    console.log('\n--- Login ---');
    const loginData = JSON.stringify({ email: 'owner@ims.com', password: 'password123' });
    const loginRes = await makeRequest('POST', '/api/auth/login', loginData, null);
    
    if (loginRes.data.token) {
      console.log('\n--- Test with auth ---');
      await makeRequest('GET', `/api/projects/${pid}/finance/summary`, null, loginRes.data.token);
    }
  }
  
  server.close();
  process.exit(0);
});

function makeRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: path,
      method: method,
      headers: {}
    };
    
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = body.length;
    }
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`${method} ${path} - Status: ${res.statusCode}`);
        console.log('Response:', data);
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    
    req.on('error', (e) => {
      console.error('Request error:', e);
      reject(e);
    });
    
    if (body) {
      req.write(body);
    }
    req.end();
  });
}