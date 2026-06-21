# UTOPIA Indexer Configurations for Prowlarr

This repository contains different versions of indexer configurations for [UTOPIA](https://utp.to/). These configurations work with [Prowlarr](https://github.com/Prowlarr/Prowlarr) to provide enhanced functionality and improved metadata parsing.

## Available Versions

### 1. utopia.yml (Current official Version)
The current version that's included in the official Prowlarr repository. This is based on the file at [Prowlarr/Indexers](https://github.com/Prowlarr/Indexers/blob/master/definitions/v11/utopia.yml).

### 2. utp-exp_base.yml (Stable Enhanced Version)
A modestly enhanced version with quality-of-life improvements while maintaining stability.

**Enhancements over standard version:**
- Changed default value of `single_file_release_use_filename` from true to false
- Changed default value of `addukrainiantotitle` from false to true
- Added new setting `addreleasegroupbyuploader` (default: true)
- Added new setting `fixtvyear` (default: true)
- Added new selectors and fields: `uploader`, `release_year`, `categoryname`
- Added regex pattern for `addukrainiantotitle` to append UKR tag after quality indicators (2160p, 1080p, etc.)
- Added regex pattern for `addreleasegroupbyuploader` to add uploader as release group when no release group present
- Added regex pattern for `fixtvyear` to fix TV year positioning and release year
- Added replacements: "BDRemux" → "BluRay REMUX" and "BDRip" → "BluRay"

### 3. utp-exp.yml (Latest WIP Version)
The most advanced version with extensive language parsing and customization options.

**Enhancements over exp_base version:**
- Changed default value of `addukrainiantotitle` from true to false
- Added new setting `usemediainfolanguages` (default: true)
- Added new field selectors:
  - `mediainfo`: Extracts media info from torrents
  - `audio_languages`: Parses audio language from mediainfo
  - `subtitle_languages`: Parses subtitle language from mediainfo
  - `language_tags`: Combines audio and subtitle language information
- Modified title formatting to incorporate parsed language tags instead of static UKR tag when `usemediainfolanguages` is enabled

## Comparison of Key Settings

| Setting | utopia.yml | utp-exp_base.yml | utp-exp.yml |
|---------|-----------|-----------------|------------|
| single_file_release_use_filename | true | false | false |
| addukrainiantotitle | false | true | false |
| addreleasegroupbyuploader | N/A | true | true |
| fixtvyear | N/A | true | true |
| usemediainfolanguages | N/A | N/A | true |