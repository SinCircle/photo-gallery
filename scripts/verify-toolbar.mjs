// Compatibility entry point: actual 56x32 geometry, spring traces, blur and CLS.
if (!process.argv.some(arg => arg.startsWith('--phase='))) process.argv.push('--phase=motion')
await import('./verify-toolbar-rework.mjs')
