import {readdirSync} from 'node:fs';import {spawnSync} from 'node:child_process';
const files=readdirSync('tests').filter(file=>file.endsWith('.test.mjs')).map(file=>`tests/${file}`);const result=spawnSync(process.execPath,['--import','tsx','--test',...files],{stdio:'inherit'});process.exit(result.status??1);
