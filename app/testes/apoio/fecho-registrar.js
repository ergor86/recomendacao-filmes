// Usado com `node --import`: registra o gancho de resolução que grava o fecho de imports.
import { register } from 'node:module';

register('./fecho-gancho.js', import.meta.url);
