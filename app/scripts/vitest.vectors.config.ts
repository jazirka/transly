import { defineConfig } from 'vitest/config';

// Окремий запуск: генерує «золоті вектори» для rust/transly-core (npm run vectors). До звичайного `npm test` не входить.
export default defineConfig({ test: { include: ['scripts/vectors/**/*.vec.ts'], expect: { requireAssertions: false } } });
