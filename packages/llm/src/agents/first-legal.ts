import type { AgentPlugin } from './contract.js';

const plugin: AgentPlugin = {
  meta: {
    name: 'first-legal',
    version: '1.0.0',
    description: 'Toy example: always plays the first legal action',
    author: 'gaia-project',
  },
  create: () => ({
    decide: ({ legal }) => legal[0]!,
  }),
};

export default plugin;
