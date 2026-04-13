import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { Character } from '@elizaos/core';

const __dirname = dirname(fileURLToPath(import.meta.url));

const characterPath = join(__dirname, '..', 'characters', 'agent.character.json');

export const character = JSON.parse(readFileSync(characterPath, 'utf-8')) as Character;
