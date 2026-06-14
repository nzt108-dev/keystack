/** Point the data layer at an isolated temp DB for the whole test run. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.KEYSTACK_HOME = mkdtempSync(join(tmpdir(), "keystack-test-"));
