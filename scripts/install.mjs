#!/usr/bin/env node
import { cli, installFromEnvironment } from '../src/plugininstall.mjs';

cli(process.argv, installFromEnvironment);
