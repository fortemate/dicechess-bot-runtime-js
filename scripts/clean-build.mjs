import { rm } from "node:fs/promises";

// Only this repository's generated build directory; never based on caller cwd.
await rm(new URL("../dist/", import.meta.url), {
  recursive: true,
  force: true,
});
