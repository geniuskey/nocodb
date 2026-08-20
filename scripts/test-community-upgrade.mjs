import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATABASES = {
  sqlite: null,
  postgres: {
    image:
      "postgres:16.6@sha256:557fea37a744d5f4c8faab304b0a90858b53ab119735a88c131fd19dab802f36",
    environment: [
      "POSTGRES_USER=postgres",
      "POSTGRES_PASSWORD=password",
      "POSTGRES_DB=nocodb",
    ],
    containerPort: "5432",
    readyCommand: ["pg_isready", "-U", "postgres", "-d", "nocodb"],
    connection: (databaseContainer) =>
      `pg://${databaseContainer}:5432?u=postgres&p=password&d=nocodb`,
  },
  mysql: {
    image:
      "mysql:8.3.0@sha256:9de9d54fecee6253130e65154b930978b1fcc336bcc86dfd06e89b72a2588ebe",
    environment: ["MYSQL_ROOT_PASSWORD=password", "MYSQL_DATABASE=nocodb"],
    command: ["--sql-mode="],
    containerPort: "3306",
    readyCommand: [
      "mysqladmin",
      "ping",
      "--host=127.0.0.1",
      "--user=root",
      "--password=password",
      "--silent",
    ],
    connection: (databaseContainer) =>
      `mysql2://${databaseContainer}:3306?u=root&p=password&d=nocodb`,
  },
};

const commandArguments = process.argv.slice(2);
if (commandArguments[0] === "--") commandArguments.shift();
const database = commandArguments[0];
if (commandArguments.length !== 1 || !Object.hasOwn(DATABASES, database)) {
  console.error(
    `Usage: pnpm run test:community:upgrade -- ${Object.keys(DATABASES).join(
      "|"
    )}`
  );
  process.exit(1);
}

const packageManagerExecutable = process.env.npm_execpath;
if (!packageManagerExecutable) {
  throw new Error(
    "Run this orchestrator through the documented pnpm script so the pinned package manager is available."
  );
}

const applicationImage =
  process.env.COMMUNITY_IMAGE ?? "nocodb-agpl-baseline:dev";
const port = process.env.COMMUNITY_UPGRADE_PORT ?? "18081";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error("COMMUNITY_UPGRADE_PORT must be an integer from 1 to 65535.");
}
const suffix = `${process.pid}-${Date.now().toString(36)}`;
const network = `nocodb-upgrade-${suffix}`;
const applicationContainer = `nocodb-upgrade-app-${suffix}`;
const databaseContainer = `nocodb-upgrade-db-${suffix}`;
const sqliteDirectory =
  database === "sqlite"
    ? mkdtempSync(join(tmpdir(), "nocodb-upgrade-fixture-"))
    : null;

let applicationStarted = false;
let databaseStarted = false;
let networkCreated = false;
let succeeded = false;

function run(
  command,
  args,
  { env = process.env, output = "inherit", allowFailure = false } = {}
) {
  const result = spawnSync(command, args, {
    env,
    encoding: output === "pipe" ? "utf8" : undefined,
    stdio: output,
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(
      `${command} exited with status ${result.status ?? "unknown"}.`
    );
  }
  return result;
}

function docker(args, options) {
  return run("docker", args, options);
}

function isContainerRunning(container) {
  const result = docker(["inspect", "--format={{.State.Running}}", container], {
    allowFailure: true,
    output: "pipe",
  });
  return result.status === 0 && result.stdout.trim() === "true";
}

async function waitFor(label, predicate, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${label} did not become ready within ${timeoutSeconds}s.`);
}

async function waitForApplication() {
  await waitFor(
    "Community application",
    async () => {
      if (!isContainerRunning(applicationContainer)) {
        throw new Error(
          "Community application container exited before becoming healthy."
        );
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2_000);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
          signal: controller.signal,
        });
        return response.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(timeout);
      }
    },
    120
  );
}

function fixture(mode, endpoint) {
  run(packageManagerExecutable, [
    "--filter",
    "nocodb",
    "exec",
    "node",
    "-r",
    "@swc-node/register",
    "scripts/community-upgrade-fixture.ts",
    mode,
    database,
    endpoint,
  ]);
}

function publishedPort(containerPort) {
  const result = docker(["port", databaseContainer, `${containerPort}/tcp`], {
    output: "pipe",
  });
  const match = result.stdout.trim().match(/:(\d+)$/);
  if (!match) throw new Error(`Could not resolve published ${containerPort}.`);
  return match[1];
}

function showLogs(container) {
  if (container) {
    docker(["logs", "--tail", "100", container], { allowFailure: true });
  }
}

function cleanup() {
  if (!succeeded) {
    showLogs(applicationStarted ? applicationContainer : null);
    showLogs(databaseStarted ? databaseContainer : null);
  }
  if (applicationStarted) {
    docker(["rm", "--force", applicationContainer], {
      allowFailure: true,
      output: "ignore",
    });
  }
  if (databaseStarted) {
    docker(["rm", "--force", databaseContainer], {
      allowFailure: true,
      output: "ignore",
    });
  }
  if (networkCreated) {
    docker(["network", "rm", network], {
      allowFailure: true,
      output: "ignore",
    });
  }
  if (sqliteDirectory) {
    rmSync(sqliteDirectory, { recursive: true, force: true });
  }
}

async function main() {
  docker(["network", "create", network], { output: "ignore" });
  networkCreated = true;

  const databaseConfig = DATABASES[database];
  let endpoint;
  if (databaseConfig) {
    docker(
      [
        "run",
        "--detach",
        "--name",
        databaseContainer,
        "--network",
        network,
        "--publish",
        `127.0.0.1::${databaseConfig.containerPort}`,
        ...databaseConfig.environment.flatMap((value) => ["--env", value]),
        databaseConfig.image,
        ...(databaseConfig.command ?? []),
      ],
      { output: "ignore" }
    );
    databaseStarted = true;
    await waitFor(
      `${database} container`,
      () =>
        isContainerRunning(databaseContainer) &&
        docker(["exec", databaseContainer, ...databaseConfig.readyCommand], {
          allowFailure: true,
          output: "ignore",
        }).status === 0,
      120
    );
    endpoint = publishedPort(databaseConfig.containerPort);
  } else {
    endpoint = join(sqliteDirectory, "noco.db");
  }

  fixture("seed", endpoint);

  const applicationArguments = [
    "run",
    "--detach",
    "--name",
    applicationContainer,
    "--network",
    network,
    "--publish",
    `${port}:8080`,
  ];
  if (databaseConfig) {
    applicationArguments.push(
      "--env",
      `NC_DB=${databaseConfig.connection(databaseContainer)}`
    );
  } else {
    applicationArguments.push(
      "--mount",
      `type=bind,source=${sqliteDirectory},target=/usr/app/data`
    );
  }
  applicationArguments.push(applicationImage);
  docker(applicationArguments, { output: "ignore" });
  applicationStarted = true;

  await waitForApplication();
  fixture("verify", endpoint);

  docker(["restart", applicationContainer], { output: "ignore" });
  await waitForApplication();
  fixture("verify", endpoint);

  succeeded = true;
  console.log(
    `Community ${database} upgrade from v2025.10.0 and restart passed.`
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  cleanup();
}
