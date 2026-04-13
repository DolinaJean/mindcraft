// ./src/agent/library/index.js

import * as skills from './skills.js';
import * as world from './world.js';

function docsFromModule(moduleObj, moduleName) {
    const docs = [];

    for (const [name, value] of Object.entries(moduleObj)) {
        if (typeof value !== 'function') continue;

        const docKey = `${name}Doc`;
        const explicitDoc = moduleObj[docKey];

        if (typeof explicitDoc === 'string' && explicitDoc.trim()) {
            docs.push(`${moduleName}.${name}\n${explicitDoc.trim()}`);
        }
    }

    return docs;
}

export function getSkillDocs() {
    let docArray = [];
    docArray = docArray.concat(docsFromModule(skills, 'skills'));
    docArray = docArray.concat(docsFromModule(world, 'world'));
    return docArray;
}