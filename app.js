/**
 * Email Webhook Service - Legacy Entry Point
 * 
 * This file maintains backward compatibility.
 * The new architecture is located in src/app.js
 * 
 * To use the new architecture directly:
 * node src/app.js
 */

console.log('🔄 Starting Email Webhook Service...');
console.log('📁 Using new architecture from src/app.js');

// Import and start the new service
const emailWebhookService = require('./src/app');

emailWebhookService.initialize().then(() => {
    emailWebhookService.start();
}).catch((error) => {
    console.error('❌ Failed to start service:', error);
    process.exit(1);
});