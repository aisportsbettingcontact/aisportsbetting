// test_kprops_fix.mjs - Test K-Props date format fix for April 6, 2026
import { createRequire } from 'module';
import { spawn } from 'child_process';

const require = createRequire(import.meta.url);

// Use tsx to run the TypeScript file
const proc = spawn('npx', ['tsx', '--tsconfig', 'tsconfig.json', 'test_kprops_ts.ts'], {
  cwd: '/home/ubuntu/ai-sports-betting',
  stdio: 'inherit',
  env: { ...process.env }
});

proc.on('exit', (code) => {
  process.exit(code ?? 0);
});
