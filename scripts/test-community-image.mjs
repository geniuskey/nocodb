import { spawnSync } from "node:child_process";

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
    readyCommand: ["pg_isready", "-U", "postgres", "-d", "nocodb"],
    connection: (databaseContainer) =>
      `pg://${databaseContainer}:5432?u=postgres&p=password&d=nocodb`,
  },
  mysql: {
    image:
      "mysql:8.3.0@sha256:9de9d54fecee6253130e65154b930978b1fcc336bcc86dfd06e89b72a2588ebe",
    environment: ["MYSQL_ROOT_PASSWORD=password", "MYSQL_DATABASE=nocodb"],
    command: ["--sql-mode="],
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

const database = process.argv[2];
if (!Object.hasOwn(DATABASES, database)) {
  console.error(
    `Usage: pnpm run test:community:image -- ${Object.keys(DATABASES).join(
      "|"
    )}`
  );
  process.exit(1);
}

const applicationImage =
  process.env.COMMUNITY_IMAGE ?? "nocodb-agpl-baseline:dev";
const port = process.env.COMMUNITY_ACCEPTANCE_PORT ?? "18080";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  console.error(
    "COMMUNITY_ACCEPTANCE_PORT must be an integer from 1 to 65535."
  );
  process.exit(1);
}

const suffix = `${process.pid}-${Date.now().toString(36)}`;
const network = `nocodb-community-${suffix}`;
const applicationContainer = `nocodb-community-app-${suffix}`;
const databaseContainer = `nocodb-community-db-${suffix}`;
const packageManagerExecutable = process.env.npm_execpath;

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

function showLogs(container) {
  if (!container) return;
  docker(["logs", "--tail", "80", container], { allowFailure: true });
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
}

async function waitFor(label, predicate, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `${label} did not become ready within ${timeoutSeconds} seconds.`
  );
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  docker(["network", "create", network], { output: "ignore" });
  networkCreated = true;

  const databaseConfig = DATABASES[database];
  if (databaseConfig) {
    const databaseArguments = [
      "run",
      "--detach",
      "--name",
      databaseContainer,
      "--network",
      network,
      ...databaseConfig.environment.flatMap((value) => ["--env", value]),
      databaseConfig.image,
      ...(databaseConfig.command ?? []),
    ];
    docker(databaseArguments, { output: "ignore" });
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
  }

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
  }
  applicationArguments.push(applicationImage);
  docker(applicationArguments, { output: "ignore" });
  applicationStarted = true;

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(
    "Community application",
    async () => {
      if (!isContainerRunning(applicationContainer)) {
        throw new Error(
          "Community application container exited before becoming healthy."
        );
      }
      try {
        const health = await fetchWithTimeout(`${baseUrl}/api/v1/health`);
        if (!health.ok) return false;
        const dashboard = await fetchWithTimeout(`${baseUrl}/dashboard/`);
        return dashboard.ok;
      } catch {
        return false;
      }
    },
    120
  );

  if (!packageManagerExecutable) {
    throw new Error(
      "Run this orchestrator through the documented pnpm script so the pinned package manager is available."
    );
  }
  run(
    packageManagerExecutable,
    ["--filter", "playwright", "run", "ci:test:community"],
    {
      env: { ...process.env, PW_BASE_URL: baseUrl },
    }
  );
  succeeded = true;
  console.log(`Community ${database} image acceptance passed.`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  cleanup();
}
