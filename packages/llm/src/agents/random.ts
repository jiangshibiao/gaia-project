import { RandomAgent } from '@gaia/engine';
import type { AgentPlugin } from './contract.js';

const plugin: AgentPlugin = {
  meta: {
    name: 'random',
    version: '1.0.0',
    description: 'Uniform random over legal actions (seeded per seat)',
    author: 'gaia-project',
  },
  create: ({ seat }) => {
    const agent = new RandomAgent(1234 + seat);
    return {
      decide: ({ state, legal }) => agent.chooseAction(state, legal),
    };
  },
};

export default plugin;
