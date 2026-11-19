#!/usr/bin/env node
import { cli, uninstallFromEnvironment } from '../src/plugininstall.mjs';

cli(process.argv, uninstallFromEnvironment);
