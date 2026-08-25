export const driverClientMapping = {
  mysql: 'mysql2',
  mariadb: 'mysql2',
  postgres: 'pg',
  postgresql: 'pg',
  sqlite: 'sqlite3',
};

export const defaultClientPortMapping = {
  mysql: 3306,
  mysql2: 3306,
  postgres: 5432,
  pg: 5432,
};

export const defaultConnectionConfig: any = {
  // https://github.com/knex/knex/issues/97
  // timezone: process.env.NC_TIMEZONE || 'UTC',
  dateStrings: true,
};

export function mysqlTypeCast(field, next) {
  const res = next();

  // Convert buffers to hexadecimal strings, except BIT values which are
  // represented as integers by the data APIs.
  if (res && res instanceof Buffer) {
    const hex = [...res]
      .map((value) => ('00' + value.toString(16)).slice(-2))
      .join('');
    if (field.type === 'BIT') {
      return parseInt(hex, 16);
    }
    return hex;
  }

  if (field.type === 'NEWDECIMAL') {
    return res && parseFloat(res);
  }

  if (field.type === 'TINY' && field.length === 1) {
    return res === null ? null : Boolean(res);
  }

  return res;
}

// default knex options
export const defaultConnectionOptions = {
  pool: {
    min: 0,
    max: +process.env.NC_DB_POOL_MAX || 10,
  },
};

export const avoidSSL = [
  'localhost',
  '127.0.0.1',
  'host.docker.internal',
  '172.17.0.1',
];

export const knownQueryParams = [
  {
    parameter: 'database',
    aliases: ['d', 'db'],
  },
  {
    parameter: 'password',
    aliases: ['p'],
  },
  {
    parameter: 'user',
    aliases: ['u'],
  },
  {
    parameter: 'title',
    aliases: ['t'],
  },
  {
    parameter: 'keyFilePath',
    aliases: [],
  },
  {
    parameter: 'certFilePath',
    aliases: [],
  },
  {
    parameter: 'caFilePath',
    aliases: [],
  },
  {
    parameter: 'ssl',
    aliases: [],
  },
  {
    parameter: 'options',
    aliases: ['opt', 'opts'],
  },
];

export enum DriverClient {
  MYSQL = 'mysql2',
  MYSQL_LEGACY = 'mysql',
  PG = 'pg',
  SQLITE = 'sqlite3',
  SNOWFLAKE = 'snowflake',
  DATABRICKS = 'databricks',
}

export const CHATWOOT_IDENTITY_KEY = process.env.CHATWOOT_IDENTITY_KEY;

export const NC_DISABLE_SUPPORT_CHAT =
  process.env.NC_DISABLE_SUPPORT_CHAT === 'true';

export const NC_IFRAME_WHITELIST_DOMAINS =
  process.env.NC_IFRAME_WHITELIST_DOMAINS || '';
