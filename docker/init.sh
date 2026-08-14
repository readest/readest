#!/usr/bin/env node

/**
 * Readest Docker Environment Initializer
 * Generates secure, matching JWT keys, passwords, and writes docker/.env.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envExamplePath = path.join(__dirname, '.env.example');
const envDestPath = path.join(__dirname, '.env');

function generateRandomString(length = 32) {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

function base64Url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signHS256(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const tokenInput = `${base64Url(header)}.${base64Url(payload)}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(tokenInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
    
  return `${tokenInput}.${signature}`;
}

async function main() {
  console.log('=== Initializing Readest Docker Environment ===');

  if (fs.existsSync(envDestPath)) {
    console.log('  -> docker/.env already exists. Skipping initialization to protect existing settings.');
    process.exit(0);
  }

  if (!fs.existsSync(envExamplePath)) {
    console.error(`  -> Error: .env.example not found at ${envExamplePath}`);
    process.exit(1);
  }

  console.log('  -> Generating secure secrets and keys...');
  const jwtSecret = generateRandomString(32);
  const dbPassword = generateRandomString(32);
  const minioPassword = generateRandomString(32);

  // Generate Supabase JWTs
  const anonKey = signHS256({ role: 'anon' }, jwtSecret);
  const serviceKey = signHS256({ role: 'service_role' }, jwtSecret);

  // Read .env.example
  let envContent = fs.readFileSync(envExamplePath, 'utf8');

  // Replace values
  envContent = envContent
    .replace(/^POSTGRES_PASSWORD=.*/m, `POSTGRES_PASSWORD=${dbPassword}`)
    .replace(/^JWT_SECRET=.*/m, `JWT_SECRET=${jwtSecret}`)
    .replace(/^ANON_KEY=.*/m, `ANON_KEY=${anonKey}`)
    .replace(/^SERVICE_ROLE_KEY=.*/m, `SERVICE_ROLE_KEY=${serviceKey}`)
    .replace(/^MINIO_ROOT_PASSWORD=.*/m, `MINIO_ROOT_PASSWORD=${minioPassword}`);

  // Write .env
  fs.writeFileSync(envDestPath, envContent, 'utf8');
  console.log('  -> Successfully generated docker/.env with secure matching keys!');
  console.log('\nReady to start the stack:');
  console.log('  cd docker && docker compose up -d');
  console.log('==============================================');
}

main().catch(err => {
  console.error('Initialization failed:', err);
  process.exit(1);
});
