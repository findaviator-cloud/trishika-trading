import express from 'express';
import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

const router = express.Router();

router.get('/disk', (req, res) => {
  const secret = process.env.DIAG_SECRET;

  if (!secret || req.headers['x-diag-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  exec(
    `du -sh ${projectRoot}/* 2>/dev/null | sort -rh | head -30`,
    { timeout: 10_000 },
    (err, stdout, stderr) => {
      if (err) {
        return res.status(500).json({ error: err.message, stderr });
      }

      const lines = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [size, ...rest] = line.trim().split(/\s+/);
          return { size, path: rest.join(' ') };
        });

      return res.json({
        checkedAtUtc: new Date().toISOString(),
        projectRoot,
        breakdown: lines
      });
    }
  );
});

export default router;
