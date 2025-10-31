// ==UserScript==
// @name         UNIT3D chatbox - bbcode
// @version      v1.2
// @description  BBCode buttons
// @match        https://utp.to/
// @updateURL    https://raw.githubusercontent.com/maksii/utp-script/main/unit3d-chatbox-bbcode.user.js
// @downloadURL  https://raw.githubusercontent.com/maksii/utp-script/main/unit3d-chatbox-bbcode.user.js
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const selectors = {
        chatbox: '#chatbox__messages-create',
        chatMessages: '.chatroom__messages',
        bbCodesButton: '#bbCodesButton',
        bbCodesPanel: '#bbCodesPanel'
    };
    const templates = {
        bbCodes: `
            <menu class="bbcode-input__icon-bar" id="bbCodesPanel">
                <li><button class="form__standard-icon-button" data-bbcode="[b][/b]"><abbr title="Bold"><i class="fas fa-bold"></i></abbr></button></li>
                <li><button class="form__standard-icon-button" data-bbcode="[i][/i]"><abbr title="Italics"><i class="fas fa-italic"></i></abbr></button></li>
                <li><button class="form__standard-icon-button" data-bbcode="[u][/u]"><abbr title="Underline"><i class="fas fa-underline"></i></abbr></button></li>
                <hr class="bbcode-input__icon-separator">
                <li><button class="form__standard-icon-button" data-bbcode="[img][/img]"><abbr title="Insert Image"><i class="fas fa-image"></i></abbr></button></li>
                <li><button class="form__standard-icon-button" data-bbcode="[url][/url]"><abbr title="Link"><i class="fas fa-link"></i></abbr></button></li>
                <hr class="bbcode-input__icon-separator">
                <li><button class="form__standard-icon-button" data-bbcode="[color=][/color]"><abbr title="Color"><i class="fas fa-palette"></i></abbr></button></li>
                <li><button class="form__standard-icon-button" data-bbcode="[font=][/font]"><abbr title="Font"><i class="fas fa-font"></i></abbr></button></li>
                <li><button class="form__standard-icon-button" data-bbcode="[list][/list]"><abbr title="List"><i class="fas fa-list"></i></abbr></button></li>
                <hr class="bbcode-input__icon-separator">
                <li><button class="form__standard-icon-button" data-bbcode="[quote][/quote]"><abbr title="Quote"><i class="fas fa-quote-right"></i></abbr></button></li>
                <li><button class="form__standard-icon-button" data-bbcode="[code][/code]"><abbr title="Code"><i class="fas fa-code"></i></abbr></button></li>
                <li><button class="form__standard-icon-button" data-bbcode="[spoiler][/spoiler]"><abbr title="Spoiler"><i class="fas fa-eye-slash"></i></abbr></button></li>
                <hr class="bbcode-input__icon-separator">
                <li><button class="form__standard-icon-button" data-bbcode=":thumbsup:"><abbr title="Like"><i class="fas fa-thumbs-up"></i></abbr></button></li>
                <li><button class="form__standard-icon-button" data-bbcode=":thumbsdown:"><abbr title="Dislike"><i class="fas fa-thumbs-down"></i></abbr></button></li>
                <li><button class="form__standard-icon-button" data-bbcode=":rofl:"><abbr title="ROFL"><i class="fa-solid fa-face-grin-squint-tears"></i></abbr></button></li>
                <li><button class="form__standard-icon-button" data-bbcode=":cry:"><abbr title="Cry"><i class="fas fa-sad-tear"></i></abbr></button></li>
<hr class="bbcode-input__icon-separator">
            </menu>
        `,
    };

    const setupBBCodePanel = () => {
        const container = document.createElement('div');
        container.innerHTML = templates.bbCodes;
        document.querySelector(selectors.chatbox).parentNode.insertBefore(container, document.querySelector(selectors.chatbox).nextSibling);
        document.querySelectorAll('button[data-bbcode]').forEach(button => {
            button.addEventListener('click', (event) => {
                event.preventDefault();  // Prevent the default form submission
                event.stopPropagation(); // Prevent event propagation
                insertBBCode(button.dataset.bbcode);
            });
        });
    };

    function handleClipboard(tag, chatbox, appendNewline = false) {
        if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText().then(clipText => {
                const newContent = clipText.trim().length > 0
                    ? tag.replace(/(\[.*?\])(.*?)(\[\/.*?\])/, `$1${clipText}$3`)
                    : tag.replace(/(\[.*?\])(.*?)(\[\/.*?\])/, `$1$2$3`);
                appendToChatbox(chatbox, newContent, appendNewline);
            }).catch(err => {
                console.error('Failed to read clipboard contents:', err);
                appendBBCodeOnly(tag, chatbox, appendNewline);
            });
        } else {
            console.warn('Clipboard API not available. Falling back to BBCode only.');
            appendBBCodeOnly(tag, chatbox, appendNewline);
        }
    }

    function appendToChatbox(chatbox, content, appendNewline) {
        chatbox.value += content + (appendNewline ? "\n" : " ");
        const pos = chatbox.value.length;
        chatbox.setSelectionRange(pos, pos);
        chatbox.focus();
    }

    function appendBBCodeOnly(tag, chatbox, appendNewline) {
        const newContent = tag.replace(/(\[.*?\])(.*?)(\[\/.*?\])/, `$1$2$3`);
        appendToChatbox(chatbox, newContent, appendNewline);
    }

    function insertBBCode(bbCode) {
        let chatbox = document.querySelector(selectors.chatbox);
        const startTag = bbCode.substring(0, bbCode.indexOf(']') + 1);
        const endTag = bbCode.substring(bbCode.lastIndexOf('['));

        if (startTag === '[img]' && endTag === '[/img]') {
            handleClipboard(bbCode, chatbox, true);
        } else if (startTag === '[url]' && endTag === '[/url]') {
            handleClipboard(bbCode, chatbox, false);
        } else if (startTag === '[code]' && endTag === '[/code]') {
            handleClipboard(bbCode, chatbox, true);
        } else if (startTag === '[spoiler]' && endTag === '[/spoiler]') {
            handleClipboard(bbCode, chatbox, false);
        } else if (startTag === '[quote]' && endTag === '[/quote]') {
            handleQuote(bbCode, chatbox);
        } else {
            const textSelected = chatbox.value.substring(chatbox.selectionStart, chatbox.selectionEnd);
            if (textSelected.length > 0) {
                const newText = startTag + textSelected + endTag;
                chatbox.value = chatbox.value.substring(0, chatbox.selectionStart) + newText + " " + chatbox.value.substring(chatbox.selectionEnd);
                const newPos = chatbox.value.lastIndexOf(' ') + 1;
                chatbox.setSelectionRange(newPos, newPos);
            } else {
                const pos = chatbox.selectionStart + startTag.length;
                chatbox.value += startTag + endTag + " ";
                chatbox.setSelectionRange(pos, pos);
            }
            chatbox.focus();
        }
    }

    function handleQuote(tag, chatbox) {
        const selection = window.getSelection().toString();
        if (selection.length > 0) {
            // Check if the selection is from a chatbox message
            const focusNode = window.getSelection().focusNode;
            const messageArticle = focusNode?.parentNode?.parentNode;
            let quoteTag = '[quote]';
            
            if (messageArticle && messageArticle.classList.contains('chatbox-message')) {
                const username = messageArticle.querySelector('.chatbox-message__address.user-tag span, .message-username span')?.innerText;
                if (username) {
                    quoteTag = `[quote=@${username}]`;
                }
            }
            
            const newContent = quoteTag + selection + '[/quote]';
            appendToChatbox(chatbox, newContent, false);
        } else {
            // No selection, try to use clipboard
            handleClipboard(tag, chatbox, false);
        }
    }

    const init = () => {
        if (!document.querySelector(selectors.chatbox) || !document.querySelector(selectors.chatMessages)) {
            console.error('Chatbox or chat messages not found. Retrying in 1 second...');
            setTimeout(init, 1000); // Retry after 1 second
            return;
        }

        setupBBCodePanel();

    };

    init();
})();
