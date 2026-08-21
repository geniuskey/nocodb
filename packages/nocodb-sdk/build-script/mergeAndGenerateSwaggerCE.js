const { writeFileSync, readFileSync } = require('fs');
// import {mergeSwaggerSchema} from "../../src";

const swaggerV3 = JSON.parse(
  readFileSync('../nocodb/src/schema/swagger-v3.json', 'utf8'),
  (key, value) => {
    if (key === '$ref') {
      return value.replace(/^(#\/components\/schemas\/)(\w+)$/, '$1$2V3');
    }
    return value;
  }
);
swaggerV3.components.schemas = Object.entries(
  swaggerV3.components.schemas
).reduce((acc, [key, value]) => {
  return {
    [key + 'V3']: value,
    ...acc,
  };
}, {});

const swaggerCE = JSON.parse(
  readFileSync('../nocodb/src/schema/swagger.json', 'utf8')
);
const listView = JSON.parse(
  readFileSync('../nocodb/src/schema/list-view.json', 'utf8')
);
const timelineView = JSON.parse(
  readFileSync('../nocodb/src/schema/timeline-view.json', 'utf8')
);
const ganttView = JSON.parse(
  readFileSync('../nocodb/src/schema/gantt-view.json', 'utf8')
);
const recordTrash = JSON.parse(
  readFileSync('../nocodb/src/schema/record-trash.json', 'utf8')
);
const swagger = {
  ...swaggerCE,
  paths: {
    ...swaggerCE.paths,
    ...listView.paths,
    ...timelineView.paths,
    ...ganttView.paths,
    ...recordTrash.paths,
  },
  components: {
    ...swaggerCE.components,
    schemas: {
      ...swaggerV3.components.schemas,
      ...swaggerCE.components.schemas,
      ...listView.components.schemas,
      ...timelineView.components.schemas,
      ...ganttView.components.schemas,
      ...recordTrash.components.schemas,
    },
    responses: {
      ...swaggerCE.components.responses,
    },
  },
};

swagger.components.schemas.View.properties.view.anyOf.push({
  $ref: '#/components/schemas/List',
});
swagger.components.schemas.View.properties.view.anyOf.push({
  $ref: '#/components/schemas/Timeline',
});
swagger.components.schemas.View.properties.view.anyOf.push({
  $ref: '#/components/schemas/Gantt',
});

writeFileSync('nc_swagger.json', JSON.stringify(swagger));
