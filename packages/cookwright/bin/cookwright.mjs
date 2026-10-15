#!/usr/bin/env node
// The `cookwright` bin. No entry guard: the bin is always reached through a symlink
// (node_modules/.bin/cookwright), where an import.meta.url check is false.
import { dispatch } from '../src/cli-main.mjs';

process.exitCode = await dispatch(process.argv.slice(2));
