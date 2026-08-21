import deepClone from 'src/helpers/deepClone';
import * as swaggerV3ValidationPatch from './swagger-v3-validation-patch.json';
import * as swaggerV3 from './swagger-v3.json';
import * as swagger from './swagger.json';
import * as listView from './list-view.json';
import * as timelineView from './timeline-view.json';
import * as ganttView from './gantt-view.json';
import * as recordTrash from './record-trash.json';

const communitySwagger: any = {
  ...swagger,
  paths: {
    ...swagger.paths,
    ...listView.paths,
    ...timelineView.paths,
    ...ganttView.paths,
    ...recordTrash.paths,
  },
  components: {
    ...swagger.components,
    schemas: {
      ...swagger.components.schemas,
      ...swaggerV3.components.schemas,
      ...listView.components.schemas,
      ...timelineView.components.schemas,
      ...ganttView.components.schemas,
      ...recordTrash.components.schemas,
    },
  },
};

export default communitySwagger;

const swaggerV3Validation = deepClone(swaggerV3);
for (const [key, value] of Object.entries(
  swaggerV3ValidationPatch.components.schemas,
)) {
  swaggerV3Validation.components.schemas[key] = value;
}

export { swaggerV3, swaggerV3Validation };
