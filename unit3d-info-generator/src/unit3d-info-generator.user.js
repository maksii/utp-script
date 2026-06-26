// ==UserScript==
// @name         MediaInfo Parser for Release
// @namespace    https://github.com/maksii/utp-script
// @author       maksii
// @version      2.0.0
// @description  Parse MediaInfo on UNIT3D torrent create/view pages into a clean, validated track table with copy-to-clipboard.
// @match        *://*/torrents/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/maksii/utp-script/main/unit3d-info-generator.user.js
// @downloadURL  https://raw.githubusercontent.com/maksii/utp-script/main/unit3d-info-generator.user.js
// ==/UserScript==

import { MediaInfoParser } from './modules/MediaInfoParser.js';
import { UIHandler } from './modules/UIHandler.js';
import { DataValidator } from './modules/DataValidator.js';
import { Config } from './modules/Config.js';
import { Utils } from './modules/Utils.js';

(function () {
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
