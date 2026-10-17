import { createApp } from './app.js';
import { config, getConfigSummary } from './config.js';

const app = createApp();

const server = app.listen(config.PORT, config.HOST, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Codebase Explainer AI Backend Server is running!`);
  console.log(`📡 URL: http://${config.HOST === '0.0.0.0' ? 'localhost' : config.HOST}:${config.PORT}`);
  console.log(`⚙️  Environment: ${config.NODE_ENV}`);
  console.log(`🔑 Gemini Configured: ${getConfigSummary().geminiConfigured ? 'YES (' + config.GEMINI_MODEL + ')' : 'NO (fallback parsing enabled)'}`);
  console.log(`🐙 GitHub Token Configured: ${getConfigSummary().githubTokenConfigured ? 'YES (5,000 req/hr)' : 'NO (60 req/hr public)'}`);
  console.log(`=======================================================`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});
