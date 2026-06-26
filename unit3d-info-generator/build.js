const fs = require('fs-extra');
const path = require('path');

// Configuration
const SRC_DIR = path.join(__dirname, 'src');
const REPO_ROOT = path.join(__dirname, '..'); // Go up one level to repo root
const MAIN_FILE = 'unit3d-info-generator.user.js';
const MODULES_DIR = path.join(SRC_DIR, 'modules');

// Explicit concatenation order. Classes are hoisted so runtime order doesn't
// strictly matter, but this keeps the bundle readable (deps before users).
const MODULE_ORDER = ['Config', 'Utils', 'DataValidator', 'MediaInfoParser', 'UIHandler'];

// Read the main file
const mainContent = fs.readFileSync(path.join(SRC_DIR, MAIN_FILE), 'utf8');

// Extract the header (metadata block)
const headerMatch = mainContent.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
if (!headerMatch) {
    console.error('Could not find userscript header');
    process.exit(1);
}
const header = headerMatch[0];

// Read all module files in the declared order (warn on any not covered).
const present = fs.readdirSync(MODULES_DIR).filter(f => f.endsWith('.js')).map(f => f.replace('.js', ''));
const missing = present.filter(name => !MODULE_ORDER.includes(name));
if (missing.length) {
    console.warn(`Warning: module(s) not in MODULE_ORDER, appending at end: ${missing.join(', ')}`);
}
const moduleNames = [...MODULE_ORDER.filter(n => present.includes(n)), ...missing];

const moduleFiles = moduleNames.map(name => ({
    name,
    content: fs.readFileSync(path.join(MODULES_DIR, name + '.js'), 'utf8')
}));

// Create the bundled content
let bundledContent = header + '\n\n';

// Add each module as a class (strip ES module syntax for the flat bundle).
moduleFiles.forEach(module => {
    const classContent = module.content
        .replace(/^\s*export\s+/gm, '')                 // drop `export` keyword
        .replace(/^\s*import\s+.*?;\s*$/gm, '')          // drop import lines
        .trim();
    bundledContent += classContent + '\n\n';
});

// Add the main initialization code
bundledContent += `(function () {
    'use strict';

    // Initialize modules
    const config = new Config();
    const utils = new Utils(config);
    const dataValidator = new DataValidator();
    const mediaInfoParser = new MediaInfoParser(dataValidator, utils, config);
    const uiHandler = new UIHandler(mediaInfoParser, utils, config, dataValidator);

    // Start the application
    uiHandler.initialize();
})();
`;

// Write the bundled file to repository root
fs.writeFileSync(path.join(REPO_ROOT, MAIN_FILE), bundledContent);

console.log('Build completed successfully!');
console.log(`Output file: ${path.join(REPO_ROOT, MAIN_FILE)}`);
