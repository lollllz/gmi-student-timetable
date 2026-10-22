import './build-rust.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('reports-dist', {recursive:true});
await writeFile('reports-dist/index.html', '<!doctype html><html lang="en"><meta charset="utf-8"><title>GMI lift reports</title><h1>Lift reporting service</h1><p>Use the <a href="https://lollllz.github.io/gmi-timetable/">student timetable</a> to view and submit community observations.</p></html>');
