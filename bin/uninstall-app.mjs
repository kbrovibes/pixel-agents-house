#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const LABEL = 'com.pixelagents.house';
const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
if (process.platform === 'darwin') spawnSync('launchctl', ['bootout', `gui/${process.getuid()}`, plistPath], { stdio: 'ignore' });
if (fs.existsSync(plistPath)) { fs.unlinkSync(plistPath); console.log(`Removed ${plistPath}. The server is stopped and will not start at login.`); }
else console.log('Nothing to remove: the launch agent was not installed.');
