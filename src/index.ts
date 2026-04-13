import { logger, type IAgentRuntime, type Project, type ProjectAgent } from '@elizaos/core';
import { character } from './character.js';
import { apertureStewardPlugin } from './plugin.js';

const initAgent = async (runtime: IAgentRuntime) => {
  logger.info({ name: runtime.character.name }, 'Aperture Steward runtime ready');
};

export const projectAgent: ProjectAgent = {
  character,
  init: initAgent,
  plugins: [apertureStewardPlugin],
};

const project: Project = {
  agents: [projectAgent],
};

export { character } from './character.js';

export default project;
