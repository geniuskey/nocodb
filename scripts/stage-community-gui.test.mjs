import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stageCommunityGui } from "./stage-community-gui.mjs";

test("replaces a staged GUI tree with generated Community assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-gui-stage-"));
  const source = join(root, "source");
  const target = join(root, "target");

  try {
    await mkdir(join(source, "_nuxt"), { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(join(source, "index.html"), "community GUI\n");
    await writeFile(join(source, "_nuxt", "entry.js"), "export {};\n");
    await writeFile(join(target, "obsolete.js"), "remove me\n");

    await stageCommunityGui({ source, target, allowedRoot: root });

    assert.equal(
      await readFile(join(target, "index.html"), "utf8"),
      "community GUI\n"
    );
    assert.equal(
      await readFile(join(target, "_nuxt", "entry.js"), "utf8"),
      "export {};\n"
    );
    await assert.rejects(readFile(join(target, "obsolete.js")), {
      code: "ENOENT",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects incomplete or unsafe source and target paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "community-gui-stage-"));
  const source = join(root, "source");
  const target = join(root, "target");

  try {
    await mkdir(source, { recursive: true });
    await assert.rejects(
      stageCommunityGui({ source, target, allowedRoot: root }),
      /incomplete/
    );
    await assert.rejects(
      stageCommunityGui({ source, target: root, allowedRoot: root }),
      /must be a child/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
