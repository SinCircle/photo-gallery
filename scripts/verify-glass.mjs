// Compatibility entry point for the current persistent-renderer verification.
// Pixel latency has its own three-state test: verify-glass-latency.mjs.
if (!process.argv.some(arg => arg.startsWith('--phase='))) process.argv.push('--phase=refraction')
await import('./verify-toolbar-rework.mjs')
