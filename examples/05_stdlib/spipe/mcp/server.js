#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRouter } from "./protocol/router.js";
import { runStdioTransport } from "./transport/stdio.js";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
runStdioTransport(createRouter({ moduleRoot }));
