const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0'; // Bind to all interfaces for Databricks Apps

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, 'frontend')));

// SPA fallback - serve index.html for all routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Frontend server running on ${HOST}:${PORT}`);
});
