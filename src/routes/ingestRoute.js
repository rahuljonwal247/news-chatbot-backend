
const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');

router.post('/ingest', (req, res) => {
  const ingestProcess = spawn('node', ['scripts/ingest-news.js']);

  // Collect logs
  ingestProcess.stdout.on('data', (data) => {
    console.log(`[stdout]: ${data.toString()}`);
  });

  ingestProcess.stderr.on('data', (data) => {
    console.error(`[stderr]: ${data.toString()}`);
  });

  ingestProcess.on('close', (code) => {
    console.log(`Ingest process exited with code ${code}`);
    if (code === 0) {
      res.send('Ingestion script executed successfully');
    } else {
      res.status(500).send('Ingestion script failed');
    }
  });

  ingestProcess.on('error', (err) => {
    console.error('Failed to start ingestion process:', err);
    res.status(500).send('Failed to start ingestion script');
  });
});

module.exports = router;
