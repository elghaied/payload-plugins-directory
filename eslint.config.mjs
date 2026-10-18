import coreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

// eslint-config-next 16 ships native flat configs; FlatCompat (per the original plan)
// crashes on its circular plugin objects, so they are imported directly.
export default [
  { ignores: ['.next/**', 'node_modules/**', 'src/payload-types.ts', 'src/migrations/**', 'src/app/(payload)/**'] },
  ...coreWebVitals,
  ...nextTypescript,
  {
    // Pre-existing code flagged by the React Compiler rules bundled in eslint-config-next 16
    // (mount-flag effect, Date.now() in useMemo). Not rewritten in the toolchain task.
    files: ['src/components/PluginDirectory/index.tsx', 'src/components/mode-toggler.tsx'],
    rules: { 'react-hooks/set-state-in-effect': 'off', 'react-hooks/purity': 'off' },
  },
]
